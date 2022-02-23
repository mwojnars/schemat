import {assert, BaseError, print, T} from '../utils.js'
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

class DB {
    writable  = true    // only if true, the database accepts modifications: inserts/updates/deletes
    start_IID = 0       // minimum IID of newly created items; if >0, it helps maintain separation of IDs
                        // between different underlying databases used together inside a RingDB

    constructor(params = {}) {
        let {writable = true, start_IID = 0} = params
        this.writable  = writable
        this.start_IID = start_IID
    }

    static Error = class extends BaseError {}
    static NotFound = class extends DB.Error {
        static message = "item ID not found in DB"
    }
    static NotWritable = class extends DB.Error {
        static message = "no write access to the database"
    }
    static TooLowIID = class extends DB.Error {
        static message = "found an item in DB with IID lower than expected"
    }

    throwNotFound(msg, args)        { throw new DB.NotFound(msg, args) }
    throwNotWritable(msg, args)     { throw new DB.NotWritable(msg, args) }

    checkWritable(id)               { if (!this.writable) this.throwNotWritable(id ? {id} : undefined) }
}

class ServerDB extends DB {
    async flush() { throw new Error("not implemented") }
    async insert(item, flush = true) { throw new Error("not implemented") }
    async update(item, flush = true) { throw new Error("not implemented") }
    async upsert_many(items, flush = true) {
        for (const item of items)
            if (item.newborn) await this.insert(item)
            else              await this.update(item)
        if (flush) await this.flush()
    }
}

class FileDB extends ServerDB {
    /* Items stored in a file. For use during development only. */

    filename = null
    records  = new ItemsMap()   // preloaded item records, as {key: record} pairs; keys are strings "cid:iid";
                                // values are objects {cid,iid,data}, `data` is JSON-encoded for mem usage & safety,
                                // so that clients create a new deep copy of item data on every access

    constructor(filename, params = {}) {
        super(params)
        this.filename = filename
    }

    async select(id) {
        let record = this.records.get(id)
        if (!record) this.throwNotFound({id})
        assert(record.cid === id[0] && record.iid === id[1])
        return record
    }
    async *scanCategory(cid) {
        for (const record of this.records.values())
            if (cid === record.cid) yield record
    }
}

export class YamlDB extends FileDB {
    /* Items stored in a YAML file. For use during development only. */

    max_iid = new Map()         // current maximum IIDs per category, as {cid: maximum_iid}

    async load() {
        let fs = await import('fs')
        let YAML = (await import('yaml')).default
        let file = await fs.promises.readFile(this.filename, 'utf8')
        let db = YAML.parse(file)
        this.records.clear()
        this.max_iid.clear()

        for (let record of db) {
            let id = T.pop(record, '__id')
            let [cid, iid] = id
            assert(!this.records.has(id), `duplicate item ID: ${id}`)
            if (iid < this.start_IID) throw new DB.TooLowIID({id, start_IID: this.start_IID})

            let data = '__data' in record ? record.__data : record
            let curr_max = this.max_iid.get(cid) || 0
            this.max_iid.set(cid, Math.max(curr_max, iid))
            this.records.set(id, {cid, iid, data: JSON.stringify(data)})
        }
        // print('YamlDB items loaded:')
        // for (const [id, data] of this.records)
        //     print(id, data)
    }
    async insert(...items) {
        this.checkWritable()
        await Promise.all(items.map(item => this._insert_one(item, false)))
        await this.flush()
    }
    async _insert_one(item, flush = true) {

        if (item.cid === null)
            item.cid = item.category.iid
        let cid = item.cid
        let max_iid

        if (cid === 0 && !this.max_iid.has(cid))
            max_iid = -1   // use =0 if the root category is not getting an IID here
        else
            max_iid = this.max_iid.get(cid) || 0

        let iid = item.iid = Math.max(max_iid + 1, this.start_IID)
        this.max_iid.set(cid, iid)

        assert(item.has_data())
        assert(!this.records.has(item.id), "an item with this ID already exists")

        this.records.set(item.id, {cid, iid, data: item.dumpData()})
        if (flush) await this.flush()
    }

    async update(item, flush = true) {
        assert(item.has_data())
        assert(item.has_id())
        if (!this.records.has(item.id)) this.throwNotFound({id: item.id})
        this.checkWritable(item.id)
        let [cid, iid] = item.id
        this.records.set(item.id, {cid, iid, data: item.dumpData()})
        if (flush) await this.flush()
    }
    async delete(id) {
        if (!this.records.has(id)) this.throwNotFound({id})
        this.checkWritable(id)
        this.records.delete(id)
        return this.flush()
    }

    async flush() {
        /* Save the entire database (this.records) to a file. */
        print(`YamlDB flushing ${this.records.size} items to ${this.filename}...`)
        let fs   = await import('fs')
        let YAML = (await import('yaml')).default
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

export class RingsDB extends ServerDB {
    /* Several databases used together like rings. Each read/write operation is executed
       on the outermost ring possible. If NotFound/NotWritable is caught, a deeper (lower) ring is tried.
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

        this.select = this.outermost('select')
        this.insert = this.outermost('insert')
        this.update = this.outermost('update')
        this.delete = this.outermost('delete')
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
                // if (ex instanceof DB.NotFound || ex instanceof DB.NotWritable) continue
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

export class Database extends Item {

    db          // database engine that's used to access physical database on local hardware

    // async GET_select(ctx, id) {}
    // async GET_scan(ctx, index, range) {}

    // async POST_edit({req, res}) {
    //     // let {id, path, pos, entry} = req.body
    //     let [id, edits] = req.body
    //     assert(edits instanceof Array)
    //
    //     let record = await this.db.select(id)
    //     let data   = JSON.parse(record.data)        // the data is schema-encoded
    //
    //     let item = this.registry.getLoaded(id)
    //
    //     for (let [edit, args] of edits)
    //         this[`edit_${edit}`].call(this, data, ...args)
    //
    //     let out = await this.db.update(id, data)
    //     return res.json(out)
    // }

    // edit_insert({data, path, pos, entry}) {
    //     /* Insert a data `entry` at position `pos` inside a subcatalog located at the end of a `path` of an item`s data. */
    // }
    // edit_delete(id, path) {}
    // edit_update(id, path, entry) {}
    // edit_move(id, path_src, path_dst) {}
}

export class DatabaseYaml extends Database {

    async init(data) {
        let filename = data.get('filename')
        this.db = new YamlDB(filename)
        await this.db.load()
        // print('created YamlDB in DatabaseYaml:', this.db, filename)
    }
}

