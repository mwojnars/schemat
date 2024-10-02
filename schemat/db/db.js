import {DatabaseError} from "../common/errors.js"
import {T, assert, print, merge, fileBaseName, delay} from '../common/utils.js'
import {Item, Edit} from "../core/object.js"
import {DataOperator} from "./sequence.js";
import {Record, DataRecord} from "./records.js";
import {DataRequest} from "./data_request.js";
import {DataSequence, IndexSequence, Subsequence} from "./sequence.js";
import {Catalog, Data} from "../core/data.js";


/**********************************************************************************************************************
 **
 **  Database RING
 **
 */

export class Ring extends Item {

    static __category = 12  // ID of Ring category in the kernel
    static role = 'ring'    // Actor.role, for use in requests (ProcessingStep, DataRequest)

    data_sequence           // DataSequence containing all primary data of this ring
    index_sequence          // IndexSequence containing all indexes of this ring ordered by index ID and concatenated; each record key is prefixed with its index's ID
    indexes = new Catalog() // {name: Index} map of all derived indexes of this ring

    name                    // human-readable name of this ring for find_ring()
    readonly                // if true, the ring does NOT accept modifications: inserts/updates/deletes

    // validity range [start, stop) for IDs of NEWLY-INSERTED objects in this ring;
    // UPDATED objects (re-inserted here from lower rings) can still have IDs from outside this range (!)
    start_id = 0
    stop_id


    async __create__({name, ...opts}, req) {
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

        this.data_sequence = DataSequence.create(this, this._file)
        await this.data_sequence.open()

        let filename = this._file.replace(/\.yaml$/, '.index.jl')

        this.index_sequence = IndexSequence.create(this, filename)
        await this.index_sequence.open()

        // await this.rebuild_indexes()
    }

    async __init__() {
        /* Initialize the ring after it's been loaded from DB. */
        if (CLIENT) return
        print(`... ring loaded [${this.__id}] ${this.name} (${this.readonly ? 'readonly' : 'writable'})`)
        await this.data_sequence.load()
        await this.index_sequence.load()

        this._subsequences = new Map()          // (temporary) a map {id: Subsequence} of logical sequences for each index

        for (let index of this.indexes.values()) {
            await index.load()
            let subsequence = new Subsequence(index.id, this.index_sequence)
            this._subsequences.set(index.id, subsequence)
        }
    }

    // async rebuild_indexes() {
    //     // rebuild all indexes from the data sequence
    //     await this.index_sequence.erase()
    //     for await (let record /*DataRecord*/ of this.scan_all()) {
    //         // TODO: use this._subsequences here...
    //         for (let index of this.indexes.values()) {
    //             const binary_key = data_schema.encode_key([record.id])
    //             const change = new ChangeRequest(binary_key, null, record.data_json)
    //             await index.apply(change)
    //         }
    //     }
    // }

    async erase(req) {
        /* Remove all records from this ring; open() should be called first. */
        return !this.readonly
            ? this.data_sequence.erase(req)
            : req.error_access("the ring is read-only and cannot be erased")
    }

    // async flush() { return this.data.flush() }


    /***  Errors & internal checks  ***/

    writable(id)    { return !this.readonly && (id === undefined || this.valid_id(id)) }    // true if `id` is allowed to be inserted here (only when inserting a new object, not updating an existing one from a lower ring)
    valid_id(id)    { return this.start_id <= id && (!this.stop_id || id < this.stop_id) }


    /***  Data access & modification  ***/

    async handle(req, command = null) {
        /* Handle a DataRequest by passing it to an appropriate method of this.data sequence.
           This is the method that should be used for all standard operations: select/update/delete.
         */
        if (command === req.command)            // don't overwrite the command if it already occurred in the previous step
            command = null
        return this.data_sequence.handle(req.make_step(this, command))
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

    async update_full(id_or_item, data = null, req = null) {
        req = req || new DataRequest()
        let item = T.isNumber(id_or_item) ? null : id_or_item
        let id = item ? item._get_write_id() : id_or_item
        if (!data) data = item.dump_data()
        let edits = [new Edit('overwrite', {data})]
        return this.handle(req.safe_step(this, 'update', {id, edits}))
    }


    /***  Indexes and Transforms. Change propagation.  ***/

    propagate(req, change /*ChangeRequest*/) {
        /* Propagate a change in this ring's data to all indexes. The change is submitted by a child block of the data_sequence. */
        for (const index of this.indexes.values()) {
            let seq = this._subsequences.get(index.id)
            index.apply(change, seq)                    // no need to await, the result is not used by the caller
        }
    }

    async *scan_index(name, {start, stop, limit=null, reverse=false, batch_size=100} = {}) {
        /* Scan an index `name` in the range [`start`, `stop`) and yield the results.
           If `limit` is not null, yield at most `limit` items.
           If `reverse` is true, scan in the reverse order.
           If `batch_size` is not null, yield items in batches of `batch_size` items.
         */
        let index = this.indexes.get(name)              // Index object
        let seq = this._subsequences.get(index.id)
        yield* index.scan(seq, {start, stop, limit, reverse, batch_size})
    }

    async* scan_all() {
        /* Yield all items of this ring as DataRecord objects. For rebuilding indexes from scratch. */
        let data = DataOperator.create()
        for await (let record of data.scan(this.data_sequence))
            yield DataRecord.from_binary(record)
    }
}


/**********************************************************************************************************************
 **
 **  DATABASE
 **
 */

export class Database extends Item {
    /* A number of Rings stacked on top of each other. Each select/insert/delete is executed on the outermost
       ring possible; while each update - on the innermost ring starting at the outermost ring containing a given ID.
       If ItemNotFound/ReadOnly is caught, the next ring is tried.
       This class is only instantiated on the server, while the client uses a ClientDB proxy instead.
     */
    static __category = 11  // ID of Database category
    static role = 'db'      // for use in ProcessingStep and DataRequest

    rings = []              // [0] is the innermost ring (bottom of the stack), [-1] is the outermost ring (top)


    /***  Rings manipulation  ***/

    get top_ring()          { return this.rings.at(-1) }
    get bottom_ring()       { return this.rings[0] }
    get rings_reversed()    { return this.rings.slice().reverse() }

    async open(ring_specs) {
        /* After create(), create all rings according to `ring_specs` specification. */

        assert(this.is_newborn())               // open() is a mutable operation, so it can only be called on a newborn object (not in DB)
        print(`creating database...`)

        for (const spec of ring_specs) {
            let ring =
                spec instanceof Ring ? spec :
                spec.item            ? await schemat.get_loaded(spec.item) :
                                       await Ring.create(spec, new DataRequest(this, 'open'))

            await delay()       // strangely enough, without this delay, Ring.create() above is NOT fully awaited when using the custom module Loader (!?)

            this.rings.push(ring)
            print(`... ring created [${ring.__id || '---'}] ${ring.name} (${ring.readonly ? 'readonly' : 'writable'})`)
        }
    }

    async __init__() {
        if (CLIENT) return
        print(`loading database [${this.__id}] ${this.name}...`)
        return Promise.all(this.rings.map(ring => ring.load()))             // load all rings
    }

    async find_ring({id, name}) {
        /* Return the top-most ring that has a given object `id` in DB, or a given `name`.
           Return undefined if not found. Can be called to check if an item ID or a ring name exists.
         */
        let req = new DataRequest(this, 'find_ring', {id})
        for (const ring of this.rings_reversed) {
            if (name && ring.name === name) return ring
            if (id) {
                let data = await ring.handle(req.clone(), 'get')
                if (data !== undefined) return ring
            }
        }
    }

    _prev(ring) {
        /* Find a ring that directly precedes `ring` in this.rings. Return the top ring if `ring` if undefined,
           or undefined if `ring` has no predecessor, or throw RingUnknown if `ring` cannot be found.
         */
        if (!ring) return this.top_ring
        let pos = this.rings.indexOf(ring)
        if (pos < 0) throw new DatabaseError(`reference ring not found in the database`)
        if (pos > 0) return this.rings[pos-1]
    }

    _next(ring) {
        /* Find a ring that directly succeeds `ring` in this.rings. Return the bottom ring if `ring` is undefined,
           or undefined if `ring` has no successor, or throw RingUnknown if `ring` cannot be found.
         */
        if (!ring) return this.bottom_ring
        let pos = this.rings.indexOf(ring)
        if (pos < 0) throw new DatabaseError(`reference ring not found in the database`)
        if (pos < this.rings.length-1) return this.rings[pos+1]
    }


    /***  Data access & modification (CRUD operations)  ***/

    async select(req) {
        // returns a json string (`data`) or undefined
        return this.forward_down(req.make_step(this, 'select'))
    }

    async update(id, ...edits) {
        /* Apply `edits` to an item's data and store under the `id` in top-most ring that allows writing this particular `id`.
           FUTURE: `edits` may perform tests or create side effects, for example, to check for a specific item version
                   to apply the edits to; or to perform a sensitive operation inside the record-level exclusive lock,
                   even without changing the record's data.
         */
        assert(edits.length, 'missing edits')
        return this.forward_down(new DataRequest(this, 'update', {id, edits}))
    }

    async update_full(item) {
        /* Replace all data inside the item's record in DB with item.data. */
        let data = item.dump_data()
        return this.update(item.__id, new Edit('overwrite', {data}))
    }

    async insert(data, ring_name = null) {
        /* Find the top-most ring where the item's ID is writable and insert there. The newly assigned ID is returned.
           `ring` is an optional name of a ring to use.
         */
        if (!T.isString(data)) data = data.dump()
        let req = new DataRequest(this, 'insert', {data})
        let ring

        if (ring_name) {                                            // find the ring by name
            ring = await this.find_ring({name: ring_name})
            if (!ring) return req.error_access(`target ring not found: '${ring_name}'`)
        }
        else {
            ring = this.rings_reversed.find(r => r.writable())     // find the first writable ring
            if (!ring) return req.error_access("all ring(s) are read-only")
        }
        return ring.handle(req)                                     // perform the insert & return newly assigned ID
    }

    async insert_many(...items) {
        /* Insert multiple interconnected objects that reference each other and can't be inserted one by one.
           The insertion proceeds in two phases:
           1) the objects are inserted with empty data, to have their IDs assigned if missing;
           2) the objects are updated with actual data, with all references (incl. bidirectional) correctly replaced with IDs.
           This method can also be used to insert a single object that contains a self-reference.
         */
        let empty_data = new Data({__status: 'DRAFT'}).dump()               // empty data

        // 1st phase: insert stubs
        for (let item of items)
            item.__meta.provisional_id = await this.insert(empty_data)      // TODO: await all in parallel (here and below)

        // 2nd phase: update records with actual data
        for (let item of items) {
            item.__data = item.__data || await Data.from_object(item)       // if item has no __data, create it from the object's properties
            item.__id = item.__meta.provisional_id
            // TODO: check if the line below is needed or not? ultimately need to be removed...
            // schemat._register(item)      // during the update (below), the item may already be referenced by other items (during change propagation!), hence it needs to be registered to avoid creating incomplete duplicates
            await this.update_full(item)
        }
    }

    async delete(item_or_id) {
        /* Find and delete the top-most occurrence of the item or ID.
           Return true on success, or false if the ID was not found (no modifications are done in such case).
         */
        let id = T.isNumber(item_or_id) ? item_or_id : item_or_id.__id
        return this.forward_down(new DataRequest(this, 'delete', {id}))
    }

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
    //     yield* merge(Item.compare, ...streams)
    // }


    /***  Forwarding to other rings  ***/

    forward_down(req) {
        /* Forward the request to a lower ring if the current ring doesn't contain the requested item ID - during
           select/update/delete operations. It is assumed that args[0] is the item ID.
         */
        // print(`forward_down(${req.command}, ${req.args})`)
        let ring = this._prev(req.current_ring)
        if (ring) return ring.handle(req)
        return req.error_id_not_found()
    }

    save(req) {
        /* Save an item update (args = {id,key,value}) to the lowest ring that's writable, starting at current_ring.
           Called after the 1st phase of update which consisted of top-down search for the ID in the stack of rings.
           No need to check for the ID validity here, because ID ranges only apply to inserts, not updates.
         */
        let ring = req.current_ring || this.bottom_ring
        while (ring?.readonly) ring = this._next(ring)              // go upwards to find the first writable ring
        return ring ? ring.handle(req, 'put')
            : req.error_access(`can't save an updated item, either the ring(s) are read-only or the ID is outside the ring's valid ID range`)
    }
}

