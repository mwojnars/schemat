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

export class DB extends Item {
    readOnly  = false       // if true, the database does NOT accept modifications: inserts/updates/deletes

    start_iid = 0           // minimum IID of all items; helps maintain separation of IDs between different databases stacked together
    stop_iid                // (optional) maximum IID of all items

    curr_iid  = new Map()   // current maximum IID per category, as {cid: maximum_iid}
    
    nextDB                  // higher-priority DB put on top of this one in a DB stack; used as a fallback for put() and ins()
    prevDB                  // lower-priority DB placed beneath this one in a DB stack; used as a fallback for get() and del()

    constructor(params = {}) {
        super()
        let {readOnly = false, start_iid = 0} = params
        this.readOnly = readOnly
        this.start_iid = start_iid
    }

    static Error = class extends BaseError {}
    static NotFound = class extends DB.Error {
        static message = "item ID not found in DB"
    }
    static ReadOnly = class extends DB.Error {
        static message = "no write access to the database"
    }
    static InvalidIID = class extends DB.Error {
        static message = "IID is out of range"
    }
    static NotWritable = class extends DB.Error {
        static message = "record cannot be written, the DB is either read-only or the key (iid) is outside the range"
    }

    /***  internal API  ***/

    throwNotFound(msg, args)    { throw new DB.NotFound(msg, args) }
    throwReadOnly(msg, args)    { throw new DB.ReadOnly(msg, args) }
    throwInvalidIID(id)         { throw new DB.InvalidIID({id, start_iid: this.start_iid, stop_iid: this.stop_iid}) }
    throwNotWritable(key)       { throw new DB.NotWritable({key, start_iid: this.start_iid, stop_iid: this.stop_iid}) }

    validIID(id)                { return this.start_iid <= id[1] && (!this.stop_iid || id[1] < this.stop_iid) }
    checkIID(id)                { if (this.validIID(id)) return true; this.throwInvalidIID(id) }
    async checkNew(id, msg)     { if (await this._get(id)) throw new Error(msg + ` [${id}]`) }

    createIID(cid) {
        /* Choose and return the next available IID in a given category (`cid`) as taken from this.curr_iid.
           Update this.curr_iid accordingly.
         */
        let max = this.curr_iid.get(cid) || 0               // current maximum IID for this category in the DB
        let iid = Math.max(max + 1, this.start_iid)
        this.checkIID([cid, iid])                           // check against upper bound if present
        this.curr_iid.set(cid, iid)
        return iid
    }
    async assignIID(id) {
        /* Check if the `iid` can be assigned to a new record (doesn't exist yet) within a given category `cid`.
           Update this.curr_iid accordingly.
         */
        let [cid, iid] = id
        await this.checkNew(id, "the item already exists")
        this.checkIID(id)
        this.curr_iid.set(cid, Math.max(iid, this.curr_iid.get(cid) || 0))
    }

    /***  low-level API (on encoded data)  ***/

    _open(opts)             {}
    _get(key, opts)         { throw new NotImplemented() }      // return undefined if `key` not found
    _del(key, opts)         { throw new NotImplemented() }      // return true if `key` found and deleted, false if not found
    _put(key, data, opts)   { throw new NotImplemented() }      // no return value

    open(opts = {}) {
        /* Open this DB and all lower-level DBs in the stack. */
        if (!this.prevDB) return this._open()
        return Promise.all([this.prevDB.open(), this._open()])
    }

    writable(key) {
        /* Return true if `key` is allowed to be written here. */
        return !this.readOnly && this.validIID(key)
    }

    has(key) {
        /* Return true if the get(key) would return a record; false otherwise. May return a Promise. */
        let rec = this.get(key)
        if (rec instanceof Promise) return rec.then(r => (r !== undefined))
        return rec !== undefined
    }

    async find(key) {
        /* Return the top-most DB that contains the `key`, or undefined if `key` not found at any database level. */
        let data = await this._get(key)
        if (data !== undefined) return this  //{data, db: this}
        if (this.prevDB) return this.prevDB.find(key)
    }

    async get(key, opts = {}) {
        /* Find the top-most occurrence of `key` in this DB or any lower-level DB in the stack (through .prevDB).
           If found, return a JSON-encoded data stored under the `key`; otherwise return undefined.
         */
        if (this.validIID(key)) {                               // record that doesn't satisfy IID constraints, even if exists in DB, is ignored
            let data = this._get(key, opts)
            if (data instanceof Promise) data = await data      // must await here to check for "not found" result
            if (data !== undefined) return data
        }
        if (this.prevDB) return this.prevDB.get(key, opts)
    }
    async del(key, opts = {}) {
        /* Find and delete the top-most occurrence of `key` in this DB or any lower-level DB in the stack (through .prevDB).
           Return true on success, or false if the `key` was not found (no modifications done then).
         */
        if (this.writable(key)) {
            let {flush = true} = opts
            let ret = this._del(key, opts)
            if (ret instanceof Promise) ret = await ret                 // must await here to check for "not found" result
            if (ret) {
                if (flush) await this.flush()
                return ret
            }
        }
        else if (this.readOnly && this.validIID(key) && await this.has(key))
            this.throwReadOnly({key})

        return this.prevDB ? this.prevDB.del(key, opts) : false
    }
    put(key, data, opts = {}) {
        /* Save `data` under a `key`, regardless if `key` is already present or not. May return a Promise. No return value.
           If this db is readOnly or the `key` is out of allowed range, the operation is forwarded
           to a higher-level DB (nextDB), or an exception is raised.
           If the db already contains the `id` but is readOnly, this method will duplicate the same `id`
           into a higher-level db, with new `data` stored as its payload. A subsequent del() to the higher-level db
           may remove this new instance of `id`, while keeping the old one in this db, which will become
           accessible once again to subsequent get() operations (!). In this way, deleting an `id` may result
           in this id being still accessible in its older version.
         */
        // if (!this.writable(key))
        //     if (this.nextDB) return this.nextDB.put(key, data, opts)
        //     else this.throwNotWritable(key)

        if (this.writable(key)) {
            let {flush = true} = opts
            let ret = this._put(key, data, opts)
            if (ret instanceof Promise && flush) return ret.then(() => this.flush())
            return flush ? this.flush() : ret
        }
        if (this.nextDB) return this.nextDB.put(key, data, opts)
        if (this.readOnly) this.throwReadOnly({key})
        assert(!this.validIID(key))
        this.throwInvalidIID(key)
    }
    async ins(cid, data, opts = {}) {
        /* Low-level insert to a specific category.
           Create a new `iid` under a given `cid` and store `data` in this newly created id=[cid,iid] record.
           If this db is readOnly, forward the operation to a higher-level DB (nextDB), or raise an exception.
           Return the `iid`, possibly wrapped in a Promise.
         */
        if (this.readOnly)
            if (this.nextDB) return this.nextDB.ins(cid, data, opts)
            else this.throwReadOnly({cid})
        let {flush = true} = opts
        let iid = this.createIID(cid)
        await this._put([cid, iid], data, opts)
        if (flush) await this.flush()
        return iid
    }

    /***  high-level API (on items)  ***/

    async mutate(id, edits, opts = {}) {
        /* Apply `edits` to an item's data and store under the `id` in this database or any higher db
           that allows writing this particular `id`. if `opts.data` is missing, the record is searched for
           in the current database and below - the record's data is then used as `opts.data`, and mutate() is called
           on the containing database instead of this one (the mutation may propagate upwards back to this database, though).
           FUTURE: `edits` may contain a test for a specific item's version to apply edits to.
         */
        let {search = true} = opts      // if search=true, the containing database is searched for before writing edits; turned off during propagation phase

        // find the record and its current database (this one or below) if `data` is missing
        if (search) {
            let db = await this.find(id)
            if (db === undefined) this.throwNotFound(id)
            return db.mutate(id, edits, {...opts, search: false})
        }

        let data = await this.get(id)                   // update `data` with the most recent version from db

        // propagate to a higher-level db if the mutated record can't be saved here
        if (!this.writable(id))
            if (this.nextDB) return this.nextDB.mutate(id, edits, {...opts, data, search: false})
            else this.throwNotWritable(id)

        for (const edit of edits)                       // mutate `data` and save
            data = this.apply(data, edit)

        return this.put(id, data)
    }

    async select(id) {
        /* Similar to get(), but throws an exception when `id` not found. */
        let rec = this.get(id)
        if (rec instanceof Promise) rec = await rec
        if (rec === undefined) this.throwNotFound({id})
        return rec
    }

    async update(item, opts = {}) {
        assert(item.has_data())
        assert(item.has_id())

        // let db = await this.find(item.id)
        // if (!db) this.throwNotFound({id: item.id})
        // return db.put(item.id, item.dumpData(), opts)       // update is attempted on the DB where the item is actually located, but if that DB is read-only the update is forwarded to a higher-level DB and the item gets duplicated
        if (!await this.has(item.id)) this.throwNotFound({id: item.id})
        return this.put(item.id, item.dumpData(), opts)
    }

    async insert(item, opts = {}) {
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
            let iid = this.ins(cid, data, opts)
            if (iid instanceof Promise) iid = await iid
            item.iid = iid
        }
        else {
            await this.assignIID(item.id)
            return this.put(item.id, data, opts)
        }
    }

    // insertMany(...items) {
    //     this.checkWritable()
    //     return Promise.all(items.map(item => this.insert(item, {flush: false})))
    //                   .then(() => this.flush())
    // }

    async *scan(cid) {
        /* Iterate over all items in this DB (if no `cid`), or over the items of a given category. */
        if (cid !== undefined) return this.scan(cid)
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

    constructor(filename, params = {}) {
        super(params)
        this.filename = filename
    }

    async flush()   { throw new NotImplemented() }

    _get(id, opts)  { return this.records.get(id) }
    _del(id, opts)  { return this.records.delete(id) }
    _put(id, data)  { this.records.set(id, data) }

    async *scan(cid = null) {
        let all = (cid === null)
        for (const [id, data] of this.records.entries())
            if (all || id[0] === cid) yield [id, data]
    }
}

export class YamlDB extends FileDB {
    /* Items stored in a YAML file. For use during development only. */

    async _open() {
        let file = await fs.promises.readFile(this.filename, 'utf8')
        let db = YAML.parse(file) || []
        this.records.clear()
        this.curr_iid.clear()

        for (let record of db) {
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

    async flush() {
        /* Save the entire database (this.records) to a file. */
        print(`YamlDB flushing ${this.records.size} items to ${this.filename}...`)
        let flat = [...this.records.entries()]
        let recs = flat.map(([id_, data_]) => {
                let id = {__id: id_}, data = JSON.parse(data_)
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

export class StackDB extends DB {
}

// export class RingsDB extends DB {
//     /* Several databases used together like rings. Each read/write operation is executed
//        on the outermost ring possible. If NotFound/ReadOnly is caught, a deeper (lower) ring is tried.
//        In this way, all inserts go to the outermost writable database only (warning: the items may receive IDs
//        that already exist in a lower DB!), but selects/updates/deletes may go to any lower DB.
//        NOTE: the underlying DBs may become interrelated, i.e., refer to item IDs that only exist in another DB
//        -- this is neither checked nor prevented. Typically, an outer DB referring to lower-ID items in an inner DB
//        is expected; while the reversed relationship is a sign of undesired convolution between the databases.
//      */
//
//     static RingNotFound = class extends DB.Error {
//         static message = "no suitable ring database found for the operation"
//     }
//
//     constructor(...databases) {
//         /* `databases` are ordered by increasing level: from innermost to outermost. */
//         super()
//         this.databases = databases.reverse()        // in `this`, databases are ordered by DECREASING level for easier looping
//
//         this.get    = this.outermost('get')
//         this.del    = this.outermost('del')
//         this.insert = this.outermost('insert')
//         this.update = this.outermost('update')
//         // this.select = this.outermost('select')
//     }
//     load()  { return Promise.all(this.databases.map(d => d.load())) }
//
//     outermost = (method) => async function (...args) {
//         let exLast
//         for (const db of this.databases)
//             try {
//                 let result = db[method](...args)
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
//         for (const db of this.databases)
//             yield* db.scanCategory(cid)
//     }
// }

/**********************************************************************************************************************/

export class MysqlDB extends DB {


}