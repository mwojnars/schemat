import {assert, print, T, zip, amap} from '../common/utils.js'
import {DataAccessError, DataConsistencyError} from '../common/errors.js'
import {WebObject} from '../core/object.js'
import {Struct} from "../core/catalog.js";
import {MemoryStorage, JsonIndexStorage, YamlDataStorage} from "./storage.js";
import {KafkaAgent} from "../server/kafka.js";

// import { Kafka } from 'kafkajs'


/**********************************************************************************************************************
 **
 **  BLOCKS
 **
 */

export class Block extends KafkaAgent {
    /* A continuous subrange of key-value records of a data/index sequence, physically located on a single machine.
       A unit of data replication, distribution and concurrency. Records are arranged by key using byte order.
     */
    static role = 'block'   // for use in ProcessingStep and DataRequest

    sequence                // parent sequence
    filename                // path to a local file or folder on the worker node where this block is stored
    format                  // storage format, e.g. "data-yaml", "index-jl", "rocksdb", ...

    // worker               // worker node that contains the block's file; only at this node the block runs in the "server" mode
    
    _storage                // Storage for this block's records
    _pending_flush = false  // true when a flush() is already scheduled to be executed after a delay

    get ring()      { return this.sequence.ring }
    get stream()    { return this.sequence.stream }

    __new__(sequence, filename) {
        sequence.assert_active()
        this.sequence = sequence
        this.filename = filename
    }

    async __init__() {
        if (CLIENT) return                                          // don't initialize internals when on client
        if (!this.sequence.is_loaded()) //this.sequence.load()      // intentionally not awaited to avoid deadlock: sequence loading may try to read from this block;
            assert(this.sequence.__meta.loading)                    // it's assumed that .sequence gets fully loaded before any CRUD operation (ins/upd/del) is executed

        let format = this.format
        let storage_class

        // infer the storage type from the filename extension
        if (!format) {
            let extension = this.filename.split('.').pop()
            if (extension === 'yaml') format = 'data-yaml'
            if (extension === 'jl')   format = 'index-jl'
        }

        if      (format === 'data-yaml') storage_class = YamlDataStorage
        else if (format === 'index-jl')  storage_class = JsonIndexStorage
        else
            throw new Error(`[${this.__id}] unsupported storage type, '${format}', for ${this.filename}`)

        this._storage = new storage_class(this.filename, this)
        return this._reopen()
        // return this._storage.open()
    }

    _reopen() {
        /* Temporary solution for reloading block data to pull changes written by another worker. */
        if (!this._storage.dirty) return this._storage.open()
        let ref = schemat.registry.get_object(this.id)
        if (!ref || this === ref)
            setTimeout(() => this._reopen(), 1000)
    }

    async cmd_get(req)      { return this._storage.get(req.args.key) }

    async cmd_put(req) {
        /* Write the [key, value] pair here in this block and propagate the change to derived indexes.
           No forward of the request to another ring.
         */
        let {key, value} = req.args                     // handle 'value' arg instead of 'data'?
        return this._put(key, value)
    }

    async _put(key, value) {
        // let value_old = await this._storage.get(key) || null
        await this._storage.put(key, value)
        this._flush()
        // await this.propagate(key, value_old, value)
    }

    async cmd_del(req) {
        let {key, value} = req.args                     // `value` is needed for change calculation & propagation

        if (value === undefined) value = await this._storage.get(key)
        if (value === undefined) return false           // TODO: notify about data inconsistency (there should no missing records)

        let deleted = this._storage.del(key)
        this._flush()
        // await this.propagate(key, value)

        return deleted
    }

    async *scan(opts = {}) { yield* this._storage.scan(opts) }

    async erase() {
        /* Remove all records from this block. */
        await this._storage.erase()
        return this._flush()
    }

    async flush() { return this._flush(false) }

    _flush(with_delay = true) {
        /* Flush all unsaved modifications to disk. If with_delay=true, the operation is delayed by `flush_delay`
           seconds (configured in the parent sequence) to combine multiple consecutive updates in one write
           - in such case you do NOT want to await the result.
         */
        let delay = this.sequence.flush_delay

        if (with_delay && delay) {
            if (this._pending_flush) return
            this._pending_flush = true
            return setTimeout(() => this._flush(false), delay * 1000)
        }
        this._pending_flush = false
        return this._storage.flush()
    }

    // propagate() {
    //     /* For now, there's NO propagation from index blocks, only from data blocks (see below). */
    // }
}


/**********************************************************************************************************************/

export class DataBlock extends Block {
    /* A Block that stores objects and provides the "insert" operation. */

    static __category = 19

    _autoincrement = 1      // current maximum ID of records in this block; a new record is assigned id=_autoincrement+1 unless insert_mode='compact';
                            // transient field: NOT saved in the block's configuration in DB but re-initialized during block instantiation

    // persistent properties
    insert_mode             // if `compact`, new objects are inserted at the lowest possible ID in the block, possibly below _autoincrement; requires MemoryStorage


    async __init__() {
        this._autoincrement = await super.__init__() || 1
    }

    async assert_unique(id, msg) {
        let key = this.sequence.encode_key(id)
        if (await this._storage.get(key))
            throw new DataConsistencyError(msg || "record with this ID already exists", {id})
    }

    _annotate(json) {
        /* Append metadata (__meta) with ring & block ID to the JSON content of an object retrieved during select/update. */
        let plain = JSON.parse(json)
        plain.__meta = {ring: this.ring.id, block: this.id}
        return JSON.stringify(plain)
    }

    async cmd_select(req) {
        let data = await this._storage.get(req.args.key)    // JSON string
        if (!data) return req.forward_down()
        return this._annotate(data)
    }

    async cmd_insert(req) {
        let ring = this.ring
        assert(ring?.is_loaded())

        if (ring.readonly) throw new DataAccessError(`cannot insert into a read-only ring [${ring.id}]`)
        let {id, data} = req.args
        let batch = (data instanceof Array)

        // if (typeof data === 'string') data = JSONx.parse(data)
        if (data instanceof Array) assert(!id)
        else {
            if (id) await this.assert_unique(id)        // fixed ID provided by the caller? check for uniqueness
            id = id ? [id] : null
            data = [data]
        }

        id ??= this._reserve_id(data.length)            // assign IDs to all new objects
        data = this._transform_provisional(id, data)

        let pairs = zip(id, data)
        await amap(pairs, pair => this._insert_one(...pair))    // TODO: save all objects at once, atomically

        return batch ? id : id[0]
    }

    _transform_provisional(ids, data) {
        /* Transform `data` of every object so that provisional IDs (-1, -2, ...) are replaced with the actual IDs. */
        let stubs = ids.map(id => WebObject.stub(id))
        let prov
        let f = (obj) => (obj instanceof WebObject && (prov = obj.__provisional_id) ? stubs[prov-1] : undefined)
        return data.map(d => Struct.transform(d, f))
    }

    async _insert_one(id, data) {
        // the object must be instantiated for validation, but is not activated (for performance): neither __init__() nor _activate() is executed
        let obj = await WebObject.from_data(id, data, {mutable: true, activate: false})

        obj.__data.delete('__ver')          // just in case, it's forbidden to pass __ver from the outside
        obj.validate()                      // data validation
        obj._bump_version()                 // set __ver=1 if needed
        obj._seal_dependencies()            // set __seal

        return this._save(obj)              // save the object and perform change propagation
    }

    _reserve_id(count) {
        // call _assign_id() `count` times and return an array of `count` IDs
        return Array.from({length: count}, () => this._assign_id())
    }

    // _reclaim_id(...ids)

    _assign_id() {
        /* Calculate a new `id` to be assigned to the record being inserted. */
        // TODO: auto-increment `key` not `id`, then decode up in the sequence
        // id = this.schema.decode_key(new_key)[0]
        let ring = this.ring
        let id = (this.insert_mode === 'compact') ? this._assign_id_compact() : Math.max(this._autoincrement + 1, ring.start_id)
        if (!ring.valid_id(id)) throw new DataAccessError(`candidate ID=${id} for a new object is outside of the valid range(s) for the ring [${ring.id}]`)
        this._autoincrement = Math.max(id, this._autoincrement)
        return id
    }

    _assign_id_compact() {
        /* Scan this._storage to find the first available `id` for the record to be inserted, starting at ring.start_id.
           This method of ID generation has performance implications (O(n) complexity), so it can only be used with MemoryStorage.
         */
        if (!(this._storage instanceof MemoryStorage))
            throw new Error('Compact insert mode is only supported with MemoryStorage')

        let seq  = this.sequence
        let ring = seq.ring
        let next = ring.start_id

        for (let [key, value] of this._storage.scan()) {
            let id = seq.decode_key(key)
            if (id < ring.start_id) continue            // skip records outside the current ring's range
            if (id > next) return next                  // found a gap? return the first available ID
            next = id + 1
        }
        return next                                     // no gaps found, return the next ID after the last record
    }

    async cmd_update(req) {
        /* Check if `id` is present in this block. If not, pass the request to a lower ring.
           Otherwise, load the data associated with `id`, apply `edits` to it, and save a modified item
           in this block (if the ring permits), or forward the write request back to a higher ring. Return {id, data}.
         */
        let {id, key, edits} = req.args
        let data = await this._storage.get(key)
        if (data === undefined) return req.forward_down()

        let prev = await WebObject.from_data(id, data, {mutable: false, activate: false})
        let obj  = await WebObject.from_data(id, data, {mutable: true,  activate: false})   // TODO: use prev.clone() to avoid repeated async initialization

        obj._apply_edits(...edits)                  // apply edits; TODO SECURITY: check if edits are safe; prevent modification of internal props (__ver, __seal etc)
        await obj._initialize(false)                // reinitialize the dependencies (category, class, ...) WITHOUT sealing! they may have been altered by the edits

        obj.validate()                              // validate object properties: each one individually and all of them together; may raise exceptions
        obj._bump_version()                         // increment __ver
        obj._seal_dependencies()                    // recompute __seal

        if (obj.__base?.save_revisions)
            await obj._create_revision(data)        // create a Revision (__prev) to hold the previous version of `data`

        if (this.ring.readonly) {                   // can't write the update here in this ring? forward to a higher ring
            req = req.make_step(this, 'save', {id, key, data: obj.__json})
            return req.forward_save()
            // saving to a higher ring is done OUTSIDE the mutex and a race condition may arise, no matter how this is implemented;
            // for this reason, the new `data` can be computed already here and there's no need to forward the raw edits
            // (applying the edits in an upper ring would not improve anything in terms of consistency and mutual exclusion)
        }
        return this._save(obj, prev)                // save changes and perform change propagation
    }

    async cmd_save(req) {
        /* Update, or insert an updated object, after the request `req` has been forwarded to a higher ring. */
        let {id, key, data} = req.args

        // if `id` is already present in this ring, redo the update (apply `edits` again) instead of overwriting
        // the object with the `data` calculated in a previous ring
        if (await this._storage.get(key)) return this.cmd_update(req)

        let obj = await WebObject.from_data(id, data, {activate: false})
        return this._save(obj)
    }

    async _save(obj, prev = null) {
        let id = obj.id
        let data = obj.__json
        let key = this.sequence.encode_key(id)

        await this._put(key, data)
        await this.propagate_change(key, prev, obj)

        data = this._annotate(data)
        schemat.register_modification({id, data})
    }

    async cmd_delete(req) {
        /* Try deleting the `id`, forward to a lower ring if the id is not present here in this block.
           Log an error if the ring is read-only and the `id` is present here.
         */
        let {key} = req.args
        let data = await this._storage.get(key)
        if (data === undefined) return req.forward_down()

        if (this.ring.readonly) return req.error_access("cannot remove the item, the ring is read-only")

        let id = this.sequence.decode_key(key)
        let obj = await WebObject.from_data(id, data, {activate: false})

        let deleted = this._storage.del(key)
        if (!deleted) return 0

        this._flush()
        await this.propagate_change(key, obj)

        // data.set('__status', 'DELETED')
        schemat.register_modification({id, data: {'__status': 'DELETED'}})

        assert(Number(deleted) === 1)
        return Number(deleted)

        // req = req.make_step(this, null, {key, value: data})
        // return this.cmd_del(req)                    // perform the delete
    }

    async erase(req) {
        /* Remove all records from this sequence; open() should be called first. */
        this._autoincrement = 1
        return super.erase(req)
    }

    async propagate_change(key, obj_old = null, obj_new = null) {
        /* Push a change from this data block to all derived streams in the ring. */
        assert(this.ring?.is_loaded())
        for (let stream of this.ring.streams.values())  // of this.stream.derived
            stream.change(key, obj_old, obj_new)            // no need to await, the result is not used by the caller
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

