import {assert, BaseError, NotImplemented, print, T, merge} from '../utils.js'
import { ItemsMap } from '../data.js'
import { Item } from '../item.js'

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
    name                    // name of this DB for display and CLI options
    readonly                // if true, the database does NOT accept modifications: inserts/updates/deletes

    start_iid = 0           // minimum IID of all items; helps maintain separation of IDs between different databases stacked together
    stop_iid                // (optional) maximum IID of all items

    curr_iid  = new Map()   // current maximum IID per category, as {cid: maximum_iid}
    
    nextDB                  // higher-priority DB put on top of this one in a DB stack; fallback for save/mutate/update()
    prevDB                  // lower-priority DB placed beneath this one in a DB stack; fallback for read/drop/insert()

    get top()       { return this.nextDB ? this.nextDB.top : this }
    get bottom()    { return this.prevDB ? this.prevDB.bottom : this }

    constructor(params = {}) {
        super()
        let {readonly = false, start_iid = 0} = params
        this.readonly = readonly
        this.start_iid = start_iid
    }

    /***  internal API: errors & checks  ***/

    static Error = class extends BaseError {}
    static NotFound = class extends DB.Error {
        static message = "item ID not found in DB"
    }
    static ReadOnly = class extends DB.Error {
        static message = "the database is for read-only access"
    }
    static InvalidIID = class extends DB.Error {
        static message = "IID is out of range"
    }
    static NotWritable = class extends DB.Error {
        static message = "record cannot be written, the DB is either read-only or the key (iid) is outside the range"
    }

    throwNotFound(msg, args)    { throw new DB.NotFound(msg, args) }
    throwReadOnly(msg, args)    { throw new DB.ReadOnly(msg, args) }
    throwNotWritable(key)       { throw new DB.NotWritable({key, start_iid: this.start_iid, stop_iid: this.stop_iid}) }
    throwInvalidIID(id)         { throw new DB.InvalidIID({id, start_iid: this.start_iid, stop_iid: this.stop_iid}) }

    validIID(id)                { return this.start_iid <= id[1] && (!this.stop_iid || id[1] < this.stop_iid) }
    checkIID(id)                { if (this.validIID(id)) return true; this.throwInvalidIID(id) }
    checkReadOnly(key)          { if (this.get('readonly')) this.throwReadOnly({key}) }
    async checkNew(id, msg)     { if (await this._read(id)) throw new Error(msg + ` [${id}]`) }

    /***  DB stacking & administration  ***/

    stack(next) {
        /* Stack `next` DB on top of this one. */
        this.nextDB = next
        next.prevDB = this
        return next
    }

    getDB(name) {
        /* Find a DB in the stack (up to this level) by its name. Return undefined if not found. */
        return this.name === name ? this : this.prevDB?.getDB(name)
    }

    async erase() {
        /* Remove all records from this database; open() should be called first.
           Subclasses should override this method but always call super.erase().
         */
        this.checkReadOnly()
        this.records.clear()
        this.curr_iid.clear()
    }

    open(opts) {
        this.start_iid = this.start_iid || 0
        this.curr_iid  = new Map()
    }

    /***  override in subclasses  ***/

    _read(key, opts)        { throw new NotImplemented() }      // return undefined if `key` not found
    _drop(key, opts)        { throw new NotImplemented() }      // return true if `key` found and deleted, false if not found
    _save(key, data, opts)  { throw new NotImplemented() }      // no return value
    *_scan(cid, opts)       { throw new NotImplemented() }      // generator of {id, data} records ordered by ID


    /***  low-level API (on encoded data)  ***/

    writable(key) {
        /* Return true if `key` is allowed to be written here. */
        return !this.get('readonly') && (key === undefined || this.validIID(key))
    }

    async find(key) {
        /* Return the top-most DB that contains the `key`, or undefined if `key` not found at any level in the database stack.
           Can be called to check if the key exists.
         */
        let data = await this._read(key)
        if (data !== undefined) return this
        if (this.prevDB) return this.prevDB.find(key)
    }

    async read(key, opts = {}) {
        /* Find the top-most occurrence of `key` in this DB or any lower DB in the stack (through .prevDB).
           If found, return a JSON-encoded data stored under the `key`; otherwise return undefined.
         */
        if (this.validIID(key)) {                               // record that doesn't satisfy IID constraints, even if exists in DB, is ignored
            let data = this._read(key, opts)
            if (data instanceof Promise) data = await data      // must await here to check for "not found" result
            if (data !== undefined) return data
        }
        if (this.prevDB) return this.prevDB.read(key, opts)
    }
    async drop(key, opts = {}) {
        /* Find and delete the top-most occurrence of `key` in this DB or a lower DB in the stack (through .prevDB).
           Return true on success, or false if the `key` was not found (no modifications done then).
         */
        if (this.writable(key)) {
            let {flush = true} = opts
            let ret = this._drop(key, opts)
            if (ret instanceof Promise) ret = await ret                 // must await here to check for "not found" result
            if (ret) {
                if (flush) await this.flush()
                return ret
            }
        }
        else if (!this.writable() && this.validIID(key) && await this._read(key))
            this.throwReadOnly({key})

        return this.prevDB ? this.prevDB.drop(key, opts) : false
    }
    save(key, data, opts = {}) {
        /* Save `data` under a `key`, regardless if `key` is already present or not. May return a Promise. No return value.
           If this db is readonly or the `key` is out of allowed range, the operation is forwarded
           to a higher-level DB (nextDB), or an exception is raised.
           If the db already contains the `id` but is readonly, this method will duplicate the same `id`
           into a higher-level db, with new `data` stored as its payload. A subsequent del() to the higher-level db
           may remove this new instance of `id`, while keeping the old one in this db, which will become
           accessible once again to subsequent get() operations (!). In this way, deleting an `id` may result
           in this id being still accessible in its older version.
         */
        if (this.writable(key)) {
            let {flush = true} = opts
            let ret = this._save(key, data, opts)
            if (ret instanceof Promise && flush) return ret.then(() => this.flush())
            return flush ? this.flush() : ret
        }
        if (this.nextDB) return this.nextDB.save(key, data, opts)
        if (!this.writable()) this.throwReadOnly({key})
        assert(!this.validIID(key))
        this.throwInvalidIID(key)
    }

    async *scan(cid) {
        /* Iterate over all records in this DB stack (if no `cid`), or over all records of a given category,
           and yield them as {id, data} objects sorted by ascending ID, with `data` being a JSON string.
         */
        if (this.prevDB) yield* merge(Item.orderAscID, this.prevDB.scan(cid), this._scan(cid))
        else yield* this._scan(cid)
    }

    /***  high-level API (on items)  ***/

    async select(id) {
        /* Similar to read(), but throws an exception when `id` not found. */
        let rec = this.read(id)
        if (rec instanceof Promise) rec = await rec
        if (rec === undefined) this.throwNotFound({id})
        return rec
    }

    async update(item, opts = {}) {
        assert(item.has_data())
        assert(item.has_id())
        return this.mutate(item.id, {type: 'data', data: item.dumpData()}, opts)
    }

    async mutate(id, edits, opts = {}) {
        /* Apply `edits` (an array or a single edit) to an item's data and store under the `id` in this database or any higher db
           that allows writing this particular `id`. if `opts.data` is missing, the record is searched for
           in the current database and below - the record's data is then used as `opts.data`, and mutate() is called
           on the containing database instead of this one (the mutation may propagate upwards back to this database, though).
           FUTURE: `edits` may contain a test for a specific item's version to apply edits to.
         */
        assert(edits, 'missing array of edits')
        if (!(edits instanceof Array)) edits = [edits]

        let {search = true} = opts      // if search=true, the containing database is searched for before writing edits; turned off during propagation phase

        // (1) find the record and its current database (this one or below) if `data` is missing
        if (search) {
            let db = await this.find(id)
            if (db === undefined) this.throwNotFound(id)
            return db.mutate(id, edits, {...opts, search: false})
        }

        let data = await this.read(id)                  // update `data` with the most recent version from db

        // (2) propagate to a higher-level db if the mutated record can't be saved here
        if (!this.writable(id))
            if (this.nextDB) return this.nextDB.mutate(id, edits, {...opts, data, search: false})
            else this.throwNotWritable(id)

        for (const edit of edits)                       // mutate `data` and save
            data = this._apply(data, edit)

        return this.save(id, data)
    }

    _apply(dataSrc, edit) {
        let {type, data} = edit
        assert(type === 'data' && data)
        return data
    }

    async insert(item, opts = {}) {
        /* High-level insert. The `item` can have an IID already assigned (then it's checked that
           this IID is not yet present in the DB), or not.
           If item.iid is missing, a new IID is assigned and stored in `item.iid` for use by the caller.
         */
        assert(item.has_data())
        assert(item.cid || item.cid === 0)
        let data = item.dumpData()
        let cid  = item.cid

        // create IID for the item if missing or use the provided IID; in any case, store `data` under the resulting ID
        if (item.iid === undefined)
            item.iid = await this.insertWithCID(cid, data, opts)
        else
            return this.insertWithIID(item.id, data, opts)
    }

    async insertWithCID(cid, data, opts) {
        /* Create a new `iid` under a given `cid` and store `data` in this newly created id=[cid,iid] record.
           If this db is readonly, forward the operation to a lower DB (prevDB), or raise an exception.
           Return the `iid`.
         */
        if (!this.writable())
            if (this.prevDB) return this.prevDB.insertWithCID(cid, data, opts)
            else this.throwReadOnly()
        let iid = this._createIID(cid)
        await this._save([cid, iid], data, opts)
        let {flush = true} = opts
        if (flush) await this.flush()
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

    async insertWithIID(id, data, opts) {
        /* Register the `id` as a new item ID in the database and store `data` under this ID. */
        if (!this.writable(id))
            if (this.prevDB) return this.prevDB.insertWithIID(id, data, opts)
            else this.throwNotWritable(id)

        await this.checkNew(id, "the item already exists")
        let [cid, iid] = id
        this.curr_iid.set(cid, Math.max(iid, this.curr_iid.get(cid) || 0))
        await this._save(id, data, opts)
        let {flush = true} = opts
        if (flush) await this.flush()
    }
    // async _assignIID(id) {
    //     /* Check if the `iid` can be assigned to a new record (doesn't exist yet) within a given category `cid`.
    //        Update this.curr_iid accordingly.
    //      */
    //     let [cid, iid] = id
    //     await this.checkNew(id, "the item already exists")
    //     this.checkIID(id)
    //     this.curr_iid.set(cid, Math.max(iid, this.curr_iid.get(cid) || 0))
    // }

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
    async open() {
        await super.open()
        let fs = this._mod_fs = await import('fs')
        let path = this._mod_path = await import('path')
        this.name = path.basename(this.filename, path.extname(this.filename))
        try {await fs.promises.writeFile(this.filename, '', {flag: 'wx'})}      // create an empty file if it doesn't exist yet
        catch(ex) {}
    }
    async erase() {
        await super.erase()
        await this._mod_fs.promises.writeFile(this.filename, '', {flag: 'w'})   // truncate the file
    }

    async flush()   { throw new NotImplemented() }

    _read(id, opts)  { return this.records.get(id) }
    _drop(id, opts)  { return this.records.delete(id) }
    _save(id, data)  { this.records.set(id, data) }

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
        let db = this._mod_YAML.parse(file) || []
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
        let out = this._mod_YAML.stringify(recs)
        return this._mod_fs.promises.writeFile(this.filename, out, 'utf8')
    }
}

/**********************************************************************************************************************/

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

