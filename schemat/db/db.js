import {T, assert, print, merge, fileBaseName, sleep} from '../common/utils.js'
import {DataAccessError, DatabaseError, ObjectNotFound} from "../common/errors.js"
import {WebObject} from "../core/object.js"
import {data_schema, Record} from "./records.js";
import {DataRequest} from "./data_request.js";
import {DataSequence} from "./sequence.js";
import {Catalog} from "../core/catalog.js";


/**********************************************************************************************************************
 **
 **  Database RING
 **
 */

export class Ring extends WebObject {
    /* Collection of (named) data streams. The primary one is the "objects" stream that contains web objects and supplies
       input data to other (derived) streams: indexes, aggregations etc. Some streams may have special type (e.g., "blobs").
     */

    file_prefix
    data_sequence           // DataSequence containing all primary data of this ring
    sequences = []          // array of derived sequences (Sequence objects)

    name                    // human-readable name of this ring for get_ring()
    readonly                // if true, the ring does NOT accept modifications: inserts/updates/deletes
    insert_mode             // if `compact`, new objects are inserted at the lowest possible ID in data blocks, possibly below autoincrement; requires MemoryStorage for data blocks

    base_ring               // reference to the base Ring (lower ring) of this one
    base_ring_readonly      // if true, requests going down to `base_ring` are not allowed to save their updates there but must come back to an upper ring

    // ID insert zones:
    min_id_exclusive = 0    // [min_id_exclusive, min_id_forbidden-1] is the exclusive ID insert zone, every value from this range can be used for new records inserted in this ring
    min_id_forbidden        // [min_id_forbidden, min_id_sharded-1] is the forbidden ID insert zone, no value from this range can be used for new records inserted in this ring
    min_id_sharded          // [min_id_sharded, +inf) is the sharded ID insert zone, where ID sharding is applied: only the ID that hashes to this ring's shard3.offset under modulo shard3.base can be inserted
                            // NOTE: updates are *not* affected by above rules! any ID from a lower ring can be saved here in this ring as an override of a lower-ring version of the record!

    shard3                  // a Shard instance representing the base-3 shard of IDs that can be allocated to new objects in the sharded zone


    get stack() {
        /* Array of all rings in the stack, starting from the innermost ring (bottom of the stack) up to this one, included. */
        let stack = this.base_ring?.stack || []
        return [...stack, this]
    }

    get sequence_names() {
        /* Map of sequences by their operator's name. */
        return new Map(this.sequences.map(seq => [seq.operator.name, seq]))
    }

    get id_insert_zones() {
        /* [min_id_exclusive, min_id_forbidden, min_id_sharded] grouped into an array, with the 2nd one imputed if missing.
           The lack of `min_id_exclusive` indicates there's NO exclusive zone.
         */
        // `min_id_sharded` is always defined and positive; `min_id_exclusive` and `min_id_sharded` can be undefined
        let [A, B, C] = [this.min_id_exclusive, this.min_id_forbidden, this.min_id_sharded]
        return [A, B || C, C]
    }


    __new__({name, base_ring, file_prefix, file, min_id_exclusive, min_id_forbidden, min_id_sharded, readonly = false} = {}) {
        this.name = name || (file && fileBaseName(file))
        this.base_ring = base_ring

        // if (!name && file)
        //     this.name = file.replace(/^.*\/|\.[^.]*$/g, '')         // extract the name from the file path (no directory, no extension)
        //     // this.name = file.substring(file.lastIndexOf('/') + 1, file.lastIndexOf('.') >= 0 ? file.lastIndexOf('.') : undefined)
        //     // this.name = path.basename(file, path.extname(file))

        this.file_prefix = file_prefix
        this.readonly = readonly
        this.min_id_exclusive = min_id_exclusive
        this.min_id_forbidden = min_id_forbidden
        this.min_id_sharded = min_id_sharded
    }

    async __setup__({}) {
        /* Create `data_sequence`. Re-create all indexes from the lower ring. */

        let base = await this.base_ring?.load()

        this.min_id_sharded ??= this.base_ring.min_id_sharded

        let DataSequence = await schemat.import('/$/sys/DataSequence')
        this.data_sequence = DataSequence.new(this, base?.data_sequence.operator)
        this.sequences = []
        if (!base) return

        let IndexSequence = await schemat.import('/$/sys/IndexSequence')
        for (let seq of base.sequences)
            this.sequences.push(IndexSequence.new(this, seq.operator))
    }

    async __init__() {
        /* Initialize the ring after it's been loaded from DB. */
        if (CLIENT) return
        // print(`... ring [${this.id || '---'}] ${this.name} (${this.readonly ? 'readonly' : 'writable'})`)

        await this.base_ring?.load()
        await this.data_sequence.load()
        for (let seq of this.sequences) await seq.load()

        this.validate_zones()
    }

    async erase(req) {
        /* Remove all records from this ring; open() should be called first. */
        if (this.readonly) throw new DataAccessError("the ring is read-only and cannot be erased")
        return this.data_sequence.erase(req)
    }

    async flush() { return this.data_sequence.flush() }


    /***  Errors & internal checks  ***/

    valid_insert_id(id) {
        /* Check that `id` is a valid ID for inserts in this ring. Does NOT take block-level base-2 sharding into account. */
        let [A, B, C] = this.id_insert_zones        // B and C are always defined and positive; A can be undefined
        if (id >= C) return this.shard3.includes(id)
        return A && A <= id && id < B
    }

    validate_zones() {
        /* Check that the ID-insert zones of this ring do not overlap with the zones of lower rings. */
        // this.base_ring.validate_zones()         // may raise an error

        let [A, B, C] = this.id_insert_zones

        // if exclusive zone is defined, check A <= B <= C
        if (A) {
            if (A > B) throw new Error(`lower bound of exclusive ID-insert zone exceeds the upper bound: ${A} > ${B}`)
            if (B > C) throw new Error(`exclusive ID-insert zone overlaps with sharded zone: ${B} > ${C}`)
            if (A > C) throw new Error(`exclusive ID-insert zone overlaps with sharded zone: ${A} > ${C}`)
        }

        if (!this.base_ring) return true        // no base ring, nothing more to check
        let stack = this.base_ring.stack

        // sharded zones of different rings must not overlap
        if (this.shard3)                        // shard3 is missing in bootstrap DB
            for (let ring of stack)
                if (this.shard3.overlaps(ring.shard3))
                    throw new Error(`base-3 shard [${this.shard3.label}] of ring ${this.__label} overlaps with shard [${ring.shard3.label}] of ${ring.__label}`)

        if (!A) return true                     // no exclusive zone, nothing more to check

        // exclusive zone = [A, B) must NOT overlap with exclusive or sharded zone of any lower ring...
        // for sharded zones, must hold:  B <= c_min := min(min_id_sharded) across lower rings
        let c_min = Math.min(...stack.map(r => r.min_id_sharded))
        if (B >= c_min) throw new Error(`exclusive ID-insert zone [${A},${B}) of ${this.__label} overlaps with sharded zone [${c_min},+inf) of some lower ring`)

        // for exclusive zones of every lower ring, must hold:  B <= min_id_exclusive || A >= min_id_forbidden
        for (let ring of stack) {
            let [a, b] = [ring.min_id_exclusive, ring.min_id_forbidden ?? ring.min_id_sharded]
            if (a && B > a && A < b)
                throw new Error(`exclusive ID-insert zone [${A},${B}) of ${this.__label} overlaps with exclusive zone [${a},${b}) of ${ring.__label}`)
        }
        return true
    }


    /***  Data access & modification  ***/

    _find_block(id) {
        assert(this.__meta.active, `trying to access uninitialized ring '${this.name}' [${this.id}] for object [${id}]`)
        return this.data_sequence.find_block_id(id)
    }

    _random_block() {
        assert(this.__meta.active, `trying to access uninitialized ring '${this.name}' [${this.id}] for insert`)
        return this.data_sequence.blocks[0]
    }

    async select(id, req) {
        // return this._find_block(id).remote.select(id, req || new DataRequest())
        return this._find_block(id)._select(id, req || new DataRequest())
    }

    async delete(id, req) {
        return this._find_block(id).cmd_delete(id, req || new DataRequest())
    }

    async insert(data, req) {
        return this._random_block().cmd_insert(null, data)
    }

    async insert_at(id, data) {
        return this._find_block(id).cmd_insert(id, data)
    }

    async update(id, edits, req) {
        /* Apply `edits` to an item's data and store under the `id` in top-most ring that allows writing this particular `id`.
           Return an {id, data} record as written to the data block.
           FUTURE: `edits` may perform tests or create side effects, for example, to check for a specific item version
                   to apply the edits to; or to perform a sensitive operation inside the record-level exclusive lock,
                   even without changing the record's data.
         */
        assert(edits.length, 'missing edits')
        return this._find_block(id).cmd_update(id, edits, req || new DataRequest())
    }

    async update_full(id_or_obj, data = null, req = null) {
        let obj = T.isNumber(id_or_obj) ? null : id_or_obj
        let id  = obj?.id || id_or_obj
        data ??= obj.__data //__json
        let edits = [['overwrite', data]]

        return this._find_block(id).cmd_update(id, edits, req || new DataRequest())
    }

    async upsave(id, data, req) {
        return this._find_block(id).cmd_upsave(id, data, req || new DataRequest())
    }


    /***  Indexes and Transforms  ***/

    async *scan(name, {start, stop, limit=null, reverse=false, batch_size=100} = {}) {
        /* Scan a given sequence, `name`, in the binary range [`start`, `stop`) and yield the records.
           If `limit` is not null, yield at most `limit` items.
           If `reverse` is true, scan in the reverse order.
           If `batch_size` is not null, yield records in batches of `batch_size` items.
         */
        let seq = this.sequence_names.get(name)
        yield* seq.scan({start, stop, limit, reverse, batch_size})
    }

    async 'action.create_sequence'(operator) {
        // TODO SEC: check permissions
        if (this.readonly) throw new Error("the ring is read-only")
        let opts = {ring: this.__ring, broadcast: true}
        let IndexSequence = await schemat.import('/$/sys/IndexSequence')
        let seq = await IndexSequence.new(this).save(opts)
        this.sequences.push(seq)
        await this.save(opts)
    }

    async rebuild_indexes() {
        /* Rebuild all derived sequences by making a full scan of the data sequence. */
        await Promise.all(this.sequences.map(seq => seq.erase()))

        for await (let {id, data} of this.data_sequence.scan_objects()) {
            let key = data_schema.encode_key([id])
            let obj = await WebObject.from_data(id, data, {activate: false})
            await Promise.all(this.sequences.map(seq => seq.apply_change(key, null, obj)))
        }
    }
}

export class BootRing extends Ring {
    /* During boot, we don't have access to category objects, so we cannot create full web objects (with __category)
       comprising the database rings. Also, the objects created are only temporary and *not* inserted to DB, so their
       __setup__() is *not* executed, hence all initialization must be done in __new__().
     */

    __new__(opts = {}) {
        let {file, ..._opts} = opts
        super.__new__(_opts)

        // the object here is created from a class and lacks __category; this kind of hack is only allowed during boot
        this.data_sequence = DataSequence._draft(this, {boot_file: file})
    }

    // select(id, req)  {
    //     print('boot ring select()')
    //     return this._find_block(id)._select(id, req || new DataRequest())
    // }

    insert() {assert(false)}
    update() {assert(false)}
    delete() {assert(false)}
    scan()   {assert(false)}
}


/**********************************************************************************************************************
 **
 **  DATABASE
 **
 */

export class Database extends WebObject {
    /* A number of Rings stacked on top of each other. Each select/insert/delete is executed on the outermost
       ring possible; while each update - on the innermost ring starting at the outermost ring containing a given ID.
       If ObjectNotFound/ReadOnly is caught, the next ring is tried.
       This class is only instantiated on the server, while the client uses a ClientDB proxy instead.
     */

    // properties:
    top_ring


    /***  Rings manipulation  ***/

    get rings()             { return this.top_ring.stack }      // [0] is the innermost ring (bottom of the stack), [-1] is the outermost ring (top)
    get rings_reversed()    { return this.rings.toReversed() }
    get bottom_ring()       { return this.rings[0] }
    get ring_names()        { return new Map(this.rings.map(r => [r.name, r])) }    // may not be unique
    get ring_ids()          { return new Map(this.rings.map(r => [r.id, r])) }      // should be unique


    async __init__() {
        if (CLIENT) return
        // print(`initializing database [${this.id}] ...`)
        // assert(this.top_ring, 'missing rings in the database')
        await this.top_ring?.load()
    }

    get_ring(ring) {
        /* Return the top-most ring with a given name or ID, throw an error if not found; `ring` can also be a Ring object,
           in which case it is replaced with the same-ID object from the ring stack.
         */
        if (typeof ring === 'string') ring = this.ring_names.get(ring)
        else if (typeof ring === 'number') ring = this.ring_ids.get(ring)
        else ring = this.ring_ids.get(ring?.id)
        if (!ring) throw new DataAccessError(`target ring not found in the database`)
        return ring
    }

    async select(id, {ring} = {}) {
        ring &&= this.get_ring(ring)        // check that `ring` occurs in the stack and replace it with the database's instance
        // if (ring) print(`selecting [${id}] from a custom top ring:`, ring.__label || ring)
        return (ring || this.top_ring).select(id)
    }

    async insert(data, {ring} = {}) {
        /* Find the top-most writable ring and insert `data` as a new entry there. Return {id, data} record.
           If `ring` is given (name/object/ID), the entry is inserted to this particular ring, or error is raised if read-only.
         */
        ring &&= this.get_ring(ring)
        if (!ring) {
            ring = this.rings_reversed.find(r => !r.readonly)       // find the first writable ring
            if (!ring) throw new DataAccessError("all ring(s) are read-only")
        }
        if (ring.readonly) throw new DataAccessError(`target ring is read-only`)
        return ring.insert(data)
    }

    async update(id, edits, {ring} = {}) {
        ring &&= this.get_ring(ring)
        return (ring || this.top_ring).update(id, edits)
    }

    delete(id, {ring} = {}) {
        ring &&= this.get_ring(ring)
        return (ring || this.top_ring).delete(id)
    }


    /***  Indexes  ***/

    async *scan(name, {offset, limit, ...opts} = {}) {
        /* Yield a stream of plain Records from the index, merge-sorted from all the rings. */
        let streams = this.rings.map(r => r.scan(name, opts))
        let merged = merge(Record.compare, ...streams)
        
        if (offset)
            for (let i = 0; i < offset; i++) {
                let next = await merged.next()
                if (next.done) return
            }

        if (limit !== undefined && limit !== null) {
            let count = 0
            for await (let record of merged)
                if (++count > limit) break
                else yield record
        }
        else yield* merged

        // TODO: apply `batch_size` to the merged stream and yield in batches
    }

    // async *scan_all() {
    //     /* Scan each ring and merge the sorted streams of entries. */
    //     // TODO: remove duplicates while merging
    //     let streams = this.rings.map(r => r.scan_all())
    //     yield* merge(WebObject.compare, ...streams)
    // }

    async 'action.create_index'(name, key, payload = undefined, {ring} = {}) {
        /* Add a new index in `ring` and all rings above. If not provided, `ring` is the bottom of the ring stack (the kernel).
           Schema of the new index is defined by `key` and `payload` (arrays of property names).
         */
        if (!Array.isArray(key) || key.length === 0) throw new Error(`index key must be an array with at least one element: ${key}`)
        if (payload && !Array.isArray(payload)) throw new Error(`index payload must be an array: ${payload}`)

        if (ring) {
            ring = this.get_ring(ring)
            if (!ring) throw new Error(`target ring not found in the database`)
        }
        else ring = this.bottom_ring

        // create index specification
        let ObjectIndexOperator = await schemat.import('/$/sys/ObjectIndexOperator')
        let index = ObjectIndexOperator.new(name, key, payload)
        index = await index.save({ring})
        // schemat._transaction.getStore()?.log_modified(index)

        // create streams for `index`, in `ring` and all higher rings
        for (let i = pos; i < this.rings.length; i++) {
            ring = this.rings[i]
            await ring.action.create_sequence(index)
        }
    }

    async rebuild_indexes() {
        for (let ring of this.rings)
            await ring.rebuild_indexes()
        return true
    }
}


export class BootDatabase extends Database {
    async open(ring_specs) {
        /* Create bootstrap rings according to `ring_specs` specification. */

        // assert(this.is_newborn())           // open() is a mutating operation, it can only be called on a newborn object (not in DB)
        print(`creating bootstrap database...`)
        let top
        for (let spec of ring_specs)
            top = await BootRing.new({...spec, base_ring: top}).load()
        this.top_ring = top
    }

    insert() {assert(false)}
    scan() {assert(false)}
}
