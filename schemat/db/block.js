import { assert, print, T } from '../utils.js'
import { BaseError, NotImplemented } from '../errors.js'
import { Item } from '../item.js'
import {RecordChange, ItemRecord, SequenceSchema} from "./records.js";
import {Sequence} from "./store.js";
import {INTEGER} from "../type.js";

// import { Kafka } from 'kafkajs'


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
//     async read(id) { return null }
//     async edit(id, edits) {}
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

/**********************************************************************************************************************
 **
 **  DATA SEQUENCE
 **
 */

export class DataSequence extends Sequence {

    schema = new SequenceSchema(
        new Map([['id', new INTEGER()]]),
        // value encoding is handled outside schema: through method overloading
    );

    constructor(ring, {file, item} = {}) {
        super()
        this.ring = ring

        // block is a local file, or an item that must be loaded from a lower ring
        this.block = file ? new YamlBlock(ring, file) : globalThis.registry.getLoaded(item)
    }

    async open() {
        await this.block
        await this.block.open()
        this.block.setExpiry('never')                       // prevent eviction of this item from Registry's cache (!)
    }

    _find_block_by_id(id) { return this.block }

    async select_local(req, id) {
        /* Read item's data from this sequence, no forward to a lower ring. Return undefined if `id` not found. */
        let block = this._find_block_by_id(id)
        return block._select(id)
    }

    async select(req, id) {
        req = req.set_sequence(this)
        let block = this._find_block_by_id(id)
        return block.select_or_forward(req, id)
        // let data = await block._select(id)
        // return data !== undefined ? data : req.forward_select(id)
    }

    async insert(req, id, data) {
        let block = this._find_block_by_id(id)
        return block.insert(req, id, data)
    }

    async update(req, id, ...edits) {
        let block = this._find_block_by_id(id)
        return block.update(req, id, ...edits)
    }

    async delete(req, id) {
        let block = this._find_block_by_id(id)
        return block.delete(req, id)
    }

    async save(req, id, data) {
        let block = this._find_block_by_id(id)
        return block.save(req, id, data)
    }

    async *scan_all() {
        /* Yield all items as ItemRecord objects. */
        yield* this.block.scan_all()
    }

    async erase() { return this.block.erase() }
    async flush() { return this.block.flush() }
}

/**********************************************************************************************************************
 **
 **  BLOCKS
 **
 */

export class Block extends Item {
    /* Continuous block of consecutive records inside a Sequence, inside the `data` or `index` of a Ring, inside a database:
           Database > Ring > Data/Index Sequence > Block > Storage > Record
     */

    FLUSH_TIMEOUT = 1       // todo: make the timeout configurable and 0 by default

    autoincrement = 0       // current maximum IID; a new record is assigned iid=autoincrement+1

    ring                    // the ring this block belongs to
    dirty                   // true when the block contains unsaved modifications

    storage                 // storage for this block's records


    static Error = class extends BaseError          {}
    static ItemExists = class extends Block.Error   { static message = "item with this ID already exists" }

    async assertUniqueID(id, msg)                   { if (await this.storage._select(id)) throw new Block.ItemExists(msg, {id}) }

    constructor(ring) {
        super()
        this.ring = ring
    }

    async open() {
        this.dirty = false
        this.autoincrement = await this.storage.open()
    }

    async flush(timeout_sec = this.FLUSH_TIMEOUT) {
        /* The flushing is only executed if this.dirty=true. The operation can be delayed by `timeout_sec` seconds
           to combine multiple consecutive updates in one write - in such case you do NOT want to await it. */
        if (!this.dirty) return
        if (timeout_sec === 0) {
            this.dirty = false
            return this.storage._flush()
        }
        setTimeout(() => this.flush(0), timeout_sec * 1000)
    }

    async propagate(req, id, data_old = null, data_new = null) {
        /* Propagate a change in this block to derived Sequences in the same ring. */
        const data_schema = req.ring.data.schema
        const binary_key = data_schema.encode_key([id])
        const change = new RecordChange(binary_key, data_old, data_new)
        return req.ring.propagate(change)
    }


    /***  CRUD operations  ***/

    async select_or_forward(req, id) {
        let data = await this.storage._select(id)
        return data !== undefined ? data : req.forward_select(id)
    }

    async insert(req, id, data) {
        // calculate the `id` if not provided, update `autoincrement`, and write the data
        if (id !== undefined) await this.assertUniqueID(id)                 // the uniqueness check is only needed when the ID came from the caller;
        else id = Math.max(this.autoincrement + 1, req.ring.start_iid)      // use the next available ID

        req.ring.assertValidID(id, `candidate ID for a new item is outside of the valid set for this ring`)

        this.autoincrement = Math.max(id, this.autoincrement)
        await this.save(req, id, data)
        return id
    }

    async update(req, id, ...edits) {
        /* Check if `id` is present in this block. If not, pass the request to a lower ring.
           Otherwise, load the data associated with `id`, apply `edits` to it, and save a modified item
           in this block (if the ring permits), or forward the write request back to a higher ring.
         */
        let data = await this.storage._select(id)
        if (data === undefined) return req.forward_update(id, ...edits)

        for (const edit of edits)
            data = edit.process(data)

        return req.ring.writable() ? this.save(req, id, data) : req.forward_save(id, data)
    }

    async delete(req, id) {
        /* Try deleting the `id`, forward to a deeper ring if the id is not present here in this block. */
        let data_old = await this.storage._select(id)
        let done = this.storage._delete(id)
        if (done instanceof Promise) done = await done
        if (done) this.dirty = true
        this.flush()
        await this.propagate(req, id, data_old)
        return done ? done : req.forward_delete(id)
    }

    async save(req, id, data) {
        /* Write the `data` here in this block under the `id`. No forward to another ring/block. */
        let data_old = await this.storage._select(id) || null
        await this.storage._save(id, data)
        this.dirty = true
        this.flush()
        await this.propagate(req, id, data_old, data)
    }

    async erase() {
        /* Remove all records from this sequence; open() should be called first. */
        this.autoincrement = 0
        await this.storage._erase()
        return this.flush()
    }

    async *scan_all() { yield* this.storage._scan() }
}

class YamlBlock extends Block {
    constructor(ring, filename) {
        super(ring)
        this.storage = new YamlStorage(ring, filename)
    }
}


class Storage {

    // these methods can be ASYNC in subclasses (!)
    _select(id)             { throw new NotImplemented() }      // return JSON-encoded `data` (a string) stored under the `id`, or undefined
    _save(id, data)         { throw new NotImplemented() }      // no return value
    _delete(id)             { throw new NotImplemented() }      // return true if `key` found and deleted, false if not found
    _erase()                { throw new NotImplemented() }
    _flush()                { throw new NotImplemented() }
    *_scan(opts)            { throw new NotImplemented() }      // generator of {id, data} records ordered by ID
}

class FileStorage extends Storage {
    /* Items stored in a file. For use during development only. */

    filename = null
    records  = new Map()        // preloaded items data, {id: data_json}; JSON-ified for mem usage & safety,
                                // so that callers are forced to create a new deep copy of a data object on every access

    constructor(ring, filename) {
        super()
        this.ring = ring
        this.filename = filename
    }
    async open() {
        // super.open()
        let fs = this._mod_fs = await import('fs')
        try { fs.writeFileSync(this.filename, '', {flag: 'wx'}) }           // create an empty file if it doesn't exist yet
        catch(ex) {}
    }
    async _erase()  { this.records.clear() }

    _select(id)     { return this.records.get(id) }
    _delete(id)     { return this.records.delete(id) }
    _save(id, data) { this.records.set(id, data) }

    async *_scan() {
        let entries = [...this.records.entries()]
        entries = entries.map(([id, data]) => (new ItemRecord(id, data)))
        entries.sort(Item.orderAscID)               // the entries must be sorted to allow correct merging over rings
        yield* entries
    }
}

export class YamlStorage extends FileStorage {
    /* Items stored in a YAML file. For use during development only. */

    async open() {
        /* Load records from this.filename file into this.records. */

        await super.open()
        this._mod_YAML = (await import('yaml')).default

        let file = this._mod_fs.readFileSync(this.filename, 'utf8')
        let records = this._mod_YAML.parse(file) || []

        let max_id = 0
        this.records.clear()

        for (let record of records) {
            let id = T.pop(record, '__id')

            this.ring.assertValidID(id, `item ID loaded from ${this.filename} is outside the valid bounds for this ring`)
            // await this.assertUniqueID(id, `duplicate item ID loaded from ${this.filename}`)

            max_id = Math.max(max_id, id)

            let data = '__data' in record ? record.__data : record
            this.records.set(id, JSON.stringify(data))
        }
        return max_id
    }

    async _flush() {
        /* Save the entire database (this.records) to a file. */
        print(`YamlBlock flushing ${this.records.size} items to ${this.filename}...`)
        let flat = [...this.records.entries()]
        let recs = flat.map(([__id, data_json]) => {
                let data = JSON.parse(data_json)
                return T.isDict(data) ? {__id, ...data} : {__id, __data: data}
            })
        let out = this._mod_YAML.stringify(recs)
        this._mod_fs.writeFileSync(this.filename, out, 'utf8')
    }
}
