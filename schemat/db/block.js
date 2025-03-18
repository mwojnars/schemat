import {assert, print, T, zip, amap, sleep, utc, joinPath} from '../common/utils.js'
import {DataAccessError, DataConsistencyError, ObjectNotFound} from '../common/errors.js'
import {WebObject} from '../core/object.js'
import {Struct} from "../core/catalog.js";
import {MemoryStorage, JsonIndexStorage, YamlDataStorage} from "./storage.js";
import {Agent} from "../server/agent.js";


/**********************************************************************************************************************
 **
 **  BLOCKS
 **
 */

export class Block extends Agent {
    /* A continuous subrange of key-value records of a data/index sequence, physically located on a single machine.
       A unit of data replication, distribution and concurrency. Records are arranged by key using byte order.
     */

    sequence                // parent sequence
    filename                // path to a local file or folder on the worker node where this block is stored
    format                  // storage format, e.g. "data-yaml", "index-jl", "rocksdb", ...

    _storage                // Storage for this block's records
    // __meta.pending_flush = false  // true when a flush() is already scheduled to be executed after a delay

    get ring()      { return this.sequence.ring }
    get stream()    { return this.sequence.stream }

    __new__(sequence, {filename, format, node} = {}) {
        sequence.assert_active()
        this.sequence = sequence
        this.filename = filename
        this.format = format
        this.__node = node
    }

    async __setup__() {
        print('Block.__setup__() ...')
        if (!this.sequence.is_loaded()) await this.sequence.load()
        if (!this.ring.is_loaded()) await this.ring.load()
        // if (this.stream && !this.stream?.is_loaded()) await this.stream.load()

        this.__node ??= schemat.node
        this.filename ??= this._create_filename()

        print('Block.__setup__() done, filename', this.filename)
    }

    _create_filename() {
        let parts = [
            this.ring.file_prefix,
            this.sequence.file_prefix || this.sequence.operator?.file_prefix || this.sequence.operator?.name,
            `${this.id}`,
            this._file_extension()
        ]
        return joinPath(this.__node.data_directory, parts.filter(Boolean).join('.'))
    }

    _file_extension() {
        if (this.format === 'data-yaml') return 'yaml'
        if (this.format === 'index-jl') return 'jl'
        if (this.format === 'rocksdb') return ''
        throw new Error(`unknown storage type '${this.format}' in [${this.__id}]`)
    }

    async __init__() {
        if (CLIENT) return                                          // don't initialize internals when on client
        if (!this.sequence.is_loaded()) this.sequence.load()        // intentionally not awaited to avoid deadlock: sequence loading may try to read from this block;
            // assert(this.sequence.__meta.loading)                    // it's assumed that .sequence gets fully loaded before any CRUD operation (ins/upd/del) is executed

        let storage_class = this._detect_storage_class()
        this._storage = new storage_class(this.filename, this)
        return this._reopen(this._storage)
    }

    _detect_storage_class() {
        let format = this.format
        if (!format) {
            // infer the storage type from the filename extension
            let extension = this.filename.split('.').pop()
            if (extension === 'yaml') format = 'data-yaml'
            if (extension === 'jl')   format = 'index-jl'
        }

        if      (format === 'data-yaml') return YamlDataStorage
        else if (format === 'index-jl')  return JsonIndexStorage
        else
            throw new Error(`unsupported storage type '${format}' in [${this.__id}] for ${this.filename}`)
    }

    async __start__() {
        let storage_class = this._detect_storage_class()
        let storage = new storage_class(this.filename, this)
        await this._reopen(storage)
        // return storage.open()
        return {storage}
    }

    async _reopen(storage) {
        /* Temporary solution for reloading block data to pull changes written by another worker. */
        if (!storage.dirty) return storage.open()
        let ref = schemat.registry.get_object(this.id)
        if (!ref || this === ref)
            return sleep(1000).then(() => this._reopen(storage))
    }

    // async get({key})   { return this._storage.get(key) }

    'remote.put'(ctx, key, value) { return this.put(key, value) }
    'remote.del'(ctx, key, value) { return this.del(key, value) }

    async put(key, value) {
        /* Write the [key, value] pair here in this block and propagate the change to derived indexes.
           No forward of the request to another ring.
         */
        // let value_old = await this._storage.get(key) || null
        await this._storage.put(key, value)
        this._flush()
        // await this.propagate(key, value_old, value)
    }

    async del(key, value) {
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
            if (this.__meta.pending_flush) return
            this.__meta.pending_flush = true
            return setTimeout(() => this._flush(false), delay * 1000)
        }
        this.__meta.pending_flush = false
        return this._storage.flush()
    }

    // propagate() {
    //     /* For now, there's NO propagation from index blocks, only from data blocks (see below). */
    // }
}


/**********************************************************************************************************************/

export class DataBlock extends Block {
    /* A Block that stores objects and provides the "insert" operation. */


    _autoincrement = 1      // current maximum ID of records in this block; a new record is assigned id=_autoincrement+1 unless insert_mode='compact';
                            // transient field: NOT saved in the block's configuration in DB but re-initialized during block instantiation

    // persistent properties
    insert_mode             // if `compact`, new objects are inserted at the lowest possible ID in the block, possibly below _autoincrement; requires MemoryStorage


    async __init__() {
        this._autoincrement = await super.__init__() || 1
        this._reserved = new Set()      // IDs that were already assigned during insert(), for proper handling of "compact" insertion
    }

    async assert_unique(id, msg) {
        let key = this._encode_id(id)
        if (await this._storage.get(key))
            throw new DataConsistencyError(msg || "record with this ID already exists", {id})
    }

    _encode_id(id) { return this.sequence.encode_id(id) }
    decode_id(key) { return this.sequence.decode_id(key) }

    _annotate(json) {
        /* Append metadata (__meta) with ring & block ID to the JSON content of an object retrieved during select/update. */
        let plain = JSON.parse(json)
        plain.__meta = {ring: this.ring.id, block: this.id}
        return JSON.stringify(plain)
    }

    _move_down(id, req) {
        /* Return lower ring and update `req` before forwarding a select/update/delete operation downwards to the lower ring. */
        let ring = this.ring
        let lower = ring.lower_ring
        if (!lower) throw new ObjectNotFound(null, {id})
        req.push_ring(ring)
        return lower
    }

    _move_up(req) {
        /* Return the first writable ring that's above this one and update `req` before forwarding a write phase of an object update.
           Called after the 1st phase of update which consisted of top-down search for the ID in the stack of rings.
           No need to check for the ID validity here, because ID ranges only apply to inserts, not updates.
         */
        let ring = this.ring
        while (ring?.readonly) ring = req.pop_ring()        // go upwards to find the first writable ring
        if (!ring) throw new DataAccessError(`can't save an updated object, the ring(s) are read-only`, {id: req.id})
        return ring
    }

    async 'remote.select'(_, id, req) { return this._select(id, req) }

    async _select(id, req) {
        let key = this._encode_id(id)
        let data = await this._storage.get(key)         // JSON string
        if (data) return this._annotate(data)
        return this._move_down(id, req).select(id, req)
    }

    async cmd_insert(id, data) {
        /* `data` can be an array if multiple objects are to be inserted. */

        let ring = this.ring
        assert(ring?.is_loaded())
        if (ring.readonly) throw new DataAccessError(`cannot insert into a read-only ring [${ring.id}]`)

        // convert scalar arguments to an array
        let batch = (data instanceof Array)
        if (!batch) data = [data]

        let records = data.map(d => ({data: d}))        // {id, data, obj} tuples that await ID assignment + setup
        let objects = []

        if (batch) assert(!id)
        else if (id) {
            await this.assert_unique(id)                // fixed ID provided by the caller? check for uniqueness
            records[0].id = id
        }

        // assign IDs to the initial group of objects, as they may be referenced from other objects via provisional IDs;
        // every object is instantiated for validation, but is not activated: __init__() & _activate() are NOT executed (performance)
        for (let rec of records) {
            let {id, data} = rec
            let obj = await WebObject.from_data(id || this._assign_id(), data, {mutable: true, activate: false})
            objects.push(obj)
        }
        let unique = new Set(objects)

        // replace provisional IDs with references to proper objects having ultimate IDs assigned
        let prov
        let rectify = (ref) => (ref instanceof WebObject && (prov = ref.__provisional_id) ? objects[prov-1] : undefined)
        for (let obj of objects)
            Struct.transform(obj.__data, rectify)

        // go through all the objects:
        // - assign ID & instantiate the web object (if not yet instantiated)
        // - call __setup__(), which may create new related objects (!) that are added to the queue

        for (let pos = 0; pos < objects.length; pos++) {
            let obj = objects[pos]
            obj.__id ??= this._assign_id()

            let setup = obj.__setup__({ring: this.ring, block: this})
            if (setup instanceof Promise) await setup

            // find all unseen newborn references and add them to the queue
            obj.__references.forEach(ref => {
                if (ref.is_newborn() && !unique.has(ref)) { objects.push(ref); unique.add(ref) }
            })
        }
        // print(`[${this.id}].cmd_insert() saving ${objects.length} object(s)`)

        for (let obj of objects) {
            this._prepare_for_insert(obj)       // validate obj.__data
            await this._save(obj)
        }

        // await Promise.all(objects.map(obj => {}))

        let ids = objects.map(obj => obj.id)
        // print(`[${this.id}].cmd_insert() saved IDs:`, ids)

        return batch ? ids.slice(0, data.length) : ids[0]
    }

    _prepare_for_insert(obj) {
        obj.__data.delete('__ver')          // just in case, it's forbidden to pass __ver from the outside
        obj.validate()                      // data validation
        obj._bump_version()                 // set __ver=1 if needed
        obj._seal_dependencies()            // set __seal
    }

    _assign_id() {
        /* Calculate a new `id` to be assigned to the record being inserted. */
        // TODO: auto-increment `key` not `id`, then decode up in the sequence
        let ring = this.ring
        let id = (this.insert_mode === 'compact' && !this._reserved.has(this._autoincrement))
                    ? this._assign_id_compact()
                    : Math.max(this._autoincrement + 1, ring.min_id_exclusive)
        if (!ring.valid_id(id)) throw new DataAccessError(`candidate ID=${id} for a new object is outside of the valid range(s) for the ring [${ring.id}]`)

        this._reserved.add(id)
        this._autoincrement = Math.max(id, this._autoincrement)

        // print(`DataBlock._assign_id(): assigned id=${id} at process pid=${process.pid} block.__hash=${this.__hash}`)
        return id
    }

    _assign_id_compact() {
        /* Scan this._storage to find the first available `id` for the record to be inserted, starting at ring.min_id_exclusive.
           This method of ID generation has performance implications (O(n) complexity), so it can only be used with MemoryStorage.
         */
        if (!(this._storage instanceof MemoryStorage))
            throw new Error('Compact insert mode is only supported with MemoryStorage')

        let ring = this.ring
        let gap  = ring.min_id_exclusive

        for (let [key, value] of this._storage.scan()) {
            let id = this.decode_id(key)
            if (id + 1 < ring.min_id_exclusive) continue    // skip records outside the ring's validity range
            while (gap < id)                                // found a gap before `id`? return it unless already reserved
                if (this._reserved.has(gap)) gap++
                else return gap
            gap = id + 1
        }
        return this._autoincrement + 1          // no gaps found, return the next ID after the last record
    }

    // _reclaim_id(...ids)

    async cmd_update(id, edits, req) {
        /* Check if `id` is present in this block. If not, pass the request to a lower ring.
           Otherwise, load the data associated with `id`, apply `edits` to it, and save a modified item
           in this block (if the ring permits), or forward the write request back to a higher ring. Return {id, data}.
         */
        let key = this._encode_id(id)
        let data = await this._storage.get(key)
        if (data === undefined) return this._move_down(id, req).update(id, edits, req)

        let prev = await WebObject.from_data(id, data, {mutable: false, activate: false})
        let obj  = await WebObject.from_data(id, data, {mutable: true,  activate: false})   // TODO: use prev.clone() to avoid repeated async initialization

        obj._apply_edits(...edits)                  // apply edits; TODO SECURITY: check if edits are safe; prevent modification of internal props (__ver, __seal etc)
        await obj._initialize(false)                // reinitialize the dependencies (category, class, ...) WITHOUT sealing! they may have been altered by the edits

        obj.validate()                              // validate object properties: each one individually and all of them together; may raise exceptions
        obj._bump_version()                         // increment __ver
        obj._seal_dependencies()                    // recompute __seal

        if (obj.__base?.save_revisions)
            await obj._create_revision(data)        // create a Revision (__prev) to hold the previous version of `data`

        if (this.ring.readonly)                     // can't write the update here in this ring? forward to the first higher ring that's writable
            return this._move_up(req).upsave(id, obj.__json, req)

            // saving to a higher ring is done OUTSIDE the mutex and a race condition may arise, no matter how this is implemented;
            // for this reason, the new `data` can be computed already here and there's no need to forward the raw edits
            // (applying the edits in an upper ring would not improve anything in terms of consistency and mutual exclusion)

        return this._save(obj, prev)                // save changes and perform change propagation
    }

    async cmd_upsave(id, data, req) {
        /* Update, or insert an updated object, after the request `req` has been forwarded to a higher ring. */
        let key = this._encode_id(id)
        if (await this._storage.get(key))
            throw new DataConsistencyError('newly-inserted object with same ID discovered in a higher ring during upward pass of update', {id})

        // // if `id` is already present in this ring, redo the update (apply `edits` again) instead of overwriting
        // // the object with the `data` calculated in a previous ring
        // if (await this._storage.get(key)) return this.cmd_update(req)

        let obj = await WebObject.from_data(id, data, {activate: false})
        return this._save(obj)
    }

    async _save(obj, prev = null) {
        let id = obj.id
        let data = obj.__json
        let key = this._encode_id(id)

        await this.put(key, data)
        await this.propagate_change(key, prev, obj)

        data = this._annotate(data)
        schemat.register_modification({id, data})
    }

    async cmd_delete(id, req) {
        /* Try deleting the `id`, forward to a lower ring if the id is not present here in this block.
           Log an error if the ring is read-only and the `id` is present here.
         */
        let key = this._encode_id(id)
        let data = await this._storage.get(key)
        if (data === undefined) return this._move_down(id, req).delete(id, req)

        if (this.ring.readonly)
            // TODO: find the first writable ring upwards from this one and write a tombstone for `id` there
            throw new DataAccessError("cannot remove the item, the ring is read-only", {id})
            // return req.error_access("cannot remove the item, the ring is read-only")

        let obj = await WebObject.from_data(id, data, {activate: false})
        let deleted = this._storage.del(key)
        if (!deleted) return 0

        this._flush()
        await this.propagate_change(key, obj)

        // data.set('__status', 'DELETED')
        schemat.register_modification({id, data: {'__status': 'DELETED'}})

        assert(Number(deleted) === 1)
        return Number(deleted)
    }

    async erase() {
        /* Remove all records from this sequence; open() should be called first. */
        this._autoincrement = 1
        this._reserved = new Set()
        return super.erase()
    }

    async propagate_change(key, obj_old = null, obj_new = null) {
        /* Push a change from this data block to all derived streams in the ring. */
        assert(this.ring?.is_loaded())
        for (let seq of this.ring.sequences)            // of this.sequence.derived
            seq.apply_change(key, obj_old, obj_new)     // no need to await, the result is not used by the caller
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

