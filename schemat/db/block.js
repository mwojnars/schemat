import fs from 'fs';
import yaml from 'yaml';

import {print, T} from '../utils.js'
import {BaseError, NotImplemented} from '../errors.js'
import {Item} from '../item.js'
import {RecordChange} from "./records.js";
import {BinaryMap, compareUint8Arrays} from "../util/binary.js";

// import { Kafka } from 'kafkajs'


function createFileIfNotExists(filename) {
    /* Create an empty file if it doesn't exist yet. Do nothing otherwise. */
    try { fs.writeFileSync(this.filename, '', {flag: 'wx'}) }
    catch(ex) {}
}


/**********************************************************************************************************************
 **
 **  BLOCKS
 **
 */

export class Block extends Item {
    /* A continuous subrange of records of a data/index sequence, physically located on a single machine.
       Records are arranged by key according to byte order. Unit of data replication and distribution (TODO).
     */
    static role = 'block'   // for use in ProcessingStep and DataRequest

    FLUSH_TIMEOUT = 1       // todo: make the timeout configurable and 0 by default
    autoincrement = 0       // current maximum IID; a new record is assigned iid=autoincrement+1

    ring                    // the ring this block belongs to
    dirty                   // true when the block contains unsaved modifications
    storage                 // storage for this block's records

    constructor(ring) {
        super()
        this.ring = ring
    }

    async open() {
        this.dirty = false
        this.autoincrement = await this.storage.open(this.ring, this)
    }

    /***  low-level API (no request forwarding)  ***/

    async get(req, key)     { return this.storage.get(key) }

    async put(req, key, data) {
        /* Write the `data` here in this block under the `id` and propagate the change to indexes.
           No forward of the request to another ring/block.
         */
        let data_old = await this.storage.get(key) || null
        await this.storage.put(key, data)
        this.dirty = true
        this.flush()
        if (req) await this.propagate(req, key, data_old, data)     // TODO: drop "if"
    }

    async del(req, key) {
        let data = await this.storage.get(key)
        if (data === undefined) return false        // TODO: inside index, notify about data inconsistency (there should no missing records)

        let deleted = this.storage.del(key)
        this.dirty = true
        this.flush()
        if (req) await this.propagate(req, key, data)               // TODO: drop "if"

        return deleted
    }

    async *scan(opts = {}) { yield* this.storage.scan(opts) }

    async erase() {
        /* Remove all records from this sequence; open() should be called first. */
        this.autoincrement = 0
        await this.storage.erase()
        return this.flush()
    }

    async flush(timeout_sec = this.FLUSH_TIMEOUT) {
        /* The flushing is only executed if this.dirty=true. The operation can be delayed by `timeout_sec` seconds
           to combine multiple consecutive updates in one write - in such case you do NOT want to await it. */
        if (!this.dirty) return
        if (timeout_sec === 0) {
            this.dirty = false
            return this.storage.flush()
        }
        setTimeout(() => this.flush(0), timeout_sec * 1000)
    }

    async propagate(req, key, data_old = null, data_new = null) {
        /* Propagate a change in this block to derived Sequences in the same ring. */
        const change = new RecordChange(key, data_old, data_new)
        return req.current_ring.propagate(change)
    }
}

export class DataBlock extends Block {
    /* High-level API (with request forwarding) for query processing in the blocks of the main data sequence. */

    static Error = class extends BaseError {}
    static ItemExists = class extends DataBlock.Error   { static message = "item with this ID already exists" }

    async assertUniqueID(id, msg) {
        let key = this.ring.data._make_key(id)
        if (await this.storage.get(key)) throw new DataBlock.ItemExists(msg, {id})
    }

    async select(req, id) {
        let key = req.encode_id(id)
        let data = await this.storage.get(key)
        return data !== undefined ? data : req.forward_select()
    }

    async insert(req, id, data) {
        // calculate the `id` if not provided, update `autoincrement`, and write the data
        if (id !== undefined) await this.assertUniqueID(id)                 // the uniqueness check is only needed when the ID came from the caller;
        else id = Math.max(this.autoincrement + 1, req.current_ring.start_iid)      // use the next available ID

        req.current_ring.assertValidID(id, `candidate ID for a new item is outside of the valid set for this ring`)

        this.autoincrement = Math.max(id, this.autoincrement)

        let key = req.encode_id(id)
        await this.put(req, key, data)

        // TODO: auto-increment `key` not `id`, then decode
        // id = this.schema.decode_key(new_key)[0]

        return id
    }

    async update(req, id, ...edits) {
        /* Check if `id` is present in this block. If not, pass the request to a lower ring.
           Otherwise, load the data associated with `id`, apply `edits` to it, and save a modified item
           in this block (if the ring permits), or forward the write request back to a higher ring.
         */
        let key = req.encode_id(id)
        let data = await this.storage.get(key)
        if (data === undefined) return req.forward_update()

        for (const edit of edits)
            data = edit.process(data)

        return req.current_ring.writable() ? this.put(req, key, data) : req.forward_save(id, data)
    }

    async delete(req, id) {
        /* Try deleting the `id`, forward to a deeper ring if the id is not present here in this block. */
        let key = req.encode_id(id)
        let data_old = await this.storage.get(key)
        let done = this.storage.del(key)
        if (done instanceof Promise) done = await done
        if (done) this.dirty = true
        this.flush()
        await this.propagate(req, key, data_old)
        return done ? done : req.forward_delete(id)
    }
}

export class MemoryBlock extends Block {

    constructor(ring) {
        super(ring)
        this.storage = new MemoryStorage()
    }
}


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
    get size()          { }                                 // number of records in this storage, or undefined if not implemented
}

export class MemoryStorage extends Storage {
    /* All records stored in a Map in memory. Possibly synchronized with a plain file on disk (implemented in subclasses). */

    records = new BinaryMap()       // preloaded records, {binary-key: json-data}

    get(key)            { return this.records.get(key) }
    put(key, value)     { this.records.set(key, value) }
    del(key)            { return this.records.delete(key) }

    erase()             { this.records.clear() }
    size()              { return this.records.size }

    *scan({start /*Uint8Array*/, stop /*Uint8Array*/} = {}) {
        /* Iterate over records in this block whose keys are in the [start, stop) range, where `start` and `stop`
           are binary keys (Uint8Array).
         */
        let sorted_keys = [...this.records.keys()].sort(compareUint8Arrays)
        let start_index = start ? sorted_keys.findIndex(key => compareUint8Arrays(key, start) >= 0) : 0
        let stop_index = stop ? sorted_keys.findIndex(key => compareUint8Arrays(key, stop) >= 0) : sorted_keys.length
        for (let key of sorted_keys.slice(start_index, stop_index))
            yield [key, this.records.get(key)]
    }
}

/**********************************************************************************************************************
 **
 **  YAML DATA BLOCK
 **
 */

export class YamlDataBlock extends DataBlock {

    constructor(ring, filename) {
        super(ring)
        this.storage = new YamlDataStorage(filename, ring, this)
    }
}

export class YamlDataStorage extends MemoryStorage {
    /* Items stored in a YAML file. For use during development only. */

    filename

    constructor(filename, ring, block) {
        super()
        this.filename = filename
        this.ring = ring
        this.block = block
    }

    async open() {
        /* Load records from this.filename file into this.records. */

        createFileIfNotExists(this.filename)

        let content = fs.readFileSync(this.filename, 'utf8')
        let records = yaml.parse(content) || []

        let max_id = 0
        this.records.clear()

        for (let record of records) {
            let id = T.pop(record, '__id')

            this.ring.assertValidID(id, `item ID loaded from ${this.filename} is outside the valid bounds for this ring`)
            await this.block.assertUniqueID(id, `duplicate item ID loaded from ${this.filename}`)

            max_id = Math.max(max_id, id)

            let data = '__data' in record ? record.__data : record
            let key = this.ring.data.schema.encode_key([id])

            this.records.set(key, JSON.stringify(data))
        }
        return max_id
    }

    async flush() {
        /* Save the entire database (this.records) to a file. */
        print(`YamlDataStorage flushing ${this.records.size} items to ${this.filename}...`)
        let flat = [...this.records.entries()]
        let recs = flat.map(([key, data_json]) => {
            let __id = this.ring.data.schema.decode_key(key)[0]
            let data = JSON.parse(data_json)
            return T.isDict(data) ? {__id, ...data} : {__id, __data: data}
        })
        let out = yaml.stringify(recs)
        fs.writeFileSync(this.filename, out, 'utf8')
    }
}

/**********************************************************************************************************************
 **
 **  JSON INDEX BLOCK
 **
 */

export class JsonlIndexBlock extends MemoryBlock {

    constructor(ring, filename) {
        super(ring)
        this.storage = new JsonIndexStorage(filename)
    }
}

export class JsonIndexStorage extends MemoryStorage {
    /* Items stored in a YAML file. For use during development only. */

    filename

    constructor(filename, ring) {
        super()
        this.filename = filename
    }

    async open() {
        /* Load records from this.filename file into this.records. */

        createFileIfNotExists(this.filename)

        let content = fs.readFileSync(this.filename, 'utf8')
        let lines = content.split('\n').filter(line => line.trim().length > 0)
        let records = lines.map(line => JSON.parse(line))

        this.records.clear()

        for (let [key, value] of records)
            this.records.set(Uint8Array.from(key), value ? JSON.stringify(value) : '')
    }

    async flush() {
        /* Save the entire database (this.records) to a file. */
        print(`YamlIndexStorage flushing ${this.records.size} records to ${this.filename}...`)

        let lines = [...this.records.entries()].map(([binary_key, json_value]) => {
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

