import {assert, print, T, zip, arrayFromAsync, fileBaseName, trycatch} from '../common/utils.js'
import {DataAccessError, DataConsistencyError, ObjectNotFound} from '../common/errors.js'
import {Shard, ObjectsMap, Mutex, Mutexes} from "../common/structs.js"
import {bin_to_hex, compare_bin, zero_binary} from "../common/binary.js";
import {JSONx} from "../common/jsonx.js";
import {Struct} from "../common/catalog.js"
import {WebObject} from '../core/object.js'
import {Agent} from "../server/agent.js"

const fs = await server_import('node:fs')

/**********************************************************************************************************************/

export class OP {
    /* Low-level binary operation (instruction) to be executed on a destination block or sequence.
       Can be serialized to a WAL log for durability. (TODO)
     */
    constructor(op, ...args) {
        this.op = op        // put, del, inc, ???
        this.args = args
    }

    async submit() {
        /* RPC execution on a derived block. */
        let {block, op, args} = this
        assert(['put', 'del'].includes(op))
        return block.$agent[op](...args)
    }

    exec(block) {
        /* Immediate execution here on `block`. */
        let {op, args} = this
        assert(['put', 'del'].includes(op))
        return block[`_${op}`](...args)
    }
}

/**********************************************************************************************************************/

export class Monitor {
    /* Utility class that represents an active connection between a source block and a derived sequence. Monitor captures
       changes in the source and translates them to destination updates; it also performs a (possibly long-lasting)
       backfilling procedure after a new derived sequence has been created and needs to be filled up with initial data.
       Monitors are "write agents" that perform all updates to a derived sequence, although they reside on source blocks
       not at destination. Also, they are NOT web objects, so they are not persisted to DB on their own, and whatever
       internal state they maintain, this state is managed and persisted locally via the host block.

       During backfill process, source keys are split into two ranges:
       - "processed zone" (key <= backfill_offset): these keys were already sent to destination and undergo regular change capture
       - "pending zone" (key > backfill_offset): not yet sent to destination, no change capture for these keys
     */

    src     // source block
    dst     // destination sequence

    backfill_offset     // position of the backfill process: all keys up to backfill_offset has been processed,
                        // so the monitor forwards insert/update/delete events occurring at keys <= backfill_offset,
                        // but ignores any events occurring above backfill_offset; set to null after backfill is finished

    get _backfill_path() { return this.src._get_backfill_path(this.dst) }


    constructor(src, dst, backfill = false) {
        this.src = src
        this.dst = dst
        this.backfill_offset = null

        assert(src.is_loaded())
        assert(dst.is_loaded())

        // here, dst.filled=true may arrive with a delay, that's why removing the file, below, must be delayed long after backfill()
        if (backfill && dst.filled) throw new Error(`sequence ${dst} is already filled, no need to start backfilling`)
        backfill ||= !dst.filled

        let path = this._backfill_path
        let exists = fs.existsSync(path)

        if (backfill) {
            // read current `backfill_offset` from local file .../data/backfill/<src>.<dst>.json, if present
            if (exists) {
                let report = JSONx.parse(fs.readFileSync(path, 'utf8'))
                this.backfill_offset = report.offset
            }
            else this.backfill_offset = zero_binary
            this.src._print(`Monitor.constructor() backfill_offset`, this.backfill_offset)
        }
        else if (exists)
            fs.unlinkSync(path)     // remove the backfill file when initialization of `seq` was completed and confirmed in dst.filled
    }

    is_backfilling() {
        /* True if the target sequence is not yet initialized and the backfill process from `src` is still ongoing. */
        return !!this.backfill_offset
    }

    async backfill(limit = 3) {
        /* Run another round of backfilling: scan the next batch of source records, transform them into
           destination-sequence mutations, and submit to destination.
         */
        this.src._print(`backfill() to ${this.dst} ...`)

        let prev_offset = this.backfill_offset
        let records = this.src._scan({limit, gt: prev_offset})
        let count = 0
        let ops = []
        
        for await (let [key, val] of records) {
            assert(compare_bin(this.backfill_offset, key) < 0, `next key retrieved during backfill was expected to be strictly greater than offset`)
            this.backfill_offset = key
            count++

            let obj = this.src.decode_object(key, val)
            ops.push(...this.derive_ops(key, null, obj, false))
            this.src._print(`backfill() ... found key <${bin_to_hex(key)}> value`, val.slice(0, 50))
        }
        // this.src._print(`backfill() ... derived ${ops.length} ops`)

        // if (count < limit) this._finalize_backfill()        // terminate backfilling if no more records
        if (count < limit) this.backfill_offset = null         // terminate backfilling if no more records
        this._commit_backfill(prev_offset, this.backfill_offset)

        // TODO: batch & compact instructions addressed to the same block, for performance AND to prevent accidental reordering
        return Promise.all(ops.map(op => op.submit()))
    }

    _commit_backfill(prev, offset) {
        /* Save new offset to file and inform destination sequence about it, so the sequence can ultimately be marked as `filled`. */
        let report = JSONx.stringify({offset})
        fs.writeFileSync(this._backfill_path, report, {flush: true})

        // inform the destination sequence about new offset
        let start = this.src.keys_start     //prev
        let stop  = offset || this.src.keys_stop
        this.dst.get_remote().edit.commit_backfill(start, stop).save()
    }

    // _finalize_backfill() {
    //     /* Finalize the backfill process: clear the offset, remove file. */
    //     this.backfill_offset = null
    //     trycatch(() => fs.unlinkSync(this._backfill_path))      // ignore errors, esp. ENOENT = "file not found"
    // }

    _in_pending_zone(key) {
        /* During backfilling, changes in the pending zone (above offset, unprocessed yet) are ignored. */
        return this.backfill_offset && compare_bin(this.backfill_offset, key) < 0
    }

    derive_ops(key, prev, next, checked = true) {
        /* In response to a captured [prev > next] value change at a binary `key` in the source sequence, derive a list
           of low-level instructions that should be executed on the destination derived block to propagate the change.
           Arguments, prev/next, are records *decoded* into object representation (web objects, pseudo-objects).
         */
        if (checked && this._in_pending_zone(key)) return []
        let ops = this.dst.operator.derive_ops(key, prev, next)

        // in each op, append info about the destination block
        ops.forEach(op => {op.block = this.dst.find_block(op.key)})
        return ops
    }
}


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

    // __concurrent = true      -- $agent.select() must execute concurrently to support nested selects, otherwise deadlocks occur!


    sequence        // parent sequence
    storage         // storage type, e.g. "yaml", "json", "rocksdb", ... can be repeated (storage$) for dual writes
    keys_start
    keys_stop
    file_tag        // name of the local file/directory of this block, without a path nor extension; initialized during __setup__(),
                    // should not be modified later on; the upper part of the path may vary between nodes

    get ring()      { return this.sequence.ring }
    get schema()    { return this.sequence.operator.record_schema }

    async __setup__() {
        this._print('__setup__() ...')
        if (!this.sequence.is_loaded()) await this.sequence.load()
        if (!this.ring.is_loaded()) await this.ring.load()
        assert(this.sequence.operator.is_loaded())

        this._print('__setup__() props:', this.file_tag, this.ring.file_tag, this.sequence.file_tag, this.sequence.operator.file_tag, this.sequence.operator.name)

        let parts = [
            this.ring.file_tag || this.ring.name,
            this.sequence.file_tag || this.sequence.operator.file_tag || this.sequence.operator.name,
            `${this.id}`,
        ]
        this.file_tag ??= parts.filter(p => p).join('.')

        this._print('__setup__() done:', this.file_tag)
    }

    async __load__() {
        if (CLIENT) return              // don't initialize internals when on client

        if (!this.sequence.is_loaded())
            await this.sequence.load()
            // {this.sequence.load(); await sleep()}
            // if (schemat.booting) {this.sequence.load(); await sleep()} else await this.sequence.load()

        if (!this.ring.is_loaded())
            await this.ring.load()

        // if (!this.sequence.is_loaded() && !this.sequence.__meta.loading)
        //     this.sequence.load()        // intentionally not awaited to avoid deadlock: sequence loading may try to read from this block (!);
        //                                 // it's assumed that `sequence` WILL get fully loaded before any CRUD operation (ins/upd/del) starts
    }

    encode_key(key) { return this.schema.encode_key(key) }
    decode_key(bin) { return this.schema.decode_key(bin) }

    decode_object(key, val) { return this.schema.decode_object(key, val) }

    async __start__() {
        let stores = await Promise.all(this.storage$.map(s => this._create_store(s)))
        let monitors = new ObjectsMap(this.sequence.derived.map(seq => [seq, new Monitor(this, seq)]))
        let _mutex = new Mutex()
        let global_lock = (fn) => _mutex.run_exclusive(fn)
        return {stores, store: stores[0], monitors, global_lock}
    }

    async __stop__() {
        // await this._sync_stores()
        await Promise.all(this.$state.stores.toReversed().map(store => store.close()))
    }

    async _detect_store_class(format) {
        let {JsonStore} = await import('./store.js')
        if (format === 'json') return JsonStore
        throw new Error(`unsupported store type '${format}' in ${this}`)
    }

    async _create_store(storage, path = null) {
        path ??= this._get_store_path(storage)
        let clas_ = await this._detect_store_class(storage)
        let store = new clas_(path, this)
        await store.open()
        return store
    }

    _get_store_path(storage) {
        let ext = Block.STORAGE_TYPES[storage]
        if (!ext) throw new Error(`unknown storage type '${storage}' in ${this}`)
        return `${schemat.node.file_path}/${this.file_tag}.${ext}`
    }

    _get_backfill_path(seq) {
        /* Path to the local file that holds backfilling status information for data transfer from
           this source block to `seq` derived sequence. Creates the parent .../backfill folder if needed.
         */
        // create the .../backfill folder if needed
        let folder = `${schemat.node.file_path}/backfill`
        if (!fs.existsSync(folder)) fs.mkdirSync(folder)    // create `folder` if missing
        return `${folder}/${this.id}.${seq.id}.json`        // .../data/backfill/<src>.<dst>.json
    }


    /***  Access to records  ***/

    async _get(key, checked = false) {
        if (checked && !this.sequence.filled) throw new Error(`sequence ${this.sequence} is not filled`)
        return this.$state.store.get(key)
    }

    async '$agent.put'(key, value) { return this._put(key, value) }

    async _put(key, value) {
        /* Write the [key, value] pair here in this block. No forward of the request to another ring. */
        return this.$state.stores.map(s => s.put(key, value))[0]    // write to all stores, but await the first one only
    }

    async '$agent.del'(key) { return this._del(key) }

    async _del(key) {
        return this.$state.stores.map(s => s.del(key))[0]           // delete from all stores, but return the first result only
    }

    async '$agent.scan'(opts = {}) {
        /* Generator of binary records in a key range defined by `opts`. */
        if (!this.sequence.filled) throw new Error(`sequence not initialized`)
        return arrayFromAsync(this._scan(opts))
    }

    async *_scan(opts = {}) { yield* this.$state.store.scan(opts) }

    async '$agent.erase'() {
        /* Remove all records from this block. */
        return this.$state.stores.map(s => s.erase())[0]
    }

    // async '$agent.flush'() {
    //     return this.$state.stores.map(s => s.flush(false))[0]
    // }

    async _sync_stores() {
        /* Copy all data from $state.store to other stores (if present) after erasing them. */
        let others = this.$state.stores.slice(1)
        if (!others.length) return

        this._print(`_sync_stores() ...`)
        await Promise.all(others.map(s => s.erase()))
        let {store} = this.$state

        for (let [k, v] of store.scan())
            await Promise.all(others.map(s => s.put(k, v)))

        this._print(`_sync_stores() done`)
    }

    /***  Change propagation  ***/

    _derive(key, prev = null, next = null) {
        let ops = []
        for (let monitor of this.$state.monitors.values())
            ops.push(...monitor.derive_ops(key, prev, next))
        return ops
    }
    
    async _apply(ops) {
        /* Schedule local or remote `ops` for execution, either immediately or later with WAL (TODO). */
        return this.$state.global_lock(async () =>
        {
            let local = []
            for (let op of ops)
                if (op.block) op.submit()           // RPC execution on a derived block
                else local.push(op.exec(this))      // immediate execution here on this block
            return Promise.all(local)
        })
    }

    async '$agent.background'(seq) {
        /* */
        this._print(`background job...`)

        // identify the monitors that perform backfilling right now
        let monitors = [...this.$state.monitors.values()].filter(m => m.is_backfilling())
        if (!monitors.length) return 10.0       // increase the delay between background job calls if no backfilling

        for (let monitor of monitors)
            await monitor.backfill()

        return 10 //0.2
    }

    async '$master.backfill'(seq) {
        /* Start a monitor that will perform the initial scan of this (source) sequence, compute derived records
           and send them to destination sequence, `seq`, as a part of its backfilling (initialization) procedure.
           The monitor then continues feeding regular updates to `seq`.
         */
        let {monitors} = this.$state
        let monitor = monitors.get(seq)
        if (monitor) return

        await seq.load()
        monitors.set(seq, monitor = new Monitor(this, seq, true))
    }

    // _propagate(key, prev = null, next = null) {
    //     /* Push a change in this block to all derived sequences. */
    //     assert(this.ring?.is_loaded())
    //     let ops = this._derive(key, prev, next)
    //     ops.forEach(op => op.submit())
    // }
}


/**********************************************************************************************************************/

export class DataBlock extends Block {
    /* A storage block that keeps web objects and implements high-level CRUD operations: insert/update/delete/upsave. */

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
        let lock_row = (id, fn) => _locks.run_exclusive(id, fn)
        return {...state, autoincrement, reserved, lock_row}
    }

    async _detect_store_class(format) {
        // let {YamlDataStore} = await import('./store.js')
        // let {RocksDBStore} = await import('./rocks.js')
        if (format === 'yaml') return (await import('./store.js')).YamlDataStore
        if (format === 'rocksdb') return (await import('./rocks.js')).RocksDBStore
        return super._detect_store_class(format)
    }

    encode_id(id)  { return this.sequence.encode_id(id) }
    decode_id(key) { return this.sequence.decode_id(key) }

    decode_object(key, json) {
        let id = this.decode_id(key)
        return WebObject.deaf(id, json)
    }

    _annotate(json) {
        /* Append metadata (__meta) with ring & block ID to the JSON content of an object retrieved during select/update. */
        let plain = JSON.parse(json)
        plain.__meta = {__ring: this.ring.id, __block: this.id}
        return JSON.stringify(plain)
    }

    _move_down(id, req) {
        /* Return lower ring and update `req` before forwarding a select/update/delete operation downwards to the lower ring. */
        // this._print(`_move_down() id=${id}`)

        let ring = this.ring
        assert(ring.is_loaded())

        // if (!ring.is_loaded()) await ring.load()    //ring = await schemat.get_loaded(ring.id)
        // if (!ring.is_loaded()) throw new Error(`the owner ring ${ring} of the block ${this} is not loaded`)

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
        if (!ring.is_loaded()) throw new Error(`the owner ring ${ring} of the block ${this} is not loaded`)
        while (ring?.readonly) ring = req.pop_ring()        // go upwards to find the first writable ring
        if (!ring) throw new DataAccessError(`can't save an updated object, the ring(s) are read-only`, {id: req.id})
        return ring
    }

    async '$agent.select'(id, req) {
        let key = this.encode_id(id)
        let json = await this._get(key, true)
        if (json) return this._annotate(json)
        return this._move_down(id, req).select(id, req)
    }

    async '$agent.insert'(entries, {id, ...opts} = {}) {
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
            if (await this._get(key))
                throw new DataConsistencyError(`record with this ID already exists`, {id})
        }

        // assign IDs and convert entries to objects; each object is instantiated for validation, but not activated:
        // __load__() & _activate() are NOT executed (performance) unless a custom __setup__() needs to be called (below)
        let objects = await Promise.all(entries.map(([provisional, data]) => {
            let _id = id || this._assign_id(opts)
            return WebObject.from_data(_id, data, {mutable: true, provisional})
            // return WebObject.inactive(_id, data, {mutable: true, provisional})
        }))
        let ids = objects.map(obj => obj.id)

        // replace provisional IDs with references to proper objects having ultimate IDs assigned
        DataBlock.rectify_refs(objects.map(obj => obj.__data), entries, objects)

        // tx must switch to a special "insert mode" while __setup__() methods are being called
        let on_newborn_created = (obj) => {
            obj.id = this._assign_id(opts)
            objects.push(obj)
        }
        schemat.tx.enter_insert_mode(on_newborn_created)

        // go through all the objects and call __setup__(), which may create new related objects (!)
        // that are added to the `objects` queue by on_newborn_created() that's called via TX

        for (let pos = 0; pos < objects.length; pos++) {
            let obj = objects[pos]
            if (obj.__setup__ === WebObject.prototype.__setup__) continue       // skip loading if no custom __setup__() present

            this._print(`calling custom ${obj}.__setup__()`)
            if (!obj.is_loaded()) await obj.load()
            let setup = obj.__setup__()  //{}, {ring: this.ring, block: this})
            if (setup instanceof Promise) await setup
        }

        // save records to the store
        for (let obj of objects) {
            this._prepare_for_insert(obj)       // validate obj.__data
            await this._save(obj)
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
            let prov = ref.__provisional_id
            if (!prov) throw new Error(`reference does not contain an ID nor provisional ID`)
            let sub = subs.get(prov)
            if (!sub) throw new Error(`provisional ID (${prov}) is invalid`)
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

    _assign_id({insert_mode} = {}) {
        /* Calculate a new `id` to be assigned to the record being inserted. */
        // TODO: auto-increment `key` not `id`, then decode up in the sequence
        insert_mode ??= this.ring.insert_mode
        let id = (insert_mode === 'compact') ? this._assign_id_compact() : this._assign_id_incremental()

        if (!this.ring.valid_insert_id(id))
            throw new DataAccessError(`candidate ID=${id} for a new object is outside of the valid set for the ring ${this.ring}`)

        let state = this.$state
        state.autoincrement = Math.max(id, state.autoincrement)

        // print(`DataBlock._assign_id(): assigned id=${id} at process pid=${process.pid} block.__hash=${this.__hash}`)
        return id
    }

    _assign_id_incremental() {
        let {autoincrement} = this.$state
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

    _assign_id_compact() {
        /* Scan `store` to find the first available `id` for the record to be inserted, starting at ring.min_id_exclusive.
           This method of ID generation has large performance implications (O(n) complexity) and should only be used in small blocks.
         */
        let {store, autoincrement, reserved} = this.$state

        // if all empty slots below autoincrement were already allocated, use the incremental algorithm
        // (this may still leave empty slots if a record was removed in the meantime, but such slot is reused after next reload of the block)
        if (reserved.has(autoincrement)) {
            let id = this._assign_id_incremental()
            reserved.add(id)
            return id
        }
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

    async '$agent.update'(id, edits, req) {
        /* Check if `id` is present in this block. If not, pass the request to a lower ring.
           Otherwise, load the data associated with `id`, apply `edits` to it, and save a modified item
           in this block (if the ring permits), or forward the write request back to a higher ring.
           The new record is recorded in the Registry and the current transaction. Nothing is returned.
         */
        return this.$state.lock_row(id, async () =>
        {
            let key = this.encode_id(id)
            let data = await this._get(key)
            if (data === undefined) return this._move_down(id, req).update(id, edits, req)

            let prev = await WebObject.inactive(id, data)
            let obj  = prev._clone()                // dependencies (category, container, prototypes) are loaded, but references NOT (!)

            obj._apply_edits(...edits)              // apply edits; TODO SECURITY: check if edits are safe; prevent modification of internal props (__ver, __seal etc)
            await obj._initialize(false)            // reinitialize the dependencies (category, class, ...) WITHOUT sealing! they may have been altered by the edits

            obj.validate()                          // validate object properties: each one individually and all of them together; may raise exceptions
            obj._bump_version()                     // increment __ver
            obj._seal_dependencies()                // recompute __seal

            if (obj.__base?.save_revisions)
                await obj._create_revision(data)    // create a Revision (__prev) to hold the previous version of `data`

            if (this.ring.readonly)                 // can't write the update here in this ring? forward to the first higher ring that's writable
                return this._move_up(req).upsave(id, obj.__json, req)

                // saving to a higher ring is done OUTSIDE the mutex and a race condition may arise no matter how this is implemented;
                // for this reason, the new `data` can be computed already here and there's no need to forward the raw edits
                // (applying the edits in an upper ring would not improve anything in terms of consistency and mutual exclusion)

            await this._save(obj, prev)         // save changes and perform change propagation
        })
    }

    async '$agent.upsave'(id, data, req) {
        /* Update, or insert an updated object, after the request `req` has been forwarded to a higher ring. */
        return this.$state.lock_row(id, async () =>
        {
            let key = this.encode_id(id)
            if (await this._get(key))
                throw new DataConsistencyError('newly-inserted object with same ID discovered in a higher ring during upward pass of update', {id})

            let obj = await WebObject.inactive(id, data)
            await this._save(obj)
        })
    }

    async _save(obj, prev = null) {
        let id = obj.id
        let data = obj.__json
        let key = this.encode_id(id)

        let op_put = new OP('put', key, data)
        let ops_derived = this._derive(key, prev, obj)      // instructions for derived sequences
        await this._apply([op_put, ...ops_derived])         // schedule `ops` for execution, either immediately or later with WAL
        this._cascade_delete(prev, obj)                     // remove objects linked to via a strong reference

        // await this._put(key, data)
        // this._propagate(key, prev, obj)

        data = this._annotate(data)
        schemat.register_changes({id, data})
    }

    async '$agent.delete'(id, req) {
        /* Try deleting the `id`, forward to a lower ring if the id is not present here in this block.
           Log an error if the ring is read-only and the `id` is present here.
         */
        return this.$state.lock_row(id, async () =>
        {
            let key = this.encode_id(id)
            let data = await this._get(key)
            if (data === undefined) return this._move_down(id, req).delete(id, req)

            if (this.ring.readonly)
                // TODO: find the first writable ring upwards from this one and write a tombstone for `id` there
                throw new DataAccessError("cannot remove the item, the ring is read-only", {id})
                // return req.error_access("cannot remove the item, the ring is read-only")

            let obj = await WebObject.inactive(id, data)

            let op_del = new OP('del', key)
            let ops_derived = this._derive(key, obj)        // instructions for derived sequences
            await this._apply([op_del, ...ops_derived])     // schedule `ops` for execution, either immediately or later with WAL
            this._cascade_delete(obj)                       // remove objects linked to via a strong reference

            // let deleted = await this._del(key)
            // this._propagate(key, obj)

            schemat.register_changes({id, data: {'__status': WebObject.Status.DELETED}})
            return 1
            // assert(Number(deleted) === 1)
            // return Number(deleted)
        })
    }

    async '$agent.erase'() {
        this.$state.autoincrement = 0
        this.$state.reserved = new Set()
        return super['$agent.erase']()
    }

    // _propagate(key, obj_old = null, obj_new = null) {
    //     /* Push a change in this block to all derived sequences; also, perform a cascade delete if needed. */
    //     super._propagate(key, obj_old, obj_new)
    //     this._cascade_delete(obj_old, obj_new)
    // }

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

    async __draft__(path) {
        this.name = fileBaseName(path)      // for debugging of boot process
        let format = this._detect_format(path)
        this._store = await this._create_store(format, path)
        await this._store.open()
    }

    _detect_format(path) {
        // infer storage type from file extension
        let ext = path.split('.').pop()
        if (ext === 'yaml') return 'yaml'
        if (ext === 'jl') return 'json'
    }

    async select(id, req) { return await this.$_wrap.select({store: this._store}, id, req) }
}
