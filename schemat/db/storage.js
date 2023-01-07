import { assert, print, T, merge } from '../utils.js'
import { BaseError, NotImplemented } from '../errors.js'
import { ItemsMap } from '../data.js'
import { Item } from '../item.js'

import { Kafka } from 'kafkajs'


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
 **  BLOCKS
 **
 */

export class Block extends Item {
    /* TODO: physical block of storage inside a Sequence of blocks, inside the `data` or `index` of a Ring, inside a Database:
                Database > Sequence > Ring > Block > Storage
     */

    curr_iid  = new Map()   // current maximum IID per category, as {cid: maximum_iid}
    dirty                   // true when the block contains unsaved modifications


    static Error = class extends BaseError          {}
    static ItemExists = class extends Block.Error   { static message = "item with this ID already exists" }

    async checkNew(id, msg)     { if (await this._select(id)) throw new Block.ItemExists(msg, {id}) }


    open(ring) {
        this.curr_iid  = new Map()
        this.dirty = false
    }

    async erase() {
        /* Remove all records from this block; open() should be called first. */
        this.curr_iid.clear()
        await this._erase()
        return this.flush()
    }

    async flush(timeout_sec = 0) {
        /* The flushing is only executed if this.dirty=true. The operation can be delayed by `timeout_sec` seconds
           to combine multiple consecutive updates in one write - in such case you do NOT want to await it. */
        if (!this.dirty) return
        if (timeout_sec === 0) {
            this.dirty = false
            return this._flush()
        }
        setTimeout(() => this.flush(), timeout_sec * 1000)
    }


    /***  CRUD operations  ***/

    async save(id, data) {
        await this._save(id, data)
        this.dirty = true
        this.flush(1)               // todo: make the timeout configurable and 0 by default
    }

    async delete(id) {
        let done = this._delete(id)
        if (done instanceof Promise) done = await done
        if (done) this.dirty = true
        return done
    }

    async insert(id, data, ring) {
        /* Save a new item and update this.curr_iid accordingly. Assign an IID if missing. Return the IID. */

        let [cid, iid] = id

        if (iid !== undefined) await this.checkNew(id)          // the check is only needed when the IID came from the caller
        else {
            let max = this.curr_iid.get(cid) || 0               // current maximum IID for this category in the Block
            iid = Math.max(max + 1, ring.start_iid)             // next available IID in this category
            id  = [cid, iid]
        }

        ring.checkValidID(id, `candidate ID for a new item is outside the valid bounds for this ring`)

        let max_iid = Math.max(iid, this.curr_iid.get(cid) || 0)
        this.curr_iid.set(cid, max_iid)
        await this.save([cid, iid], data)
        return iid
    }

    async update(ring, id, ...edits) {
        /* Check if `id` is present in this block. If not, pass the request to a lower ring.
           Otherwise, load the data associated with `id`, apply `edits` to it, and save a modified item
           in this block (if the ring permits), or forward the write request to a higher ring.
         */
        let data = await this._select(id)
        if (data === undefined) return ring.forward_update(id, ...edits)

        for (const edit of edits)
            data = this.edit(data, edit)

        return ring.writable(id) ? this.save(id, data) : ring.forward_save(id, data)
    }

    edit(dataSrc, edit) {
        let {type, data} = edit
        assert(type === 'data' && data)
        return data
    }


    /***  override in subclasses  ***/

    // these methods can be ASYNC in subclasses (!)
    _select(id)             { throw new NotImplemented() }      // return JSON-encoded `data` (a string) stored under the `id`, or undefined
    _save(id, data)         { throw new NotImplemented() }      // no return value
    _delete(id)             { throw new NotImplemented() }      // return true if `key` found and deleted, false if not found
    _erase()                { throw new NotImplemented() }
    _flush()                { throw new NotImplemented() }
    *_scan(cid, opts)       { throw new NotImplemented() }      // generator of {id, data} records ordered by ID

}


class FileDB extends Block {
    /* Items stored in a file. For use during development only. */

    filename = null
    records  = new ItemsMap()   // preloaded item records, {id: data_json}; data is JSON-encoded for mem usage & safety,
                                // so that clients are forced to create a new deep copy of a data object on every access

    constructor(filename, params = {}) {
        super(params)
        this.filename = filename
    }
    async open(ring) {
        super.open(ring)
        let fs = this._mod_fs = await import('fs')
        try {await fs.promises.writeFile(this.filename, '', {flag: 'wx'})}      // create an empty file if it doesn't exist yet
        catch(ex) {}
    }
    async _erase()  { this.records.clear() }

    _select(id)     { return this.records.get(id) }
    _delete(id)     { return this.records.delete(id) }
    _save(id, data) { this.records.set(id, data) }

    async *_scan(cid) {
        let entries = [...this.records.entries()]
        if (cid !== undefined) entries = entries.filter(([id, data]) => id[0] === cid)
        entries = entries.map(([id, data]) => ({id, data}))
        entries.sort(Item.orderAscID)               // the entries must be sorted to allow correct merging over rings
        yield* entries
    }
}

export class YamlDB extends FileDB {
    /* Items stored in a YAML file. For use during development only. */

    async open(ring) {
        await super.open()
        this._mod_YAML = (await import('yaml')).default

        let file = await this._mod_fs.promises.readFile(this.filename, 'utf8')
        let records = this._mod_YAML.parse(file) || []

        this.records.clear()
        this.curr_iid.clear()

        for (let record of records) {
            let id = T.pop(record, '__id')
            let [cid, iid] = id
            ring.checkValidID(id, `item ID loaded from ${this.filename} is outside the valid bounds for this ring`)
            await this.checkNew(id, `duplicate item ID loaded from ${this.filename}`)

            let curr_max = this.curr_iid.get(cid) || 0
            this.curr_iid.set(cid, Math.max(curr_max, iid))

            let data = '__data' in record ? record.__data : record
            this.records.set(id, JSON.stringify(data))
        }
    }

    async _flush() {
        /* Save the entire database (this.records) to a file. */
        print(`YamlDB flushing ${this.records.size} items to ${this.filename}...`)
        let flat = [...this.records.entries()]
        let recs = flat.map(([__id, data_json]) => {
                let data = JSON.parse(data_json)
                return T.isDict(data) ? {__id, ...data} : {__id, __data: data}
            })
        let out = this._mod_YAML.stringify(recs)
        return this._mod_fs.promises.writeFile(this.filename, out, 'utf8')
    }
}

/**********************************************************************************************************************/

// export class Database {
//     /* A number of Rings stacked on top of each other. Each select/update/delete is executed on the outermost
//        ring possible; while each insert - on the innermost ring starting at the category's own ring.
//        If NotFound/ReadOnly is caught, a deeper (lower) ring is tried.
//        In this way, all inserts go to the outermost writable ring only (warning: the items may receive IDs
//        that already exist in a lower DB!), but selects/updates/deletes may go to any lower DB.
//        NOTE: the underlying DBs may become interrelated, i.e., refer to item IDs that only exist in another DB
//        -- this is neither checked nor prevented. Typically, an outer DB referring to lower-ID items in an inner DB
//        is expected; while the reversed relationship is a sign of undesired convolution between the databases.
//      */
//
//     static RingNotFound = class extends DB.Error {
//         static message = "data ring not found for the operation"
//     }
//
//     constructor(...rings) {
//         /* `rings` are ordered by increasing level: from innermost to outermost. */
//         this.rings = rings.reverse()        // in `this`, rings are ordered by DECREASING level for easier looping
//
//         this.get    = this.outermost('get')
//         this.del    = this.outermost('del')
//         this.insert = this.outermost('insert')
//         this.update = this.outermost('update')
//         // this.select = this.outermost('select')
//     }
//     load()  { return Promise.all(this.rings.map(d => d.load())) }
//
//     outermost = (method) => async function (...args) {
//         let exLast
//         for (const ring of this.rings)
//             try {
//                 let result = ring[method](...args)
//                 return result instanceof Promise ? await result : result
//             }
//             catch (ex) {
//                 if (ex instanceof DB.NotFound) { exLast = ex; continue }
//                 // if (ex instanceof DB.NotFound || ex instanceof DB.ReadOnly) continue
//                 throw ex
//             }
//         throw exLast || new DB.NotFound()
//         // throw new RingsDB.RingNotFound()
//     }
//
//     async *scanCategory(cid) {
//         for (const db of this.rings)
//             yield* db.scanCategory(cid)
//     }
// }

