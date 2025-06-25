import {assert, print, T, zip, amap, sleep, utc, joinPath, arrayFromAsync, isPromise} from '../common/utils.js'
import {DataAccessError, DataConsistencyError, ObjectNotFound} from '../common/errors.js'
import {Shard, Mutex, Mutexes} from "../common/structs.js";  //'async-mutex'
import {WebObject} from '../core/object.js'
import {Struct} from "../common/catalog.js"
import {MemoryStore, JsonIndexStore, YamlDataStore} from "./store.js"
import {Agent} from "../server/agent.js"


/**********************************************************************************************************************
 **
 **  BLOCKS
 **
 */

export class Block extends Agent {
    /* A continuous subrange of key-value records of a data/index sequence, physically located on a single machine.
       A unit of data replication, distribution and concurrency. Records are arranged by key using byte order.
     */

    static STORAGE_TYPES = {        // supported storage types and their file/folder extensions
        'yaml':     'yaml',
        'json':     'jl',
        'rocksdb':  'rocksdb',
    }

    sequence        // parent sequence
    storage         // storage type, e.g. "yaml", "json", "rocksdb", ...
    file_tag        // name of the local file/directory of this block, without a path nor extension; initialized during __setup__(), should not be modified later on

    // __meta.pending_flush = false  // true when a flush() is already scheduled to be executed after a delay

    get ring()      { return this.sequence.ring }
    get file_name() {
        let ext = Block.STORAGE_TYPES[this.storage]
        if (ext) return `${this.file_tag}.${ext}`
        throw new Error(`unknown storage type '${this.storage}' in ${this}`)
    }

    // absolute path to this block's local folder/file on the current node; the upper part of the path may vary between nodes
    get file_path() { return `${schemat.node.file_path}/${this.file_name}` }

    async __setup__() {
        print('Block.__setup__() ...')
        if (!this.sequence.is_loaded()) await this.sequence.load()
        if (!this.ring.is_loaded()) await this.ring.load()

        let parts = [
            this.ring.file_tag,
            this.sequence.file_tag || this.sequence.operator?.file_tag || this.sequence.operator?.name,
            `${this.id}`,
        ]
        this.file_tag ??= parts.filter(p => p).join('.')

        print('Block.__setup__() done, file_name', this.file_name)
    }

    async __load__() {
        if (CLIENT) return              // don't initialize internals when on client

        if (!this.sequence.is_loaded())
            await this.sequence.load()
            // {this.sequence.load(); await sleep()}
            // if (schemat.booting) {this.sequence.load(); await sleep()} else await this.sequence.load()

        // if (!this.sequence.is_loaded() && !this.sequence.__meta.loading)
        //     this.sequence.load()        // intentionally not awaited to avoid deadlock: sequence loading may try to read from this block (!);
        //                                 // it's assumed that `sequence` WILL get fully loaded before any CRUD operation (ins/upd/del) starts
    }

    encode_key(key) { return this.sequence.encode_key(key) }
    decode_key(bin) { return this.sequence.decode_key(bin) }

    async __start__() {
        let __exclusive = false             // $agent.select() must execute concurrently to support nested selects, otherwise deadlocks occur!
        let storage_class = this._detect_storage_class(this.storage)
        let store = new storage_class(this.file_path, this)
        await this._reopen(store)
        return {__exclusive, store}
    }

    _detect_storage_class(format) {
        throw new Error(`unsupported store type '${format}' in [${this.id}] for ${this.file_path}`)
    }

    async _reopen(store) {
        /* Temporary solution for reloading block data to pull changes written by another worker. */
        // if (!this.sequence.is_loaded()) await this.sequence.__meta.loading
        if (!store.dirty) return store.open()
        let ref = schemat.registry.get_object(this.id)
        if (!ref || this === ref)
            return sleep(1.0).then(() => this._reopen(store))
    }

    async '$agent.put'({store}, key, value) { return this.put(store, key, value) }

    async put(store, key, value) {
        /* Write the [key, value] pair here in this block and propagate the change to derived indexes.
           No forward of the request to another ring.
         */
        await store.put(key, value)
        this._flush(store)
    }

    async '$agent.del'({store}, key, value) {
        if (value === undefined) value = await store.get(key)
        if (value === undefined) return false           // TODO: notify about data inconsistency (there should be no missing records)

        let deleted = store.del(key)
        this._flush(store)
        return deleted
    }

    async '$agent.scan'({store}, opts = {}) {
        return arrayFromAsync(store.scan(opts))         // TODO: return batches with a hard upper limit on their size
    }

    async '$agent.erase'({store}) {
        /* Remove all records from this block. */
        await store.erase()
        this._flush(store)
    }

    async '$agent.flush'({store}) { return this._flush(store, false) }

    _flush(store, with_delay = true) {
        /* Flush all unsaved modifications to disk. If with_delay=true, the operation is delayed by `flush_delay`
           seconds (configured in the parent sequence) to combine multiple consecutive updates in one write
           - in such case you do NOT want to await the result.
         */
        let delay = this.sequence.flush_delay

        if (with_delay && delay) {
            if (this.__meta.pending_flush) return
            this.__meta.pending_flush = true
            return setTimeout(() => this._flush(store, false), delay * 1000)
        }
        this.__meta.pending_flush = false
        return store.flush()
    }

    // propagate() {
    //     /* For now, there's NO propagation from index blocks, only from data blocks (see below). */
    // }
}


/**********************************************************************************************************************/

export class BinaryBlock extends Block {
    /* A block of a derived sequence: index, aggregation. */

    _detect_storage_class(format) {
        if (format === 'json') return JsonIndexStore
        return super._detect_storage_class(format)
    }
}


/**********************************************************************************************************************/

export class DataBlock extends Block {
    /* A Block that stores objects and provides the "insert" operation. */

    // properties
    shard

    get shard_combined() {
        if (this.shard && this.ring.shard3) return Shard.intersection(this.shard, this.ring.shard3)
        return this.shard || this.ring.shard3
    }

    async __start__() {
        let state = await super.__start__()
        let autoincrement = state.store.get_max_id()    // current max ID of records in this block
        let reserved = new Set()                        // IDs that were already assigned during insert(), for correct "compact" insertion of many objects at once
        let _locks = new Mutexes()                      // row-level locks for updates & deletes
        let lock = (id, fn) => _locks.run_exclusive(id, fn)
        return {...state, autoincrement, reserved, lock}
    }

    _detect_storage_class(format) {
        if (format === 'yaml') return YamlDataStore
        return super._detect_storage_class(format)
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

    async '$agent.select'({store}, id, req) {
        let key = this.encode_id(id)
        let data = await store.get(key)         // JSON string
        if (data) return this._annotate(data)
        return await this._move_down(id, req).select(id, req)
    }

    async '$agent.insert'(state, entries, {id, ...opts} = {}) {
        /* Insert a number of `entries` as new objects into this block. Each entry is a pair: [provisional-id, data].
           Option `id`: target ID to be assigned to the new object, only if `entries` contains exactly one entry.
        */
        // this._print_stack()
        assert(Array.isArray(entries))
        assert(entries.every(([prov, _]) => prov && prov < 0))
        if (!entries.length) return

        let ring = this.ring
        assert(ring?.is_loaded())
        if (ring.readonly) throw new DataAccessError(`cannot insert into a read-only ring [${ring.id}]`)
        if (id) {
            assert(entries.length === 1)        // fixed ID provided by the caller? check for uniqueness
            let key = this.encode_id(id)
            if (await state.store.get(key)) throw new DataConsistencyError(`record with this ID already exists`, {id})
        }

        // assign IDs and convert entries to objects; each object is instantiated for validation,
        // but not activated: __load__() & _activate() are NOT executed (performance)
        let objects = await Promise.all(entries.map(([npid, data]) => {
            let _id = id || this._assign_id(state, opts)
            return WebObject.from_data(_id, data, {mutable: true, activate: false, provisional: -npid})
        }))
        let ids = objects.map(obj => obj.id)

        // replace provisional IDs with references to proper objects having ultimate IDs assigned
        DataBlock.rectify_refs(objects.map(obj => obj.__data), entries, objects)

        // tx must switch to a special "insert mode" while __setup__() methods are being called
        let on_newborn_created = (obj) => {
            obj.id = this._assign_id(state, opts)
            objects.push(obj)
        }
        schemat.tx.enter_insert_mode(on_newborn_created)

        // go through all the objects and call __setup__(), which may create new related objects (!)
        // that are added to the `objects` queue by on_newborn_created() that's called via TX

        for (let pos = 0; pos < objects.length; pos++) {
            let obj = objects[pos]
            let setup = obj.__setup__()  //{}, {ring: this.ring, block: this})
            if (setup instanceof Promise) await setup
        }

        // save records to the store
        for (let obj of objects) {
            this._prepare_for_insert(obj)       // validate obj.__data
            await this._save(state.store, obj)
        }

        schemat.tx.exit_insert_mode()
        return ids
    }

    static rectify_refs(structs, inserts, substitutes) {
        /* Find all references to web objects inside `structs` and replace provisional IDs with final IDs/objects from `substitutes`. */
        if (!structs?.length) return
        let provs = inserts.map(([prov_id, _]) => prov_id)
        let subs = new Map(zip(provs, substitutes))     // map of provisional IDs -> substitutes

        // if (tx) subs = tx._staging

        let rectify = (ref) => {
            if (!(ref instanceof WebObject) || ref.id) return
            let npid = ref.__neg_provid
            if (!npid) throw new Error(`reference does not contain an ID nor provisional ID`)
            let sub = subs.get(npid)
            if (!sub) throw new Error(`provisional ID (${npid}) is invalid`)
            return typeof sub === 'object' ? sub : WebObject.stub(sub)
        }
        for (let struct of structs) Struct.transform(struct, rectify)
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

        // print(`DataBlock._assign_id(): assigned id=${id} at process pid=${process.pid} block.__hash=${this.__hash}`)
        return id
    }

    _assign_id_incremental({autoincrement}) {
        let [A, B, C] = this.ring.id_insert_zones       // [min_id_exclusive, min_id_forbidden, min_id_sharded]

        // try allocating an ID from the exclusive zone if present
        let auto = autoincrement + 1
        let id = Math.max(auto, A || 1)
        if (A && id < B) return id

        // otherwise, allocate from the sharded zone; pick an ID that honors the block-level (base-2) and ring-level (base-3) sharding rules at the same time
        id = Math.max(auto, C)
        id = this.shard_combined.fix_upwards(id)

        return id
    }

    _assign_id_compact({store, autoincrement, reserved}) {
        /* Scan `store` to find the first available `id` for the record to be inserted, starting at ring.min_id_exclusive.
           This method of ID generation has performance implications (O(n) complexity), so it can only be used with MemoryStore.
         */
        // if all empty slots below autoincrement were already allocated, use the incremental algorithm
        // (this may still leave empty slots if a record was removed in the meantime, but such slot is reused after next reload of the block)
        if (reserved.has(autoincrement)) {
            let id = this._assign_id_incremental({autoincrement})
            reserved.add(id)
            return id
        }

        if (!(store instanceof MemoryStore))
            throw new Error('compact insert mode is only supported with MemoryStore')

        let [A, B, C] = this.ring.id_insert_zones       // [min_id_exclusive, min_id_forbidden, min_id_sharded]

        // find the first unallocated ID slot in the exclusive zone [A,B) or the sharded zone [C,∞)
        for (let id = A || C; ; id++) {
            if (id < C && id >= B) id = C
            if (id >= C) id = this.shard_combined.fix_upwards(id)
            let key = this.encode_id(id)
            if (!reserved.has(id) && !store.get(key)) {     // found an unallocated slot?
                reserved.add(id)
                return id
            }
        }
    }

    // _reclaim_id(...ids)

    async '$agent.update'({store, lock}, id, edits, req) {
        /* Check if `id` is present in this block. If not, pass the request to a lower ring.
           Otherwise, load the data associated with `id`, apply `edits` to it, and save a modified item
           in this block (if the ring permits), or forward the write request back to a higher ring.
           The new record is recorded in the Registry and the current transaction. Nothing is returned.
         */
        return lock(id, async () =>
        {
            let key = this.encode_id(id)
            let data = await store.get(key)
            if (data === undefined) return this._move_down(id, req).update(id, edits, req)

            let prev = await WebObject.from_data(id, data, {mutable: false, activate: false})
            let obj  = prev._clone()                    // dependencies (category, container, prototypes) are loaded, but references are NOT (!)
            // let obj  = await WebObject.from_data(id, data, {mutable: true,  activate: false})   // TODO: use prev._clone() to avoid repeated async initialization

            obj._apply_edits(...edits)                  // apply edits; TODO SECURITY: check if edits are safe; prevent modification of internal props (__ver, __seal etc)
            await obj._initialize(false)                // reinitialize the dependencies (category, class, ...) WITHOUT sealing! they may have been altered by the edits

            obj.validate()                              // validate object properties: each one individually and all of them together; may raise exceptions
            obj._bump_version()                         // increment __ver
            obj._seal_dependencies()                    // recompute __seal

            if (obj.__base?.save_revisions)
                await obj._create_revision(data)        // create a Revision (__prev) to hold the previous version of `data`

            if (this.ring.readonly)                     // can't write the update here in this ring? forward to the first higher ring that's writable
                return this._move_up(req).upsave(id, obj.__json, req)

                // saving to a higher ring is done OUTSIDE the mutex and a race condition may arise no matter how this is implemented;
                // for this reason, the new `data` can be computed already here and there's no need to forward the raw edits
                // (applying the edits in an upper ring would not improve anything in terms of consistency and mutual exclusion)

            await this._save(store, obj, prev)          // save changes and perform change propagation
        })
    }

    async '$agent.upsave'({store, lock}, id, data, req) {
        /* Update, or insert an updated object, after the request `req` has been forwarded to a higher ring. */
        return lock(id, async () =>
        {
            let key = this.encode_id(id)
            if (await store.get(key))
                throw new DataConsistencyError('newly-inserted object with same ID discovered in a higher ring during upward pass of update', {id})

            let obj = await WebObject.from_data(id, data, {activate: false})
            await this._save(store, obj)
        })
    }

    async _save(store, obj, prev = null) {
        let id = obj.id
        let data = obj.__json
        let key = this.encode_id(id)

        await this.put(store, key, data)
        this.propagate_change(key, prev, obj)

        data = this._annotate(data)
        schemat.register_changes({id, data})
    }

    async '$agent.delete'({store, lock}, id, req) {
        /* Try deleting the `id`, forward to a lower ring if the id is not present here in this block.
           Log an error if the ring is read-only and the `id` is present here.
         */
        return lock(id, async () =>
        {
            let key = this.encode_id(id)
            let data = await store.get(key)
            if (data === undefined) return this._move_down(id, req).delete(id, req)

            if (this.ring.readonly)
                // TODO: find the first writable ring upwards from this one and write a tombstone for `id` there
                throw new DataAccessError("cannot remove the item, the ring is read-only", {id})
                // return req.error_access("cannot remove the item, the ring is read-only")

            let obj = await WebObject.from_data(id, data, {activate: false})
            let deleted = store.del(key)
            if (!deleted) return 0

            this._flush(store)
            this.propagate_change(key, obj)

            schemat.register_changes({id, data: {'__status': WebObject.Status.DELETED}})

            assert(Number(deleted) === 1)
            return Number(deleted)
        })
    }

    async '$agent.erase'(state) {
        state.autoincrement = 0
        state.reserved = new Set()
        return super['$agent.erase'](state)
    }

    propagate_change(key, obj_old = null, obj_new = null) {
        /* Push a change from this data block to all derived streams in the ring. */
        assert(this.ring?.is_loaded())
        this._cascade_delete(obj_old, obj_new)
        for (let seq of this.ring.sequences)            // of this.sequence.derived
            seq.apply_change(key, obj_old, obj_new)     // no need to await, the result is not used by the caller
    }

    _cascade_delete(prev, next = null) {
        /* Compare `prev` and `next` objects to see if any *strong* references got removed, and if so, delete the referenced objects.
           This method takes into account that the schema may have changed, and a previously strong REF might become weak,
           which should NOT trigger object removal if the reference itself stays the same! However, for safety,
           schema changes should NOT be combined with data changes in the same mutation of the object.
         */
        if (!prev) return
        // if (!prev.__category.has_strong_refs) return
        // TODO: check if prev.__category.__child_schema has any strong REFs at all (via a cached getter) to avoid traversing __data if possible

        // traverse prev.__data and collect strong references as [path, ref, type] triples
        let prev_refs = prev.collect_typed((ref, type) => ref instanceof WebObject && ref.id && type.is_strong?.())
        if (!prev_refs.length) return

        // traverse next.__data and collect all references (not only strong ones)
        let next_refs = next?.collect_typed((ref) => ref instanceof WebObject && ref.id) || []

        if (next_refs.length) {
            let _encode = ([path, ref]) => JSON.stringify([ref.id, ...path])
            let paths   = new Set(next_refs.map(_encode))
            let strongs = new Set(next_refs.filter(([path, ref, type]) => type.is_strong?.()).map(([_, ref]) => ref.id))

            // find strong refs in `prev` that are no longer present in `next`, or are weak and located on a different path
            for (let [path, ref] of prev_refs) {
                if (strongs.has(ref.id)) continue               // `ref` still present in `next` as a strong reference
                if (paths.has(_encode([path, ref]))) continue   // `ref` still present in `next` on the same path (not necessarily strong)
                ref.delete_self()
            }
        }
        else prev_refs.forEach(([_, ref]) => ref.delete_self())
    }
}


/**********************************************************************************************************************/

export class BootDataBlock extends DataBlock {

    _store      // Store for this block's records

    __new__(file_path) {
        let format = this._detect_format(file_path)
        let storage_class = this._detect_storage_class(format)
        this._store = new storage_class(file_path, this)
    }

    _detect_format(path) {
        // infer storage type from file extension
        let ext = path.split('.').pop()
        if (ext === 'yaml') return 'yaml'
        if (ext === 'jl') return 'json'
    }

    async __load__() {
        await super.__load__()
        await this._reopen(this._store)
    }

    async select(id, req) { return this.$_wrap.select({store: this._store}, id, req) }

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

