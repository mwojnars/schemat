import {T, assert, print, merge, fileBaseName, sum} from '../common/utils.js'
import {DataAccessError, DatabaseError, ObjectNotFound} from "../common/errors.js"
import {compare_uint8} from "../common/binary.js";
import {Struct} from "../common/catalog.js";
import {WebObject} from "../core/object.js"
import {data_schema} from "./records.js";
import {DataRequest} from "./data_request.js";
import {DataSequence} from "./sequence.js";
import {DataBlock} from "./block.js";


/**********************************************************************************************************************
 **
 **  Database RING
 **
 */

export class Ring extends WebObject {
    /* Collection of (named) data streams. The primary one is the "objects" stream that contains web objects and supplies
       input data to other (derived) streams: indexes, aggregations etc. Some streams may have special type (e.g., "blobs").
     */

    file_tag
    main_sequence           // DataSequence containing all primary data of this ring

    name                    // human-readable name of this ring for get_ring()
    readonly                // if true, the ring does NOT accept modifications: inserts/updates/deletes
    insert_mode             // if `compact`, new objects are inserted at the lowest possible ID in data blocks, possibly below autoincrement; requires MemoryStore for data blocks

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

    get sequences() {
        /* All sequences of this ring inferred from main_sequence by following .derived links. */
        assert(this.main_sequence.is_loaded())
        return [this.main_sequence, ...this.main_sequence.derived || []]
    }

    get operators() {
        /* Map of all operators in this ring stack keyed by operator's name. */
        let base_operators = this.base_ring?.operators || []
        let own_operators = this.sequences.map(seq => {
            let op = seq.operator
            assert(op.is_loaded())
            return [op.name, op]
        })
        return new Map([...base_operators, ...own_operators])
    }

    get sequence_by_operator() {
        /* Map of sequences keyed by their operator's ID. */
        return new Map(this.sequences.map(seq => [seq.operator.id, seq]))
    }

    get id_insert_zones() {
        /* [min_id_exclusive, min_id_forbidden, min_id_sharded] grouped into an array, with the 2nd one imputed if missing.
           The lack of `min_id_exclusive` indicates there's NO exclusive zone.
         */
        // `min_id_sharded` is always defined and positive; `min_id_exclusive` and `min_id_sharded` can be undefined
        let [A, B, C] = [this.min_id_exclusive, this.min_id_forbidden, this.min_id_sharded]
        return [A, B || C, C]
    }


    __new__({name, base_ring, file_tag, file, min_id_exclusive, min_id_forbidden, min_id_sharded, readonly = false} = {}) {
        this.name = name || (file && fileBaseName(file))
        this.base_ring = base_ring

        // if (!name && file)
        //     this.name = file.replace(/^.*\/|\.[^.]*$/g, '')         // extract the name from the file path (no directory, no extension)
        //     // this.name = file.substring(file.lastIndexOf('/') + 1, file.lastIndexOf('.') >= 0 ? file.lastIndexOf('.') : undefined)
        //     // this.name = path.basename(file, path.extname(file))

        this.file_tag = file_tag
        this.readonly = readonly
        this.min_id_exclusive = min_id_exclusive
        this.min_id_forbidden = min_id_forbidden
        this.min_id_sharded = min_id_sharded
    }

    async __setup__() {
        /* Create `main_sequence` and all derived sequences as present in the lower ring. */

        let base = await this.base_ring?.load()

        this.min_id_sharded ??= this.base_ring.min_id_sharded

        let DataSequence = this.__std.DataSequence
        this.main_sequence = DataSequence.new({ring: this, operator: base?.main_sequence.operator})
        if (!base) return

        let IndexSequence = this.__std.IndexSequence
        for (let seq of base.sequences)
            this.sequences.push(IndexSequence.new({ring: this, operator: seq.operator}))
    }

    async __load__() {
        /* Initialize the ring after it's been loaded from DB. */
        if (CLIENT) return
        // print(`... ring [${this.id || '---'}] ${this.name} (${this.readonly ? 'readonly' : 'writable'})`)

        await super.__load__()
        await this.base_ring?.load()
        await this.main_sequence.load()

        this.validate_zones()
    }

    async erase(req) {
        /* Remove all records from this ring; open() should be called first. */
        if (this.readonly) throw new DataAccessError("the ring is read-only and cannot be erased")
        return this.main_sequence.erase(req)
    }

    async flush() { return this.main_sequence.flush() }


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
                    throw new Error(`base-3 shard [${this.shard3.label}] of ring ${this} overlaps with shard [${ring.shard3.label}] of ${ring.__label}`)

        if (!A) return true                     // no exclusive zone, nothing more to check

        // exclusive zone = [A, B) must NOT overlap with exclusive or sharded zone of any lower ring...
        // for sharded zones, must hold:  B <= c_min := min(min_id_sharded) across lower rings
        let c_min = Math.min(...stack.map(r => r.min_id_sharded))
        if (B >= c_min) throw new Error(`exclusive ID-insert zone [${A},${B}) of ${this} overlaps with sharded zone [${c_min},+inf) of some lower ring`)

        // for exclusive zones of every lower ring, must hold:  B <= min_id_exclusive || A >= min_id_forbidden
        for (let ring of stack) {
            let [a, b] = [ring.min_id_exclusive, ring.min_id_forbidden ?? ring.min_id_sharded]
            if (a && B > a && A < b)
                throw new Error(`exclusive ID-insert zone [${A},${B}) of ${this} overlaps with exclusive zone [${a},${b}) of ${ring.__label}`)
        }
        return true
    }


    /***  Data access & modification  ***/

    _find_block(id) {
        assert(this.__meta.active, `trying to access uninitialized ring '${this.name}' [${this.id}] for object [${id}]`)
        return this.main_sequence.find_block_id(id)
    }

    _random_block() {
        assert(this.__meta.active, `trying to access uninitialized ring '${this.name}' [${this.id}] for insert`)
        return this.main_sequence.blocks[0]
    }

    async select(id, req) {
        return this._find_block(id).$agent.select(id, req || new DataRequest())
    }

    async delete(id, req) {
        return this._find_block(id).$agent.delete(id, req || new DataRequest())
    }

    async insert(data, opts = {}) {
        let block = opts.id ? this._find_block(opts.id) : this._random_block()
        return block.$agent.insert(data, opts)
    }

    async update(id, edits, req) {
        /* Apply `edits` to an item's data and store under the `id` in top-most ring that allows writing this particular `id`.
           FUTURE: `edits` may perform tests or create side effects, for example, to check for a specific item version
                   to apply the edits to; or to perform a sensitive operation inside the record-level exclusive lock,
                   even without changing the record's data.
         */
        if (!edits?.length) return
        return this._find_block(id).$agent.update(id, edits, req || new DataRequest())
    }

    async upsave(id, data, req) {
        return this._find_block(id).$agent.upsave(id, data, req || new DataRequest())
    }


    /***  Indexes and Transforms  ***/

    async *scan_binary(operator, opts) {
        /* Scan a sequence in the range [`start`, `stop`) and yield [key-binary, value-json] pairs. */
        let seq = this.sequence_by_operator.get(operator.id)
        yield* seq.scan_binary(opts)
    }

    async 'action.create_sequence'(operator) {
        // TODO SEC: check permissions
        if (this.readonly) throw new Error("the ring is read-only")
        assert(this.__ring)
        let opts = {ring: this.__ring, broadcast: true}
        let IndexSequence = this.__std.IndexSequence
        let seq = await IndexSequence.new({ring: this, operator}).save(opts)
        this.sequences = [...this.sequences, seq]
        await this.save(opts)

        // TODO: block #0 to be deployed as agent .. cluster.$leader.deploy(block) .. node.$master.deploy(agent)
        // TODO: main_sequence accessible as 'main' in .sequences
        // TODO: main_sequence > main_sequence ... .sequences turned into getter, inferred from main_sequence by .derived links
        // TODO: set `source` in operators
        // // boot up this sequence by requesting all source blocks to send initial data
        // let src_operator = operator.source
        // let src_sequence = this.sequence_by_operator.get(src_operator.id)
        // src_sequence.blocks.map(block => block.$agent.boot_derived(seq))
    }

    async rebuild_indexes() {
        /* Rebuild all derived sequences by making a full scan of the data sequence. */
        let sequences = this.sequences.slice(1)     // all derived sequences, main_sequence skipped
        await Promise.all(sequences.map(seq => seq.erase()))

        for await (let {id, data} of this.main_sequence.scan_objects()) {
            let key = data_schema.encode_key([id])
            let obj = await WebObject.from_data(id, data, {activate: false})
            await Promise.all(sequences.map(seq => seq.capture_change(key, null, obj)))
        }
    }
}

export class BootRing extends Ring {
    /* During boot, we don't have access to category objects, so we cannot create full web objects (with __category)
       comprising the database rings. Also, the objects created are only temporary and *not* inserted to DB, so their
       __setup__() is *not* executed, hence all initialization must be done in __new__().
     */
    file        // boot file path

    __new__() {
        // the draft object here is created from a class and lacks __category; only allowed during boot
        this.main_sequence = DataSequence.draft({ring: this}, this.file)
    }

    async select(id, req)  {
        // print('boot ring select()')
        let block = this._find_block(id)
        await block.load()
        return block.select(id, req || new DataRequest())
    }

    insert() {assert(false, `inserts not supported in BootRing`)}
    update() {assert(false, `updates not supported in BootRing`)}
    delete() {assert(false, `deletes not supported in BootRing`)}
    scan()   {assert(false, `scans not supported in BootRing`)}
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
    application         // reference to an Application object that's typically stored in `top_ring` of THIS very database;
                        // for this reason it can only get fully loaded in the execution context of this database, not in the kernel context


    /***  Ring manipulation  ***/

    get rings()             { return this.top_ring.stack }      // [0] is the innermost ring (bottom of the stack), [-1] is the outermost ring (top)
    get rings_reversed()    { return this.rings.toReversed() }
    get bottom_ring()       { return this.rings[0] }
    get ring_names()        { return new Map(this.rings.map(r => [r.name, r])) }    // may not be unique
    get ring_ids()          { return new Map(this.rings.map(r => [r.id, r])) }      // should be unique


    async __load__() {
        if (CLIENT) return
        // print(`initializing database [${this.id}] ...`)
        // assert(this.top_ring, 'missing rings in the database')
        await this.top_ring?.load()
    }

    get_ring(ring) {
        /* Return the top-most ring with a given name or ID, throw an error if not found; `ring` can also be a Ring object,
           in which case it is replaced with the same-ID object from the ring stack.
         */
        if (ring == null) return this.top_ring
        if (typeof ring === 'string') ring = this.ring_names.get(ring)
        else if (typeof ring === 'number') ring = this.ring_ids.get(ring)
        else ring = this.ring_ids.get(ring?.id)         // replace `ring` with the database's instance
        if (!ring) throw new DataAccessError(`target ring not found in the database`)
        return ring
    }

    async select(id, {ring} = {}) {
        return this.get_ring(ring).select(id)
    }

    async insert(entries, {ring, ...opts} = {}) {
        /* Find the top-most writable ring and insert a number of [provisional-id, data] entries. Return an array of {id, data} records.
           If `ring` is given (name/object/ID), the entry is inserted to this particular ring, or error is raised if read-only.
         */
        assert(Array.isArray(entries))
        if (!entries.length) return []

        ring = this.get_ring(ring)
        if (ring.readonly) throw new DataAccessError(`target ring is read-only`)
        return ring.insert(entries, opts)
    }

    async update(id_edits, {ring, ...opts} = {}) {
        /* Apply edits to records in the database. `id_edits` is an array of pairs: [id, array_of_edits], or one such pair. */
        if (!Array.isArray(id_edits)) id_edits = [id_edits]
        ring = this.get_ring(ring)
        await Promise.all(id_edits.map(([id, edits]) => ring.update(id, edits)))
    }

    async delete(ids, {ring, ...opts} = {}) {
        /* Delete a single ID, or an array of IDs, from the database. */
        if (!Array.isArray(ids)) ids = [ids]
        ring = this.get_ring(ring)
        let counts = await Promise.all(ids.map(id => ring.delete(id)))
        return sum(counts)
    }

    async submit(inserts = null, updates = null, deletes = null, opts = {}) {
        /* Perform multiple mutations of different types: insertions, updates, deletions.
           This method is like insert() + update() + delete(), combined. Arguments:
           - inserts = an array of [negative-provisional-id, data] entries to insert;
           - updates = an array of [id, array_of_edits] pairs for objects to be mutated;
           - deletes = an array of IDs to delete.
           All arguments except `opts` must be arrays or null/undefined.
         */
        let inserted, deleted
        let deleting = deletes?.length ? this.delete(deletes, opts) : null      // deletions may run in parallel with inserts & updates

        // inserts must be done together and receive their IDs before the updates are processed, due to possible cross-references
        if (inserts?.length) {
            inserted = await this.insert(inserts, opts)

            // scan argument lists of all edits in `updates` and replace provisional IDs in references with final IDs from `inserted`
            let edits = updates?.flatMap(([_, edits]) => edits)
            DataBlock.rectify_refs(edits, inserts, inserted)
        }
        if (updates?.length) await this.update(updates, opts)
        if (deleting) deleted = await deleting

        // inserted = an array of IDs assigned to the inserted objects, in the same order as in `inserts`
        // deleted  = an integer number of objects actually found in DB and deleted
        return {inserted, deleted}
    }


    /***  Indexes  ***/

    async *scan(name, {offset, start, stop, ...opts} = {}) {
        /* Yield a stream of pseudo-objects loaded from a derived sequence, merge-sorted from all rings, and decoded.
           A pseudo-object resembles the original web object where field values for the record were sourced from,
           with a few important differences:
           - it lacks a class or category (plain JS object)
           - it lacks those attributes that were not included in the record
           - it has `null` in place of attributes that were originally missing
           - it has explicit attributes for all original props, even those that were imputed, taken from defaults, or calculated via getters
           - it lacks repeated values for `obj.prop` if `prop` was stored in the key part of the record
           - it has an explicit `obj.prop$` attribute if `prop$` was stored in the value part of the record
           - in more complex cases, like aggregations etc., a pseudo-object may not map to any kind of web object at all

           If `limit` is not null, yield at most `limit` items.
           If `reverse` is true, scan in the reverse order.
           If `batch_size` is not null, yield records in batches of `batch_size` items. (TODO)
         */
        let operator = this.top_ring.operators.get(name)
        if (!operator) throw new Error(`unknown derived sequence '${name}'`)

        let schema = operator.record_schema
        let compare = ([key1], [key2]) => compare_uint8(key1, key2)

        // convert `start` and `stop` to binary keys (Uint8Array)
        if (start !== undefined) start = schema.encode_key(start)
        if (stop !== undefined) stop = schema.encode_key(stop)
        opts = {...opts, start, stop}

        let streams = this.rings.map(r => r.scan_binary(operator, opts))
        let merged = merge(compare, ...streams)
        let {limit} = opts
        
        if (offset)
            for (let i = 0; i < offset; i++) {
                let next = await merged.next()
                if (next.done) return
            }

        let count = 0
        for await (let [key, val] of merged)
            if (limit != null && ++count > limit) break
            else yield schema.decode_object(key, val)

        // TODO: apply `batch_size` to the merged stream and yield in batches
    }

    async 'action.create_index'(name, key_fields, val_fields = undefined, {category, ring} = {}) {
        /* Add a new index in `ring` and all rings above. If not provided, `ring` is the bottom of the ring stack (ring-kernel).
           Schema of the new index is defined by `key_names` and `val_fields` (arrays of property names).
         */
        // if (!Array.isArray(key_names) || key_names.length === 0) throw new Error(`index key must be an array with at least one element, got ${key_names}`)
        // if (val_fields && !Array.isArray(val_fields)) throw new Error(`record payload specification must be an array, got ${val_fields}`)

        ring = ring ? this.get_ring(ring) : this.bottom_ring

        // check that `name` can be used as an operator name
        if (this.top_ring.operators.has(name)) throw new Error(`'${name}' is already used as an operator name`)

        // create index specification
        let ObjectIndexOperator = this.__std.ObjectIndexOperator
        let index = await ObjectIndexOperator.new({name, key_fields, val_fields, category}).save({ring})
        // schemat._transaction.getStore()?.log_modified(index)

        // create streams for `index`, in `ring` and all higher rings
        let pos = this.rings.indexOf(ring)
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

    /***  Administrative  ***/

    async 'action.admin_reinsert'(ids, {id: new_id, ring, compact = false} = {}) {
        /* Remove object(s) from its current ring and reinsert under new `id` into `ring` (if present), or to the top-most ring.
           Only for development purposes, this operation may lead to data inconsistencies. Changing object IDs should never
           be done in production, especially that the entire database is scanned for references after each re-insert.
           `ids` can be a number, an array, a string with comma-separated numbers (no spaces) or "X-Y" value ranges.
         */
        ids = String(ids)
        print(`\nreinserting object(s) [${ids}] ...`)

        ring = this.get_ring(ring)
        let id_list = []
        let obj

        // parse the list of `ids`, which is a comma-separated list of integers or "X-Y" value ranges
        for (let id of ids.split(','))
            if (id.includes('-')) {
                let [start, stop] = id.split('-')
                start = Number(start)
                stop = Number(stop)
                for (let i = start; i <= stop; i++) id_list.push(i)
            }
            else id_list.push(Number(id))

        if (new_id && id_list.length > 1) throw new Error('cannot specify a new ID when reinserting multiple objects')

        // reinsert each object
        for (let id of id_list) {
            try { obj = await schemat.get_loaded(id) }
            catch (ex) {
                if (ex instanceof ObjectNotFound) {
                    print(`...WARNING: object [${id}] not found, skipping`)
                    continue
                }
                else throw ex
            }

            let opts = {insert_mode: compact ? 'compact' : null, id: new_id}
            new_id = (await ring.insert([[-1, obj.__json]], opts))[0]

            // let opts = {ring, insert_mode: compact ? 'compact' : null, id: new_id}
            // new_id = (await WebObject.newborn(obj.__json).save(opts)).id
            assert(new_id)

            await this._update_references(id, new_id)
            await obj.delete_self().save()

            print(`...reinserted object [${id}] as [${new_id}]`)
            new_id = undefined
        }
        print()
    }

    async _update_references(old_id, new_id) {
        /* Scan all items in the DB and replace references to `old_id` with references to `new_id`. */
        print(`_update_references() old_id=${old_id} new_id=${new_id}:`)
        if (old_id === new_id) return
        let target = WebObject.stub(new_id)

        // transform function: checks if a sub-object is an item of ID=old_id and replaces it with new `item` if so
        let transform = (obj => obj?.id === old_id ? target : undefined)

        // search for references to `old_id` in all rings and all records
        for (let ring of this.rings)
            for await (let {id, data} of ring.main_sequence.scan_objects()) {
                let old_json = data.dump()
                let new_json = Struct.transform(data, transform).dump()     // `data` catalog is transformed in place (!)

                if (old_json === new_json) continue       // no changes? don't update the record
                if (ring.readonly)
                    print(`...WARNING: cannot update a reference [${old_id}] > [${new_id}] in item [${id}], the ring is read-only`)
                else {
                    print(`...updating references in object [${id}]`)
                    await WebObject.editable(id).edit.overwrite(data).save({ring})
                }
            }
    }
}


export class BootDatabase extends Database {
    async open(ring_specs) {
        /* Create bootstrap rings according to `ring_specs` specification. */

        // assert(this.is_newborn())           // open() is a mutating operation, it can only be called on a newborn object (not in DB)
        print(`creating bootstrap database...`)
        let top
        for (let spec of ring_specs)
            top = await BootRing.draft({...spec, base_ring: top}).load()
        this.top_ring = top
    }

    add_ring(ring) {
        ring.base_ring = this.top_ring
        this.top_ring = ring
    }

    insert() {assert(false)}
    scan() {assert(false)}
}
