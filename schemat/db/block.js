import fs from 'fs';
import yaml from 'yaml';

import {print, T} from '../utils.js'
import {DataConsistencyError, NotImplemented} from '../errors.js'
import {Item} from '../item.js'
import {ChangeRequest} from "./records.js";
import {BinaryMap, compareUint8Arrays} from "../util/binary.js";

// import { Kafka } from 'kafkajs'


function createFileIfNotExists(filename) {
    /* Create an empty file if it doesn't exist yet. Do nothing otherwise. */
    try { fs.writeFileSync(filename, '', {flag: 'wx'}) }
    catch(ex) {}
}


/**********************************************************************************************************************
 **
 **  BLOCKS
 **
 */

export class Block extends Item {
    /* A continuous subrange of records of a data/index sequence, physically located on a single machine.
       Records are arranged by key using byte order. Unit of data replication and distribution (TODO).
     */
    static role = 'block'   // for use in ProcessingStep and DataRequest

    filename                // path to a local file or folder on the worker node where this block is stored
    format                  // storage format, e.g. "data-yaml", "index-jl", "rocksdb", ...

    // worker               // worker node that contains the block's file; only at this node the block runs in the "server" mode
    
    _storage                // Storage for this block's records
    // _dirty = false          // true when the block contains unsaved modifications (with delayed flush())
    _pending_flush = false  // true when a flush() is already scheduled to be executed after a delay


    constructor(filename) {
        super()
        this.filename = filename
    }

    async open(req) {
        let extension = this.filename.split('.').pop()

        // infer the storage type from the filename extension
        if (extension === 'yaml') {
            this.format = 'data-yaml'
            this._storage = new YamlDataStorage(this.filename)
        }
        else if (extension === 'jl') {
            this.format = 'index-jl'
            this._storage = new JsonIndexStorage(this.filename)
        }
        else
            throw new Error(`unsupported storage type, '${this.format || extension}', for ${this.filename}`)

        return this._storage.open(req.make_step(this))
    }

    async get(req)      { return this._storage.get(req.args.key) }

    async put(req) {
        /* Write the `data` here in this block under the `id` and propagate the change to derived indexes.
           No forward of the request to another ring.
         */
        let {key, value} = req.args                  // handle 'value' arg instead of 'data'?
        let value_old = await this._storage.get(key) || null
        await this._storage.put(key, value)
        // this._dirty = true
        this._flush(req)
        if (req.current_ring) await this.propagate(req, key, value_old, value)     // TODO: drop "if"
    }

    async del(req) {
        let {key, value} = req.args

        if (value === undefined) value = await this._storage.get(key)
        if (value === undefined) return false        // TODO: notify about data inconsistency (there should no missing records)

        let deleted = this._storage.del(key)
        // this._dirty = true
        this._flush(req)
        if (req.current_ring) await this.propagate(req, key, value)               // TODO: drop "if"

        return deleted
    }

    async *scan(opts = {}) { yield* this._storage.scan(opts) }

    async erase(req) {
        /* Remove all records from this sequence; open() should be called first. */
        await this._storage.erase()
        return this._flush(req)
    }

    _flush(req, with_delay = true) {
        /* Flush all unsaved modifications to disk. If with_delay=true, the operation is delayed by `flush_delay`
           seconds (configured in the parent sequence) to combine multiple consecutive updates in one write
           - in such case you do NOT want to await the result.
         */
        let delay = req.current_sequence.flush_delay

        if (with_delay && delay) {
            if (this._pending_flush) return
            this._pending_flush = true
            return setTimeout(() => this._flush(req, false), delay * 1000)
        }
        this._pending_flush = false
        return this._storage.flush()
    }

    // _flush(req, delay = this.flush_delay) {
    //     /* The flushing is only executed if this._dirty=true. The operation can be delayed by `delay` seconds
    //        to combine multiple consecutive updates in one write - in such case you do NOT want to await it. */
    //     if (!this._dirty) return
    //     if (delay === 0) {
    //         this._dirty = false
    //         return this._storage.flush()
    //     }
    //     setTimeout(() => this._flush(req, 0), delay * 1000)
    // }

    async propagate(req, key, value_old = null, value_new = null) {
        /* Propagate a change in this block to all derived Sequences of the parent sequence. */
        const change = new ChangeRequest(key, value_old, value_new)
        return req.current_sequence.propagate(req, change)
    }
}

export class DataBlock extends Block {
    /* High-level API (with request forwarding) for query processing in the blocks of the main data sequence. */

    autoincrement = 0       // current maximum item ID; a new record is assigned id=autoincrement+1

    async open(req) {
        this.autoincrement = await super.open(req)
    }

    async assert_unique(key, id, msg) {
        if (await this._storage.get(key))
            throw new DataConsistencyError(msg || "item with this ID already exists", {id})
    }

    async select(req) {
        let data = await this._storage.get(req.args.key)
        return data !== undefined ? data : req.forward_down()
    }

    async insert(req) {
        // calculate the `id` if not provided, update autoincrement and write the data
        let {id, key, data} = req.args

        if (id === undefined || id === null) {
            id = Math.max(this.autoincrement + 1, req.current_ring.start_iid)      // no ID? use autoincrement with the next available ID
            key = req.current_data.encode_key(id)
        }
        else await this.assert_unique(key, id)                  // fixed ID provided by the caller? perform a uniqueness check

        req.current_ring.assert_valid_id(id, `candidate ID for a new item is outside of the valid range for this ring`)
        this.autoincrement = Math.max(id, this.autoincrement)

        // TODO: auto-increment `key` not `id`, then decode up in the sequence
        // id = this.schema.decode_key(new_key)[0]

        req = req.make_step(this, null, {id, key, value: data})

        await this.put(req)                         // change propagation is done here inside put()
        return id
    }

    async update(req) {
        /* Check if `id` is present in this block. If not, pass the request to a lower ring.
           Otherwise, load the data associated with `id`, apply `edits` to it, and save a modified item
           in this block (if the ring permits), or forward the write request back to a higher ring.
         */
        let {id, key, edits} = req.args
        let data = await this._storage.get(key)
        if (data === undefined) return req.forward_down()

        for (const edit of edits)
            data = edit.process(data)

        req = req.make_step(this, 'save', {id, key, value: data})

        if (req.current_ring.readonly)              // can't write the update here in this ring? forward to a higher ring
            return req.forward_save()
            // saving to a higher ring is done OUTSIDE the mutex and a race condition may arise, no matter how this is implemented;
            // for this reason, the new `data` can be computed already here and there's no need to forward the raw edits
            // (applying the edits in an upper ring would not improve anything in terms of consistency and mutual exclusion)

        return this.put(req)                        // change propagation is done here inside put()
    }

    async delete(req) {
        /* Try deleting the `id`, forward to a lower ring if the id is not present here in this block.
           Log an error if the ring is read-only and the `id` is present here.
         */
        let {key} = req.args
        let data = await this._storage.get(key)

        // in a read-only ring no delete can be done: check if the record exists and either forward or throw an error
        if (req.current_ring.readonly)
            if (data === undefined)
                return req.forward_down()
            else
                return req.error_access("cannot remove the item, the ring is read-only")

        // perform the delete
        req = req.make_step(this, null, {key, value: data})
        return this.del(req)
    }

    async erase(req) {
        /* Remove all records from this sequence; open() should be called first. */
        this.autoincrement = 0
        return super.erase(req)
    }
}

export class IndexBlock extends Block {}


/**********************************************************************************************************************
 **
 **  STORAGE
 **
 */

export class Storage {

    // all the methods below can be ASYNC in subclasses... (!)
    
    get(key)            { throw new NotImplemented() }      // return JSON string stored under the binary `key`, or undefined
    put(key, value)     { throw new NotImplemented() }      // no return value
    del(key)            { throw new NotImplemented() }      // return true if `key` found and deleted, false if not found

    *scan(opts)         { throw new NotImplemented() }      // generator of [binary-key, json-value] pairs
    erase()             { throw new NotImplemented() }
    flush()             { }
    // get size()          { }                                 // number of records in this storage, or undefined if not implemented
}

export class MemoryStorage extends Storage {
    /* All records stored in a Map in memory. Possibly synchronized with a file on disk (implemented in subclasses). */

    _records = new BinaryMap()       // preloaded records, {binary-key: json-data}

    get(key)            { return this._records.get(key) }
    put(key, value)     { this._records.set(key, value) }
    del(key)            { return this._records.delete(key) }

    erase()             { this._records.clear() }
    // get size()       { return this._records.size }

    *scan({start /*Uint8Array*/, stop /*Uint8Array*/} = {}) {
        /* Iterate over records in this block whose keys are in the [start, stop) range, where `start` and `stop`
           are binary keys (Uint8Array).
         */
        let sorted_keys = [...this._records.keys()].sort(compareUint8Arrays)
        let start_index = start ? sorted_keys.findIndex(key => compareUint8Arrays(key, start) >= 0) : 0
        let stop_index = stop ? sorted_keys.findIndex(key => compareUint8Arrays(key, stop) >= 0) : sorted_keys.length
        for (let key of sorted_keys.slice(start_index, stop_index))
            yield [key, this._records.get(key)]
    }
}

/**********************************************************************************************************************
 **
 **  YAML DATA
 **
 */

export class YamlDataStorage extends MemoryStorage {
    /* Items stored in a YAML file. For use during development only. */

    filename

    constructor(filename) {
        super()
        this.filename = filename
    }

    async open(req) {
        /* Load records from this block's file. */

        let ring = req.current_ring
        let block = req.current_block
        this.data_sequence = req.current_data

        createFileIfNotExists(this.filename)

        let content = fs.readFileSync(this.filename, 'utf8')
        let records = yaml.parse(content) || []

        let max_id = 0
        this._records.clear()

        for (let record of records) {
            let id = T.pop(record, '__id')
            let key = req.current_data.encode_key(id)

            ring.assert_valid_id(id, `item ID loaded from ${this.filename} is outside the valid bounds for this ring`)
            await block.assert_unique(key, id, `duplicate item ID loaded from ${this.filename}`)

            max_id = Math.max(max_id, id)

            let data = '__data' in record ? record.__data : record

            this._records.set(key, JSON.stringify(data))
        }
        return max_id
    }

    async flush() {
        /* Save the entire database (this.records) to a file. */
        print(`YamlDataStorage flushing ${this._records.size} items to ${this.filename}...`)
        let flat = [...this._records.entries()]
        let recs = flat.map(([key, data_json]) => {
            let __id = this.data_sequence.decode_key(key)
            let data = JSON.parse(data_json)
            return T.isDict(data) ? {__id, ...data} : {__id, __data: data}
        })
        let out = yaml.stringify(recs)
        fs.writeFileSync(this.filename, out, 'utf8')
    }
}

/**********************************************************************************************************************
 **
 **  JSON INDEX
 **
 */

export class JsonIndexStorage extends MemoryStorage {
    /* Items stored in a YAML file. For use during development only. */

    filename

    constructor(filename) {
        super()
        this.filename = filename
    }

    async open() {
        /* Load records from this.filename file into this.records. */

        createFileIfNotExists(this.filename)

        let content = fs.readFileSync(this.filename, 'utf8')
        let lines = content.split('\n').filter(line => line.trim().length > 0)
        let records = lines.map(line => JSON.parse(line))

        this._records.clear()

        for (let [key, value] of records)
            this._records.set(Uint8Array.from(key), value ? JSON.stringify(value) : '')
    }

    async flush() {
        /* Save the entire database (this.records) to a file. */
        print(`YamlIndexStorage flushing ${this._records.size} records to ${this.filename}...`)

        let lines = [...this._records.entries()].map(([binary_key, json_value]) => {
            let key = JSON.stringify(Array.from(binary_key))
            return json_value ? `[${key}, ${json_value}]` : `[${key}]`
        })
        fs.writeFileSync(this.filename, lines.join('\n'), 'utf8')
    }
}


/**********************************************************************************************************************
 **
 **  Physical DB implementation. (Draft)
 **
 */

// import { Mutex } from 'async-mutex'
//
// class Segment {
//     /* Continuous range of physical data on persistent storage.
//        Implements concurrent reads (selects) and exclusive writes (updates).
//      */
//
//     cache = null                // LRU cache of most recently accessed (read/wrote) items
//     tasks = new Map()           // tasks.get(id) is an array of pending tasks (Promises) for exclusive execution
//
//     select(id, client) {
//         let cell = this.cache.get(id)
//         if (cell) return cell
//
//         // if (this.tasks.has(id)) {
//         //     let pending = ...    // an exclusive oper is already running and will save in cache the most recent value of this cell when done
//         //     return pending
//         // }
//         // else this.runExclusive(id, () => this.read(id), (cell, error) => this.notify(client, cell, error))
//     }
//     update(id, edits, client) {
//         this.runExclusive(id,
//             ()            => this.edit(id, edits),
//             (cell, error) => this.notify(client, cell, error)
//         )
//     }
//
//     async notify(client, cell, error) {}
//
//     runExclusive(id, oper, callback = null) {
//         /* For asynchronous tasks: `oper` is scheduled for execution and the result will be sent to `callback`,
//            but this function returns immediately.
//          */
//         let task = () => this._run(id, oper, callback)
//         let tasks = this.tasks.get(id)
//         if (tasks === undefined) {
//             this.tasks.set(id, [])
//             task()
//         }
//         else tasks.push(task)
//             // TODO: check if the queue is already too long, return immediately with failure if so
//     }
//
//     async _run(id, oper, callback) {
//         // do async work on data cell...
//         let [cell, error] = await oper()
//         let tasks = this.tasks.get(id)
//
//         // schedule the next pending task for execution
//         if (tasks && tasks.length)
//             setTimeout(tasks.shift())
//         else if (tasks.length === 0)
//             this.tasks.remove(id)
//
//         // save the computed value in cache
//         if (!error) this.cache.set(id, cell)
//
//         // run callback with the result of the execution
//         if (callback) callback(cell, error)
//     }
// }

