import {assert, BaseError, NotImplemented, print, T} from '../utils.js'
import fs from 'fs'
import YAML from 'yaml'

import { ItemsMap } from '../data.js'
import { Item } from "../item.js";

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

class DB extends Item {
    readOnly  = false   // if true, the database does NOT accept modifications: inserts/updates/deletes
    start_IID = 0       // minimum IID of newly created items; if >0, it helps maintain separation of IDs
                        // between different underlying databases used together inside a RingDB

    nextDB              // higher-priority DB put on top of this one in a DB stack; used as a fallback for put() and ins()
    prevDB              // lower-priority DB placed beneath this one in a DB stack; used as a fallback for get() and del()

    constructor(params = {}) {
        super()
        let {readOnly = false, start_IID = 0} = params
        this.readOnly = readOnly
        this.start_IID = start_IID
    }

    static Error = class extends BaseError {}
    static NotFound = class extends DB.Error {
        static message = "item ID not found in DB"
    }
    static ReadOnly = class extends DB.Error {
        static message = "no write access to the database"
    }
    static TooLowIID = class extends DB.Error {
        static message = "found an item in DB with IID lower than expected"
    }

    throwNotFound(msg, args)        { throw new DB.NotFound(msg, args) }
    throwReadOnly(msg, args)        { throw new DB.ReadOnly(msg, args) }
    throwTooLow(id)                 { throw new DB.TooLowIID({id, start_IID: this.start_IID}) }

    checkWritable(id)               { if (this.readOnly) this.throwReadOnly(id ? {id} : undefined) }
    checkMinIID(id)                 { if (id[1] < this.start_IID) this.throwTooLow(id) }
    async checkNew(id, msg)         { if (await this.has(id)) throw new Error(msg + ` [${id}]`) }

    /***  low-level API (on encoded data)  ***/

    _open(opts)             {}
    _get(key, opts)         { throw new NotImplemented() }      // return undefined if `key` not found
    _del(key, opts)         { throw new NotImplemented() }      // return true if `key` found and deleted, false if not found
    _put(key, data, opts)   { throw new NotImplemented() }      // no return value
    _ins(cid, data, opts)   { throw new NotImplemented() }

    open(opts = {}) {
        /* Open this DB and all lower-level DBs in the stack. */
        if (!this.prevDB) return this._open()
        return Promise.all([this._open(), this.prevDB.open()])
    }

    async get(key, opts = {}) {
        let ret = this._get(key, opts)
        if (ret instanceof Promise) ret = await ret                 // must await here to check for "not found" result
        if (ret !== undefined) return ret
        if (this.prevDB) return this.prevDB.get(key, opts)
        this.throwNotFound({id: key})
    }
    async del(key, opts = {}) {
        /* Returns true if `id` was present and was deleted; false if not found (no modifications done);
           or raises an exception if an error occurred.
         */
        if (this.readOnly)
            if (await this.has(key)) this.throwReadOnly({id: key})
            else return this.prevDB ? this.prevDB.del(key, opts) : false
        let {flush = true} = opts
        let ret = this._del(key, opts)
        if (ret instanceof Promise) ret = await ret                 // must await here to check for "not found" result
        if (!ret && this.prevDB) return this.prevDB.del(key, opts)
        if (ret && flush) await this.flush()
        return ret
    }
    put(key, data, opts = {}) {
        /* Save `data` under a `key`, regardless if `key` was present or not. May return a Promise. No return value.
           If this db is readOnly, the operation is forwarded to a higher-level DB (nextDB), or an exception is raised.
           If this db is readOnly but already contains the `id`, this method will duplicate the same `id`
           into a higher-level db, with new `data` stored as its payload. A subsequent del() to the higher-level db
           may remove this new instance of `id`, while keeping the old one in this db, which will become
           accessible once again to subsequent get() operations (!). In this way, deleting an `id` may result
           in this id being still accessible, only in its older version.
         */
        if (this.readOnly)
            if (this.nextDB) return this.nextDB.put(key, data, opts)
            else this.throwReadOnly({id: key})
        let {flush = true} = opts
        let ret = this._put(key, data, opts)
        if (ret instanceof Promise && flush) return ret.then(() => this.flush())
        return flush ? this.flush() : ret
    }
    async ins(cid, data, opts = {}) {
        /* Create a new `iid` under a given `cid` and store `data` in this newly created id=[cid,iid] record.
           If this db is readOnly, forward the operation to a higher-level DB (nextDB), or raise an exception.
           Return the `iid`, possibly wrapped in a Promise.
         */
        if (this.readOnly)
            if (this.nextDB) return this.nextDB.ins(cid, data, opts)
            else this.throwReadOnly({cid})
        let {flush = true} = opts
        let iid = this._ins(cid, data, opts)
        if (iid instanceof Promise) iid = await iid
        if (flush) await this.flush()
        return iid
        // if (iid instanceof Promise && flush) return iid.then(() => this.flush())
        // return flush ? this.flush() : iid
    }

    async has(id) {
        try {
            await this.get(id)
            return true
        }
        catch(ex) {
            if (ex instanceof DB.NotFound) return false
            throw ex
        }
    }

    /***  high-level API (on items)  ***/

    update(item, opts)      { throw new NotImplemented() }
    insert(item, opts)      { throw new NotImplemented() }

    insertMany(...items) {
        this.checkWritable()
        return Promise.all(items.map(item => this.insert(item, {flush: false})))
                      .then(() => this.flush())
    }

    async *scan(cid) {
        /* Iterate over all items in this DB (if no `cid`), or over the items of a given category. */
        if (cid !== undefined) return this.scanCategory(cid)
        return this.scanAll()
    }
    async *scanAll()            { throw new NotImplemented() }      // iterate over all items in this db
    async *scanCategory(cid)    { throw new NotImplemented() }      // iterate over all items in a given category
}


class FileDB extends DB {
    /* Items stored in a file. For use during development only. */

    filename = null
    records  = new ItemsMap()   // preloaded item records, as {key: record} pairs; keys are strings "cid:iid";
                                // values are objects {cid,iid,data}, `data` is JSON-encoded for mem usage & safety,
                                // so that clients create a new deep copy of item data on every access
    // TODO: keep `data` alone (no cid/iid) instead of `records`

    max_iid = new Map()         // current maximum IIDs per category, as {cid: maximum_iid}


    constructor(filename, params = {}) {
        super(params)
        this.filename = filename
    }

    async flush()   { throw new NotImplemented() }
    async has(id)   { return this.records.has(id) }

    _get(id, opts) {
        /* Return the JSON-encoded string of item's data as stored in DB. */
        let record = this.records.get(id)
        if (record) return record.data
        // if (!record) this.throwNotFound({id})
        // assert(record.cid === id[0] && record.iid === id[1])
        // return record.data
    }

    _del(id, opts) {
        // if (!this.records.has(id)) this.throwNotFound({id})
        // this.checkWritable(id)
        return this.records.delete(id)
        // return this.flush()
    }

    _put(id, data, {flush = true} = {}) {
        /* Assign `data` to a given `id`, no matter if the `id` is already present or not (the previous value is overwritten). */
        // this.checkWritable(id)
        let [cid, iid] = id
        this.records.set(id, {cid, iid, data})
        // if (flush) return this.flush()
    }

    _ins(cid, data, {min_iid = -1, flush = true} = {}) {
        /* Low-level insert to a specific category. Creates a new IID and returns it. */
        // this.checkWritable()

        // current maximum IID for this category in the DB;
        // special case for cid=0 to correctly assign IID=0 for the root category (TODO: check if this is still needed)
        let max = (cid === 0 && !this.max_iid.has(cid)) ? -1 : this.max_iid.get(cid) || 0
        let iid = Math.max(max + 1, this.start_IID, min_iid)
        this.max_iid.set(cid, iid)
        // return this._put([cid, iid], data)
        this.records.set([cid, iid], {cid, iid, data})
        return iid
        // return flush ? this.flush().then(() => iid) : iid
    }

    async insert(item, {flush = true} = {}) {
        /* High-level insert. The `item` can have an IID already assigned (then it's checked that
           this IID is not yet present in the DB), or not.
           If item.iid is missing, a new IID is assigned - it can be retrieved from `item.iid`
           after the function completes.
         */
        assert(item.has_data())
        assert(item.cid || item.cid === 0)
        let data = item.dumpData()
        let cid  = item.cid

        // set IID of the item, if missing
        if (item.iid === null || item.iid === undefined) {
            let iid = this.ins(cid, data, {flush})
            // if (iid instanceof Promise) return iid.then(iid => {item.iid = iid})
            if (iid instanceof Promise) iid = await iid
            item.iid = iid
        }
        else {
            this.checkMinIID(item.id)
            await this.checkNew(item.id, "the item already exists")
            this.max_iid.set(cid, Math.max(item.iid, this.max_iid.get(cid) || 0))
            return this.put(item.id, data, {flush})
        }
    }

    // async insert(item, {flush = true} = {}) {
    //     /* If item.iid is missing, a new IID is assigned - it can be retrieved from `item.iid`
    //        after the function completes.
    //      */
    //     assert(item.has_data())
    //
    //     // set CID of the item
    //     if (item.cid === null || item.cid === undefined) item.cid = item.category.iid
    //     let cid = item.cid
    //     let max_iid
    //
    //     if (cid === 0 && !this.max_iid.has(cid))
    //         max_iid = -1   // use =0 if the root category is not getting an IID here
    //     else
    //         max_iid = this.max_iid.get(cid) || 0
    //
    //     // set IID of the item, if missing
    //     let iid = item.iid
    //     if (iid === null || iid === undefined) {
    //         item.iid = iid = Math.max(max_iid + 1, this.start_IID)
    //         this.max_iid.set(cid, iid)
    //     }
    //     else {
    //         this.checkMinIID(item.id)
    //         await this.checkNew(item.id, "the item already exists")
    //         this.max_iid.set(cid, Math.max(iid, max_iid))
    //     }
    //
    //     return this.put(item.id, item.dumpData(), {flush})
    // }

    update(item, {flush = true} = {}) {
        assert(item.has_data())
        assert(item.has_id())
        if (!this.records.has(item.id)) this.throwNotFound({id: item.id})
        return this.put(item.id, item.dumpData(), {flush})
    }

    async *scanCategory(cid) {
        for (const record of this.records.values())
            if (cid === record.cid) yield record
    }
}

export class YamlDB extends FileDB {
    /* Items stored in a YAML file. For use during development only. */

    async _open() {
        // let fs = await import('fs')
        // let YAML = (await import('yaml')).default
        let file = await fs.promises.readFile(this.filename, 'utf8')
        let db = YAML.parse(file) || []
        this.records.clear()
        this.max_iid.clear()

        for (let record of db) {
            let id = T.pop(record, '__id')
            let [cid, iid] = id
            this.checkMinIID(id)
            await this.checkNew(id, "duplicate item ID")

            let data = '__data' in record ? record.__data : record
            let curr_max = this.max_iid.get(cid) || 0
            this.max_iid.set(cid, Math.max(curr_max, iid))
            this.records.set(id, {cid, iid, data: JSON.stringify(data)})
        }
        // print('YamlDB items loaded:')
        // for (const [id, data] of this.records)
        //     print(id, data)
    }

    async flush() {
        /* Save the entire database (this.records) to a file. */
        print(`YamlDB flushing ${this.records.size} items to ${this.filename}...`)
        let flat = [...this.records.values()]
        let recs = flat.map(({cid, iid, data:d}) => {
                let id = {__id: [cid, iid]}, data = JSON.parse(d)
                return T.isDict(data) ? {...id, ...data} : {...id, __data: data}
            })
        let out = YAML.stringify(recs)
        return fs.promises.writeFile(this.filename, out, 'utf8')
    }
}

/**********************************************************************************************************************/

export function stackDB(...db) {
    /* Connect a number of DB databases, `db`, into a stack, with db[0] being the bottom of the stack,
       and the highest-priority database (db[-1]) placed at the top of the stack.
       The databases are connected into a double-linked list through their .prevDB & .nextDB attributes.
       Return the top database.
     */
    if (!db.length) throw new Error('the list of databases to stackDB() cannot be empty')
    let prev = db[0], next
    for (next of db.slice(1)) {
        prev.nextDB = next
        next.prevDB = prev
        prev = next
    }
    return prev
}

export class RingsDB extends DB {
    /* Several databases used together like rings. Each read/write operation is executed
       on the outermost ring possible. If NotFound/ReadOnly is caught, a deeper (lower) ring is tried.
       In this way, all inserts go to the outermost writable database only (warning: the items may receive IDs
       that already exist in a lower DB!), but selects/updates/deletes may go to any lower DB.
       NOTE: the underlying DBs may become interrelated, i.e., refer to item IDs that only exist in another DB
       -- this is neither checked nor prevented. Typically, an outer DB referring to lower-ID items in an inner DB
       is expected; while the reversed relationship is a sign of undesired convolution between the databases.
     */

    static RingNotFound = class extends DB.Error {
        static message = "no suitable ring database found for the operation"
    }

    constructor(...databases) {
        /* `databases` are ordered by increasing level: from innermost to outermost. */
        super()
        this.databases = databases.reverse()        // in `this`, databases are ordered by DECREASING level for easier looping

        this.get    = this.outermost('get')
        this.del    = this.outermost('del')
        this.insert = this.outermost('insert')
        this.update = this.outermost('update')
        // this.select = this.outermost('select')
    }
    load()  { return Promise.all(this.databases.map(d => d.load())) }

    outermost = (method) => async function (...args) {
        let exLast
        for (const db of this.databases)
            try {
                let result = db[method](...args)
                return result instanceof Promise ? await result : result
            }
            catch (ex) {
                if (ex instanceof DB.NotFound) { exLast = ex; continue }
                // if (ex instanceof DB.NotFound || ex instanceof DB.ReadOnly) continue
                throw ex
            }
        throw exLast || new DB.NotFound()
        // throw new RingsDB.RingNotFound()
    }

    async *scanCategory(cid) {
        for (const db of this.databases)
            yield* db.scanCategory(cid)
    }
}

/**********************************************************************************************************************/

export class MysqlDB extends DB {


}