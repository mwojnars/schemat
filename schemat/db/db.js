import {T, assert, print, merge, fileBaseName, delay} from '../common/utils.js'
import {DatabaseError} from "../common/errors.js"
import {WebObject} from "../core/object.js"
import {DataOperator, IndexInstance} from "./sequence.js";
import {data_schema, Record} from "./records.js";
import {DataRequest} from "./data_request.js";
import {DataSequence, IndexSequence, Subsequence} from "./sequence.js";
import {Catalog} from "../core/catalog.js";


/**********************************************************************************************************************
 **
 **  Database RING
 **
 */

export class Ring extends WebObject {

    static __category = 12  // ID of Ring category in the kernel
    static role = 'ring'    // Actor.role, for use in requests (ProcessingStep, DataRequest)

    data_sequence           // DataSequence containing all primary data of this ring
    index_sequence          // IndexSequence containing all indexes of this ring ordered by index ID and concatenated; each record key is prefixed with its index's ID

    index_specs             // specification of all indexes in this ring, as {name: Index} catalog

    // operators            // data operators introduced in this ring on top of the operators from the lower ring, as {name: Operator} catalog
    // streams              // logical sequences of structured data records as produced by a particular operator in this ring, named the same as operators
    // storage              // distributed key-value stores of different types and characteristics ('objects', 'blobs', 'indexes', 'aggregates', ...) for keeping streams outputs
    // all_operators

    name                    // human-readable name of this ring for find_ring()
    readonly                // if true, the ring does NOT accept modifications: inserts/updates/deletes

    lower_ring              // reference to the base Ring (lower ring) of this one
    lower_ring_writable     // if true, the requests going down through this ring are allowed to save their updates in lower ring(s)

    // validity range [start, stop) for IDs of NEWLY-INSERTED objects in this ring;
    // UPDATED objects (re-inserted here from lower rings) can still have IDs from outside this range (!)
    start_id = 0
    stop_id

    get all_index_specs() {
        /* A catalog of all index specifications in the entire ring stack (lower rings + this one). */
        if (!this.lower_ring) return this.index_specs || new Catalog()
        assert(this.lower_ring.is_loaded())
        let lower = this.lower_ring.all_index_specs || []
        return new Catalog([...lower, ...(this.index_specs || [])])
    }

    get indexes() {
        /* {id: IndexInstance} map of indexes within this particular ring, one for each definition in `index_specs`. */
        let instances = new Map()
        for (let [name, index] of this.all_index_specs) {
            let seq = new Subsequence(index.id, this.index_sequence)
            let idx = new IndexInstance(index, seq)
            instances.set(name, idx)
        }
        return instances
    }


    __new__({name, ...opts}) {
        let {file} = opts
        this._file = file
        this.name = name || fileBaseName(file)

        // if (!name && file)
        //     this.name = file.replace(/^.*\/|\.[^.]*$/g, '')         // extract the name from the file path (no directory, no extension)
        //     // this.name = file.substring(file.lastIndexOf('/') + 1, file.lastIndexOf('.') >= 0 ? file.lastIndexOf('.') : undefined)
        //     // this.name = path.basename(file, path.extname(file))

        let {readonly = false, start_id = 0, stop_id} = opts
        this.readonly = readonly
        this.start_id = start_id
        this.stop_id = stop_id

        // create sequences: data and indexes...

        let index_file = this._file.replace(/\.yaml$/, '.index.jl')
        this.data_sequence = DataSequence.new(this, this._file)
        this.index_sequence = IndexSequence.new(this, index_file)
    }

    async __init__() {
        /* Initialize the ring after it's been loaded from DB. */
        if (CLIENT) return
        print(`... ring loaded [${this.__id}] ${this.name} (${this.readonly ? 'readonly' : 'writable'})`)

        await this.lower_ring?.load()
        await this.data_sequence.load()
        await this.index_sequence.load()
        // await this.rebuild_indexes()

        for (let index of this.all_index_specs.values())
            await index.load()
    }

    async erase(req) {
        /* Remove all records from this ring; open() should be called first. */
        return !this.readonly
            ? this.data_sequence.erase(req)
            : req.error_access("the ring is read-only and cannot be erased")
    }

    async flush() { return this.data_sequence.flush() }


    /***  Errors & internal checks  ***/

    writable(id)    { return !this.readonly && (id === undefined || this.valid_id(id)) }    // true if `id` is allowed to be inserted here (only when inserting a new object, not updating an existing one from a lower ring)
    valid_id(id)    { return this.start_id <= id && (!this.stop_id || id < this.stop_id) }


    /***  Data access & modification  ***/

    async handle(req) {
        /* Handle a DataRequest by passing it to an appropriate method of this.data sequence.
           This is the method that should be used for all standard operations: select/update/delete.
         */
        // if (command === req.command)            // don't overwrite the command if it already occurred in the previous step
        //     command = null
        return this.data_sequence.handle(req.make_step(this))
    }

    // shortcut methods for handle() when the ring needs to be accessed directly without a database ...

    async select(id, req = null) {
        req = req || new DataRequest()
        return this.handle(req.safe_step(this, 'select', {id}))
    }

    async delete(id, req = null) {
        req = req || new DataRequest()
        return this.handle(req.safe_step(null, 'delete', {id}))
    }

    async insert(id, data, req = null) {
        req = req || new DataRequest()
        return this.handle(req.safe_step(this, 'insert', {id, data}))
    }

    async update_full(id_or_obj, data = null, req = null) {
        req ??= new DataRequest()
        let obj = T.isNumber(id_or_obj) ? null : id_or_obj
        let id  = obj?.id || id_or_obj
        data ??= obj.__data //__json
        let edits = [['overwrite', data]]
        return this.handle(req.safe_step(this, 'update', {id, edits}))
    }


    /***  Indexes and Transforms  ***/

    async *scan_index(name, {start, stop, limit=null, reverse=false, batch_size=100} = {}) {
        /* Scan an index `name` in the range [`start`, `stop`) and yield the results.
           If `limit` is not null, yield at most `limit` items.
           If `reverse` is true, scan in the reverse order.
           If `batch_size` is not null, yield items in batches of `batch_size` items.
         */
        let index = this.indexes.get(name)      // IndexInstance
        yield* index.scan({start, stop, limit, reverse, batch_size})
    }

    async* scan_all() {
        /* Yield all objects in this ring as {id, data} records. For rebuilding indexes from scratch. */
        let data = DataOperator.new()
        for await (let record of data.scan(this.data_sequence))
            yield record.decode_object()
    }

    async add_index(name, index_operator) {
        // TODO SEC: check permissions
        if (this.readonly) throw new Error("the ring is read-only")
        this[`index_specs.${name}`] = index_operator
        return this.save({broadcast: true})
    }

    async rebuild_index(index) {
        // await index.erase()
        for await (let {id, data} of this.scan_all()) {
            let key = data_schema.encode_key([id])
            let obj = await WebObject.from_data(id, data, {activate: false})
            await index.change(key, null, obj)
        }
    }

    async rebuild_indexes() {
        /* Rebuild all indexes by making a full scan of the data sequence. */
        await this.index_sequence.erase()
        for await (let {id, data} of this.scan_all()) {
            for (let index of this.indexes.values()) {
                let key = data_schema.encode_key([id])
                let obj = await WebObject.from_data(id, data, {activate: false})
                await index.change(key, null, obj)
            }
        }
    }
}


/**********************************************************************************************************************
 **
 **  DATABASE
 **
 */

export class Database extends WebObject {
    /* A number of Rings stacked on top of each other. Each select/insert/delete is executed on the outermost
       ring possible; while each update - on the innermost ring starting at the outermost ring containing a given ID.
       If ItemNotFound/ReadOnly is caught, the next ring is tried.
       This class is only instantiated on the server, while the client uses a ClientDB proxy instead.
     */
    static __category = 11  // ID of Database category
    static role = 'db'      // for use in ProcessingStep and DataRequest

    // properties:
    top_ring


    /***  Rings manipulation  ***/

    get rings()             { return this._rings }      // [0] is the innermost ring (bottom of the stack), [-1] is the outermost ring (top)
    get rings_reversed()    { return this._rings.toReversed() }
    get bottom_ring()       { return this.rings[0] }

    async open(ring_specs) {
        /* After create(), create all rings according to `ring_specs` specification. */

        assert(this.is_infant())                // open() is a mutable operation, so it can only be called on an infant object (not in DB)
        print(`creating database...`)
        let top

        for (const spec of ring_specs) {
            let ring =
                spec instanceof Ring ? spec :
                spec.item            ? await schemat.get_loaded(spec.item) :
                                       await Ring.new(spec).load()

            ring.lower_ring = top
            top = ring

            print(`... ring created [${ring.__id || '---'}] ${ring.name} (${ring.readonly ? 'readonly' : 'writable'})`)
        }
        this.top_ring = top
    }

    async __init__() {
        if (CLIENT) return
        print(`initializing database [${this.__id}] ...`)

        let rings = []
        for (let ring = this.top_ring; ring; ring = ring.lower_ring)
            rings.push(await ring.load())

        this._rings = rings.reverse()
    }

    async locate_ring(ring_or_id) {
        /* Return the position [0,1,...] in `rings` of the top-most ring with a given ID. */
        let id = Number.isInteger(ring_or_id) ? ring_or_id : ring_or_id.id
        return this.rings.findLastIndex(ring => ring.id === id)
    }

    async find_ring_name(name) {
        /* Return the top-most ring with a given `name`, or undefined if not found. Can be called to check if a ring name exists. */
        return this.rings_reversed.find(ring => ring.name === name)
    }

    async find_ring_containing(id) {
        /* Return the top-most ring that contains a given object `id`, or undefined if not found. */
        let req = new DataRequest(this, 'get', {id})
        for (let ring of this.rings_reversed)
            if (await ring.handle(req.clone()) !== undefined) return ring
    }


    /***  Data access & modification (CRUD operations)  ***/

    async select(req) {
        // returns a json string (`data`) or undefined
        return req.make_step(this, 'select').forward_down()
    }

    async update(id, ...edits) {
        /* Apply `edits` to an item's data and store under the `id` in top-most ring that allows writing this particular `id`.
           FUTURE: `edits` may perform tests or create side effects, for example, to check for a specific item version
                   to apply the edits to; or to perform a sensitive operation inside the record-level exclusive lock,
                   even without changing the record's data.
         */
        assert(edits.length, 'missing edits')
        return new DataRequest(this, 'update', {id, edits}).forward_down()
    }

    async insert(data, {ring, ring_name} = {}) {
        /* Find the top-most writable ring and insert `data` as a new entry there. Return {id, data} record.
           `ring` is an optional name of a ring to use.
         */
        // if (!T.isString(data)) data = data.dump?.() || JSONx.stringify(data)
        let req = new DataRequest(this, 'insert', {data})

        if (ring_name) {                                            // find the ring by name
            ring = await this.find_ring_name(ring_name)
            if (!ring) return req.error_access(`target ring not found: '${ring_name}'`)
        }
        else if (!ring) {
            ring = this.rings_reversed.find(r => r.writable())     // find the first writable ring
            if (!ring) return req.error_access("all ring(s) are read-only")
        }
        if (!ring.writable()) return req.error_access("the ring is read-only")
        return ring.handle(req)                                     // perform the insert & return newly assigned ID
    }

    // async update_full(item) {
    //     /* Replace all data inside the item's record in DB with item.data. */
    //     let data = item.__json
    //     return this.update(item.__id, ['overwrite', data])
    // }

    async delete(obj_or_id) {
        /* Find and delete the top-most occurrence of a web object, or ID.
           Return true on success, or false if the ID was not found (no modifications are done in such case).
         */
        let id = T.isNumber(obj_or_id) ? obj_or_id : obj_or_id.__id
        return new DataRequest(this, 'delete', {id}).forward_down()
    }


    /***  Indexes  ***/

    async *scan_index(name, {offset, limit, ...opts} = {}) {
        /* Yield a stream of plain Records from the index, merge-sorted from all the rings. */
        let streams = this.rings.map(r => r.scan_index(name, opts))
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

    async create_index(name, key, payload = undefined, {ring}) {
        if (ring && !this.rings.includes(ring)) throw new Error(`ring not found in the database: ${ring}`)
        ring ??= this.bottom_ring
        
        let DataIndex = await schemat.import('/$/sys/DataIndex')
        let index = DataIndex.create(name, key, payload)            // create index specification

        index = await index.save({ring, reload: true})              // insert `index` to `ring`
        await ring.add_index(index)

        // spawn the rebuild process of `index` in `ring` and all higher rings
        let pos = this.locate_ring(ring)
        for (let i = pos; i < this.rings.length; i++)
            this.rings[i].rebuild_index(index)
    }

    async rebuild_indexes() {
        for (let ring of this.rings)
            await ring.rebuild_indexes()
        return true
    }
}

