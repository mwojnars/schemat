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
 **  Server-side DB
 **
 */

export class DB extends Item {
    /* TODO: physical block of storage inside a Sequence of blocks, inside the `data` or `index` of a Ring, inside a Database:
                Database > Sequence > Ring > Block > Storage
     */

    start_iid = 0           // minimum IID of all items; helps maintain separation of IDs between different databases stacked together
    stop_iid                // (optional) maximum IID of all items

    curr_iid  = new Map()   // current maximum IID per category, as {cid: maximum_iid}

    dirty                   // true means the block contains unsaved modifications

    constructor(params = {}) {
        super()
        let {start_iid = 0} = params
        this.start_iid = start_iid
    }

    /***  internal API: errors & checks  ***/

    static Error = class extends BaseError      {}
    static InvalidIID = class extends DB.Error  { static message = "IID is out of range" }

    throwInvalidIID(id)         { throw new DB.InvalidIID({id, start_iid: this.start_iid, stop_iid: this.stop_iid}) }

    validIID(id)                { return this.start_iid <= id[1] && (!this.stop_iid || id[1] < this.stop_iid) }
    checkIID(id)                { if (this.validIID(id)) return true; this.throwInvalidIID(id) }

    async checkNew(id, msg)     { if (await this._select(id)) throw new Error(msg + ` [${id}]`) }


    /***  stacking & administration  ***/

    open() {
        this.start_iid = this.start_iid || 0
        this.curr_iid  = new Map()
        this.dirty = false
    }

    async erase() {
        /* Remove all records from this block; open() should be called first.
           Subclasses should override this method but always call super.erase().
         */
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

    save(id, data) { this.dirty = true; return this._save(id, data) }
    delete(id)     { let done = this._delete(id); if (done) this.dirty = true; return done }

    /***  override in subclasses  ***/

    // these methods can be ASYNC in subclasses (!)
    _select(id)             { throw new NotImplemented() }      // return JSON-encoded `data` (a string) stored under the `id`, or undefined
    _save(id, data, opts)   { throw new NotImplemented() }      // no return value
    _delete(id)             { throw new NotImplemented() }      // return true if `key` found and deleted, false if not found
    *_scan(cid, opts)       { throw new NotImplemented() }      // generator of {id, data} records ordered by ID
    _erase()                { throw new NotImplemented() }
    _flush()                { throw new NotImplemented() }

    /***  low-level API (on encoded data)  ***/

    applyEdits(data, edits) {
        for (const edit of edits)
            data = this.applyEdit(data, edit)
        return data
    }
    applyEdit(dataSrc, edit) {
        let {type, data} = edit
        assert(type === 'data' && data)
        return data
    }

    async insertWithCID(cid, data) {
        /* Create a new `iid` under a given `cid` and store `data` in this newly created id=[cid,iid] record. Return the `iid`. */
        let iid = this._createIID(cid)
        await this.save([cid, iid], data)
        this.flush(1)
        return iid
    }
    _createIID(cid) {
        /* Choose and return the next available IID in a given category (`cid`) as taken from this.curr_iid.
           Update this.curr_iid accordingly.
         */
        let max = this.curr_iid.get(cid) || 0               // current maximum IID for this category in the DB
        let iid = Math.max(max + 1, this.start_iid)
        let id  = [cid, iid]
        if (!this.validIID(id))                             // check against the upper IID bound if present
            throw new DB.InvalidIID(`no more IIDs to assign to new records, the ID=[${id}] is outside bounds`)
        this.curr_iid.set(cid, iid)
        return iid
    }

    async insertWithIID(id, data) {
        /* Register the `id` as a new item ID in the database and store `data` under this ID. */
        await this.checkNew(id, "the item already exists")
        let [cid, iid] = id
        this.curr_iid.set(cid, Math.max(iid, this.curr_iid.get(cid) || 0))
        await this.save(id, data)
        this.flush(1)
    }
}


class FileDB extends DB {
    /* Items stored in a file. For use during development only. */

    filename = null
    records  = new ItemsMap()   // preloaded item records, {id: data_json}; data is JSON-encoded for mem usage & safety,
                                // so that clients are forced to create a new deep copy of a data object on every access

    constructor(filename, params = {}) {
        super(params)
        this.filename = filename
    }
    async open() {
        super.open()
        let fs = this._mod_fs = await import('fs')
        try {await fs.promises.writeFile(this.filename, '', {flag: 'wx'})}      // create an empty file if it doesn't exist yet
        catch(ex) {}
    }
    async _erase()  { this.records.clear() }

    _select(id)     { return this.records.get(id) }
    _save(id, data) { this.records.set(id, data) }
    _delete(id)     { let done = this.records.delete(id); return done ? this.flush().then(() => done) : done }

    async *_scan(cid) {
        let all = (cid === undefined)
        for (const [id, data] of this.records.entries())
            if (all || id[0] === cid) yield {id, data}
    }
}

export class YamlDB extends FileDB {
    /* Items stored in a YAML file. For use during development only. */

    async open() {
        await super.open()
        this._mod_YAML = (await import('yaml')).default

        let file = await this._mod_fs.promises.readFile(this.filename, 'utf8')
        let records = this._mod_YAML.parse(file) || []

        this.records.clear()
        this.curr_iid.clear()

        for (let record of records) {
            let id = T.pop(record, '__id')
            let [cid, iid] = id
            this.checkIID(id)
            await this.checkNew(id, "duplicate item ID")

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

