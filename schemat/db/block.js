import {assert, print, T, zip, amap, sleep, utc, joinPath, arrayFromAsync, isPromise} from '../common/utils.js'
import {DataAccessError, DataConsistencyError, ObjectNotFound} from '../common/errors.js'
import {Shard} from "../common/structs.js";
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

    sequence        // parent sequence
    format          // storage format, e.g. "data-yaml", "index-jl", "rocksdb", ...
    file_name       // name of the local file/directory of this block, without a path; initialized during block creation, takes the same value on every node

    // __meta.pending_flush = false  // true when a flush() is already scheduled to be executed after a delay

    get ring()      { return this.sequence.ring }

    __new__(sequence, {format} = {}) {
        sequence.assert_active()
        this.sequence = sequence
        this.format = format
    }

    async __setup__() {
        print('Block.__setup__() ...')
        if (!this.sequence.is_loaded()) await this.sequence.load()
        if (!this.ring.is_loaded()) await this.ring.load()

        this.file_name ??= this._make_file_name()

        print('Block.__setup__() done, file_name', this.file_name)
    }

    _make_file_name() {
        let parts = [
            this.ring.file_tag,
            this.sequence.file_tag || this.sequence.operator?.file_tag || this.sequence.operator?.name,
            `${this.id}`,
            this._file_extension()
        ]
        return parts.filter(p => p).join('.')
    }

    _file_extension() {
        if (this.format === 'data-yaml') return 'yaml'
        if (this.format === 'index-jl') return 'jl'
        if (this.format === 'rocksdb') return ''
        throw new Error(`unknown storage type '${this.format}' in [${this.id}]`)
    }

    async __init__() {
        if (CLIENT) return              // don't initialize internals when on client

        if (!this.sequence.is_loaded())
            await this.sequence.load()
            // {this.sequence.load(); await sleep()}
            // if (schemat.booting) {this.sequence.load(); await sleep()} else await this.sequence.load()

        // if (!this.sequence.is_loaded() && !this.sequence.__meta.loading)
        //     this.sequence.load()        // intentionally not awaited to avoid deadlock: sequence loading may try to read from this block (!);
        //                                 // it's assumed that `sequence` WILL get fully loaded before any CRUD operation (ins/upd/del) starts
    }

    _detect_storage_class() {
        let format = this.format
        if (!format) {
            // infer the storage type from the file extension
            let extension = this.file_path.split('.').pop()
            if (extension === 'yaml') format = 'data-yaml'
            if (extension === 'jl')   format = 'index-jl'
        }

        if      (format === 'data-yaml') return YamlDataStorage
        else if (format === 'index-jl')  return JsonIndexStorage
        else
            throw new Error(`unsupported storage type '${format}' in [${this.id}] for ${this.file_path}`)
    }

    encode_key(key) { return this.sequence.encode_key(key) }
    decode_key(bin) { return this.sequence.decode_key(bin) }

    // absolute path to this block's local folder/file on the current node; the upper part of the path may vary between nodes
    get file_path() { return `${schemat.node.file_path}/${this.file_name}` }

    async __start__() {
        let storage_class = this._detect_storage_class()
        let storage = new storage_class(this.file_path, this)
        let autoincrement = await this._reopen(storage)
        // return storage.open()
        return {storage, autoincrement}
    }

    async _reopen(storage) {
        /* Temporary solution for reloading block data to pull changes written by another worker. */
        // if (!this.sequence.is_loaded()) await this.sequence.__meta.loading
        if (!storage.dirty) return storage.open()
        let ref = schemat.registry.get_object(this.id)
        if (!ref || this === ref)
            return sleep(1.0).then(() => this._reopen(storage))
    }

    async '$agent.put'({storage}, key, value) { return this.put(storage, key, value) }

    async put(storage, key, value) {
        /* Write the [key, value] pair here in this block and propagate the change to derived indexes.
           No forward of the request to another ring.
         */
        await storage.put(key, value)
        this._flush(storage)
    }

    async '$agent.del'({storage}, key, value) {
        if (value === undefined) value = await storage.get(key)
        if (value === undefined) return false           // TODO: notify about data inconsistency (there should be no missing records)

        let deleted = storage.del(key)
        this._flush(storage)
        return deleted
    }

    async '$agent.scan'({storage}, opts = {}) {
        return arrayFromAsync(storage.scan(opts))       // TODO: return batches with a hard upper limit on their size
    }

    async '$agent.erase'({storage}) {
        /* Remove all records from this block. */
        await storage.erase()
        this._flush(storage)
    }

    async '$agent.flush'({storage}) { return this._flush(storage, false) }

    _flush(storage, with_delay = true) {
        /* Flush all unsaved modifications to disk. If with_delay=true, the operation is delayed by `flush_delay`
           seconds (configured in the parent sequence) to combine multiple consecutive updates in one write
           - in such case you do NOT want to await the result.
         */
        let delay = this.sequence.flush_delay

        if (with_delay && delay) {
            if (this.__meta.pending_flush) return
            this.__meta.pending_flush = true
            return setTimeout(() => this._flush(storage, false), delay * 1000)
        }
        this.__meta.pending_flush = false
        return storage.flush()
    }

    // propagate() {
    //     /* For now, there's NO propagation from index blocks, only from data blocks (see below). */
    // }
}


/**********************************************************************************************************************/

export class DataBlock extends Block {
    /* A Block that stores objects and provides the "insert" operation. */

    // properties
    shard

    _autoincrement = 1      // current maximum ID of records in this block; a new record is assigned id=_autoincrement+1 unless insert_mode='compact';
                            // transient field: NOT saved in the block's configuration in DB but re-initialized during block instantiation

    get shard_combined() {
        if (this.shard && this.ring.shard3) return Shard.intersection(this.shard, this.ring.shard3)
        return this.shard || this.ring.shard3
    }


    __new__(sequence, {shard, ...opts} = {}) {
        super.__new__(sequence, opts)
        this.shard = shard || new Shard(0, 1)       // shard 0/1 represents the full set of ID numbers: x===0 (mod 1)
    }

    async __init__() {
        this._autoincrement = await super.__init__() || 1
        // await super.__init__()
        this._reserved = new Set()      // IDs that were already assigned during insert(), for correct "compact" insertion of many objects at once
    }

    encode_id(id)  { return this.sequence.encode_id(id) }
    decode_id(key) { return this.sequence.decode_id(key) }

    _annotate(json) {
        /* Append metadata (__meta) with ring & block ID to the JSON content of an object retrieved during select/update. */
        let plain = JSON.parse(json)
        plain.__meta = {ring: this.ring.id, block: this.id}
        return JSON.stringify(plain)
    }

    _move_down(id, req) {
        /* Return lower ring and update `req` before forwarding a select/update/delete operation downwards to the lower ring. */
        // this._print(`_move_down() id=${id}`)
        let ring = this.ring
        assert(ring.is_loaded())
        let base = ring.base_ring
        if (!base) throw new ObjectNotFound(null, {id})
        req.push_ring(ring)
        return base
    }

    _move_up(req) {
        /* Return the first writable ring that's above this one and update `req` before forwarding a write phase of an object update.
           Called after the 1st phase of update which consisted of top-down search for the ID in the stack of rings.
           No need to check for the ID validity here, because ID ranges only apply to inserts, not updates.
         */
        let ring = this.ring
        assert(ring.is_loaded())
        while (ring?.readonly) ring = req.pop_ring()        // go upwards to find the first writable ring
        if (!ring) throw new DataAccessError(`can't save an updated object, the ring(s) are read-only`, {id: req.id})
        return ring
    }

    async '$agent.select'({storage}, id, req) {
        let key = this.encode_id(id)
        let data = await storage.get(key)         // JSON string
        if (data) return this._annotate(data)
        return await this._move_down(id, req).select(id, req)
    }

    async '$agent.insert'(state, data, opts = {}) {
        /* `data` can be an array if multiple objects are to be inserted. */
        // this._print(`before $agent.insert(), schemat.tx=${JSON.stringify(schemat.tx)}`)

        let {id} = opts         // optional target ID to be assigned to the new object
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
            let key = this.encode_id(id)                // fixed ID provided by the caller? check for uniqueness
            if (await state.storage.get(key)) throw new DataConsistencyError(`record with this ID already exists`, {id})
            records[0].id = id
        }

        // assign IDs to the initial group of objects, as they may be referenced from other objects via provisional IDs;
        // every object is instantiated for validation, but is not activated: __init__() & _activate() are NOT executed (performance)
        for (let rec of records) {
            let {id, data} = rec
            let obj = await WebObject.from_data(id || this._assign_id(state, opts), data, {mutable: true, activate: false})
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
            obj.id ??= this._assign_id(state, opts)

            let setup = obj.__setup__({}, {ring: this.ring, block: this})
            if (setup instanceof Promise) await setup

            // find all unseen newborn references and add them to the queue
            obj.__references.forEach(ref => {
                if (ref.is_newborn() && !unique.has(ref)) { objects.push(ref); unique.add(ref) }
            })
        }
        // print(`${this}.$agent.insert() saving ${objects.length} object(s)`)

        for (let obj of objects) {
            this._prepare_for_insert(obj)       // validate obj.__data
            await this._save(state.storage, obj)
        }

        // await Promise.all(objects.map(obj => {}))

        let ids = objects.map(obj => obj.id)
        // print(`${this}.$agent.insert() saved IDs:`, ids)
        // this._print(`after $agent.insert(), schemat.tx=${JSON.stringify(schemat.tx)}`)

        return batch ? ids.slice(0, data.length) : ids[0]
    }

    _prepare_for_insert(obj) {
        obj.__data.delete('__ver')          // just in case, it's forbidden to pass __ver from the outside
        obj.validate()                      // data validation
        obj._bump_version()                 // set __ver=1 if needed
        obj._seal_dependencies()            // set __seal
    }

    _assign_id(state, {insert_mode} = {}) {
        /* Calculate a new `id` to be assigned to the record being inserted. */
        // TODO: auto-increment `key` not `id`, then decode up in the sequence
        insert_mode ??= this.ring.insert_mode
        let id = (insert_mode === 'compact') ? this._assign_id_compact(state) : this._assign_id_incremental(state)

        if (!this.ring.valid_insert_id(id))
            throw new DataAccessError(`candidate ID=${id} for a new object is outside of the valid set for the ring ${this.ring}`)

        state.autoincrement = Math.max(id, state.autoincrement)
        // this._autoincrement = Math.max(id, this._autoincrement)

        // print(`DataBlock._assign_id(): assigned id=${id} at process pid=${process.pid} block.__hash=${this.__hash}`)
        return id
    }

    _assign_id_incremental({autoincrement}) {
        let [A, B, C] = this.ring.id_insert_zones       // [min_id_exclusive, min_id_forbidden, min_id_sharded]

        // try allocating an ID from the exclusive zone if present
        let auto = autoincrement + 1  //this._autoincrement + 1
        let id = Math.max(auto, A || 1)
        if (A && id < B) return id

        // otherwise, allocate from the sharded zone; pick an ID that honors the block-level (base-2) and ring-level (base-3) sharding rules at the same time
        id = Math.max(auto, C)
        id = this.shard_combined.fix_upwards(id)

        return id
    }

    _assign_id_compact({storage, autoincrement}) {
        /* Scan `storage` to find the first available `id` for the record to be inserted, starting at ring.min_id_exclusive.
           This method of ID generation has performance implications (O(n) complexity), so it can only be used with MemoryStorage.
         */
        // if all empty slots below _autoincrement were already allocated, use the incremental algorithm
        // (this may still leave empty slots if a record was removed in the meantime, but such slot is reused after next reload of the block)
        if (this._reserved.has(autoincrement)) { //this._autoincrement
            let id = this._assign_id_incremental({autoincrement})
            this._reserved.add(id)
            return id
        }

        if (!(storage instanceof MemoryStorage))
            throw new Error('compact insert mode is only supported with MemoryStorage')

        let [A, B, C] = this.ring.id_insert_zones       // [min_id_exclusive, min_id_forbidden, min_id_sharded]

        // find the first unallocated ID slot in the exclusive zone [A,B) or the sharded zone [C,∞)
        for (let id = A || C; ; id++) {
            if (id < C && id >= B) id = C
            if (id >= C) id = this.shard_combined.fix_upwards(id)
            let key = this.encode_id(id)
            if (!this._reserved.has(id) && !storage.get(key)) {         // found an unallocated slot?
                this._reserved.add(id)
                return id
            }
        }
    }

    // _reclaim_id(...ids)

    async '$agent.update'({storage}, id, edits, req) {
        /* Check if `id` is present in this block. If not, pass the request to a lower ring.
           Otherwise, load the data associated with `id`, apply `edits` to it, and save a modified item
           in this block (if the ring permits), or forward the write request back to a higher ring. Return {id, data}.
         */
        let key = this.encode_id(id)
        let data = await storage.get(key)
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

        return this._save(storage, obj, prev)       // save changes and perform change propagation
    }

    async '$agent.upsave'({storage}, id, data, req) {
        /* Update, or insert an updated object, after the request `req` has been forwarded to a higher ring. */
        let key = this.encode_id(id)
        if (await storage.get(key))
            throw new DataConsistencyError('newly-inserted object with same ID discovered in a higher ring during upward pass of update', {id})

        let obj = await WebObject.from_data(id, data, {activate: false})
        return this._save(storage, obj)
    }

    async _save(storage, obj, prev = null) {
        let id = obj.id
        let data = obj.__json
        let key = this.encode_id(id)

        await this.put(storage, key, data)
        await this.propagate_change(key, prev, obj)

        data = this._annotate(data)
        schemat.register_changes({id, data})
    }

    async '$agent.delete'({storage}, id, req) {
        /* Try deleting the `id`, forward to a lower ring if the id is not present here in this block.
           Log an error if the ring is read-only and the `id` is present here.
         */
        let key = this.encode_id(id)
        let data = await storage.get(key)
        if (data === undefined) return this._move_down(id, req).delete(id, req)

        if (this.ring.readonly)
            // TODO: find the first writable ring upwards from this one and write a tombstone for `id` there
            throw new DataAccessError("cannot remove the item, the ring is read-only", {id})
            // return req.error_access("cannot remove the item, the ring is read-only")

        let obj = await WebObject.from_data(id, data, {activate: false})
        let deleted = storage.del(key)
        if (!deleted) return 0

        this._flush(storage)
        await this.propagate_change(key, obj)

        // data.set('__status', 'DELETED')
        schemat.register_changes({id, data: {'__status': 'DELETED'}})

        assert(Number(deleted) === 1)
        return Number(deleted)
    }

    async '$agent.erase'({storage}) {
        this._autoincrement = 1
        this._reserved = new Set()
        return super['$agent.erase']({storage})
    }

    async propagate_change(key, obj_old = null, obj_new = null) {
        /* Push a change from this data block to all derived streams in the ring. */
        assert(this.ring?.is_loaded())
        for (let seq of this.ring.sequences)            // of this.sequence.derived
            seq.apply_change(key, obj_old, obj_new)     // no need to await, the result is not used by the caller
    }
}


/**********************************************************************************************************************/

export class BootDataBlock extends DataBlock {

    _storage        // Storage for this block's records
    _file_path      // for booting, a complete file_path must be provided by the caller, so it's a variable here + custom getter below

    get file_path() { return this._file_path }

    __new__(sequence, props = {}) {
        super.__new__(sequence, props)
        this._file_path = props.file_path
    }

    async __init__() {
        await super.__init__()

        let storage_class = this._detect_storage_class()
        this._storage = new storage_class(this.file_path, this)
        this._autoincrement = await this._reopen(this._storage) || 1
    }

    async select(id, req) { return this.$_wrap.select({storage: this._storage}, id, req) }

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

