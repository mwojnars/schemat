import { assert, print, T } from '../utils.js'
import { BaseError, NotImplemented } from '../errors.js'
import { Item } from '../item.js'

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
 **  BLOCKS
 **
 */

export class Block extends Item {
    /* Continuous block of consecutive records inside a Sequence, inside the `data` or `index` of a Ring, inside a database:
           Store > Ring > Data/Index Sequence > Block > (Storage?) > Record
     */

    FLUSH_TIMEOUT = 1       // todo: make the timeout configurable and 0 by default

    autoincrement = 0       // current maximum IID; a new record is assigned iid=autoincrement+1

    ring                    // the ring this block belongs to
    dirty                   // true when the block contains unsaved modifications


    static Error = class extends BaseError          {}
    static ItemExists = class extends Block.Error   { static message = "item with this ID already exists" }

    async assertUniqueID(id, msg)                   { if (await this._select(id)) throw new Block.ItemExists(msg, {id}) }


    open(ring) {
        this.ring = ring
        this.dirty = false
    }

    async flush(timeout_sec = this.FLUSH_TIMEOUT) {
        /* The flushing is only executed if this.dirty=true. The operation can be delayed by `timeout_sec` seconds
           to combine multiple consecutive updates in one write - in such case you do NOT want to await it. */
        if (!this.dirty) return
        if (timeout_sec === 0) {
            this.dirty = false
            return this._flush()
        }
        setTimeout(() => this.flush(0), timeout_sec * 1000)
    }

    async erase() {
        /* Remove all records from this block; open() should be called first. */
        this.autoincrement = 0
        await this._erase()
        return this.flush()
    }

    async save(id, data) {
        /* Write the `data` here in this block under the `id`. No forward to another ring/block. */
        await this._save(id, data)
        this.dirty = true
        this.flush()
    }

    async notify(type, id, data = null) {
        /* Notify the ring that an item has been modified. */
        // return this.ring.notify(type, id, data)
    }


    /***  CRUD operations  ***/

    async select([db], id) {
        let data = await this._select(id)
        return data !== undefined ? data : db.forward_select([this.ring], id)
    }

    async insert([db], id, data) {
        if (id !== undefined) await this.assertUniqueID(id)                 // the uniqueness check is only needed when the ID came from the caller;
        else id = Math.max(this.autoincrement + 1, this.ring.start_iid)     // use the next available ID

        this.ring.assertValidID(id, `candidate ID for a new item is outside of the valid set for this ring`)

        this.autoincrement = Math.max(id, this.autoincrement)
        await this.save(id, data)
        await this.notify('insert', id, data)
        return id
    }

    async update([db], id, ...edits) {
        /* Check if `id` is present in this block. If not, pass the request to a lower ring.
           Otherwise, load the data associated with `id`, apply `edits` to it, and save a modified item
           in this block (if the ring permits), or forward the write request back to a higher ring.
         */
        let data = await this._select(id)
        if (data === undefined) return db.forward_update([this.ring], id, ...edits)

        for (const edit of edits)
            data = edit.process(data)

        return this.ring.writable() ? this.save(id, data) : db.forward_save([this.ring], id, data)
    }

    async delete([db], id) {
        /* Try deleting the `id`, forward to a deeper ring if the id is not present here in this block. */
        let done = this._delete(id)
        if (done instanceof Promise) done = await done
        if (done) this.dirty = true
        this.flush()
        return done ? done : db.forward_delete([this.ring], id)
    }

    /***  override in subclasses  ***/

    // these methods can be ASYNC in subclasses (!)
    _select(id)             { throw new NotImplemented() }      // return JSON-encoded `data` (a string) stored under the `id`, or undefined
    _save(id, data)         { throw new NotImplemented() }      // no return value
    _delete(id)             { throw new NotImplemented() }      // return true if `key` found and deleted, false if not found
    _erase()                { throw new NotImplemented() }
    _flush()                { throw new NotImplemented() }
    *_scan(opts)            { throw new NotImplemented() }      // generator of {id, data} records ordered by ID

}


class FileBlock extends Block {
    /* Items stored in a file. For use during development only. */

    filename = null
    records  = new Map()        // preloaded items data, {id: data_json}; JSON-ified for mem usage & safety,
                                // so that callers are forced to create a new deep copy of a data object on every access

    constructor(filename, params = {}) {
        super(params)
        this.filename = filename
    }
    async open(ring) {
        super.open(ring)
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
        entries = entries.map(([id, data]) => ({id, data}))
        entries.sort(Item.orderAscID)               // the entries must be sorted to allow correct merging over rings
        yield* entries
    }

    async *_scan_index(index_spec, {start, stop, limit, reverse=false, batch_size=100} = {}) {
        /* Scan an index `name` in the range [`start`, `stop`) and yield the results.
           If `limit` is defined, yield at most `limit` items.
           If `reverse` is true, scan in the reverse order.
           If `batch_size` is defined, yield items in batches of `batch_size` items.
         */

    }
}

export class YamlBlock extends FileBlock {
    /* Items stored in a YAML file. For use during development only. */

    async open(ring) {
        await super.open(ring)
        this._mod_YAML = (await import('yaml')).default

        let file = this._mod_fs.readFileSync(this.filename, 'utf8')
        let records = this._mod_YAML.parse(file) || []

        this.autoincrement = 0
        this.records.clear()

        for (let record of records) {
            let id = T.pop(record, '__id')

            this.ring.assertValidID(id, `item ID loaded from ${this.filename} is outside the valid bounds for this ring`)
            await this.assertUniqueID(id, `duplicate item ID loaded from ${this.filename}`)

            this.autoincrement = Math.max(this.autoincrement, id)

            let data = '__data' in record ? record.__data : record
            this.records.set(id, JSON.stringify(data))
        }
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
