import {DataAccessError, DatabaseError} from "../common/errors.js"
import {T, assert, print, merge, fileBaseName} from '../common/utils.js'
import {Item} from "../item.js"
import {EditData} from "./edits.js";
import {IndexByCategory} from "./index.js";
import {Record, ItemRecord} from "./records.js";
import {DataRequest} from "./data_request.js";
import {DataSequence} from "./sequence.js";
import {Data} from "../data.js";


/**********************************************************************************************************************
 **
 **  Database RING
 **
 */

export class Ring extends Item {

    static _category_ = 12  // ID of Ring category
    static role = 'ring'    // Actor.role, for use in requests (ProcessingStep, DataRequest)

    data_sequence           // the main DataSequence containing all primary data of this ring
    indexes = new Map()     // {name: Index} map of all derived indexes of this ring

    name                    // human-readable name of this ring for find_ring()
    readonly                // if true, the ring does NOT accept modifications: inserts/updates/deletes

    start_id = 0            // minimum ID of all items; helps maintain separation of IDs between different rings stacked together
    stop_id                 // (optional) maximum ID of all items


    async __init__() {
        /* Initialize the ring after it's been loaded from DB. */
        await this.data_sequence.load()
        for (let index of this.indexes.values())
            await index.load()
    }

    async _init_indexes(req) {
        let filename = this._file.replace(/\.yaml$/, '.idx_category_item.jl')
        req = req.safe_step(this)

        this.indexes = new Map([
            ['idx_category_item', IndexByCategory.create(this, this.data_sequence, filename)],    // index of item IDs sorted by parent category ID
        ])

        for (let index of this.indexes.values())
            await index.open(req.clone())

        // for await (let record /*ItemRecord*/ of this.scan_all()) {
        //     for (let index of this.indexes.values()) {
        //         const binary_key = this.data.schema.encode_key([record.id])
        //         const change = new ChangeRequest(binary_key, null, record.data_json)
        //         await index.apply(change)
        //     }
        // }
    }

    async erase(req) {
        /* Remove all records from this ring; open() should be called first. */
        return !this.readonly
            ? this.data_sequence.erase(req)
            : req.error_access("the ring is read-only and cannot be erased")
    }

    // async flush() { return this.data.flush() }


    /***  Errors & internal checks  ***/

    writable(id)    { return !this.readonly && (id === undefined || this.valid_id(id)) }    // true if `id` is allowed to be written here
    valid_id(id)    { return this.start_id <= id && (!this.stop_id || id < this.stop_id) }

    assert_valid_id(id, msg) { if (!this.valid_id(id)) throw new DataAccessError(msg, {id, start_id: this.start_id, stop_id: this.stop_id}) }
    assert_writable(id, msg) { if (!this.writable(id)) throw new DataAccessError(msg, {id}) }


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

    async update(id_or_item, data = null, req = null) {
        req = req || new DataRequest()
        let item = T.isNumber(id_or_item) ? null : id_or_item
        let id = item ? item._get_write_id() : id_or_item
        if (!data) data = item.dump_data()
        let edits = [new EditData(data)]
        return this.handle(req.safe_step(this, 'update', {id, edits}))
    }


    /***  Indexes and Transforms. Change propagation.  ***/

    async* scan_all() {
        /* Yield all items of this ring as ItemRecord objects. */
        for await (let record of this.data_sequence.scan())
            yield ItemRecord.from_binary(record)
    }

    async *scan_index(name, {start, stop, limit=null, reverse=false, batch_size=100} = {}) {
        /* Scan an index `name` in the range [`start`, `stop`) and yield the results.
           If `limit` is not null, yield at most `limit` items.
           If `reverse` is true, scan in the reverse order.
           If `batch_size` is not null, yield items in batches of `batch_size` items.
         */
        let index = this.indexes.get(name)      // Index object
        yield* index.scan({start, stop, limit, reverse, batch_size})
    }
}

export class PlainRing extends Ring {
    /* A plain ring object that is NOT stored in DB. Only this kind of object needs __create__() and open(). */

    static _class_ = Ring          // the class to be saved in the DB

    __create__({name, ...opts}) {
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
    }

    async open() {
        this.data_sequence = DataSequence.create(this, this._file)
        return this.data_sequence.open()
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
    static _category_ = 11  // ID of Database category
    static role = 'db'      // for use in ProcessingStep and DataRequest

    rings = []              // [0] is the innermost ring (bottom of the stack), [-1] is the outermost ring (top)


    /***  Rings manipulation  ***/

    get top_ring()          { return this.rings.at(-1) }
    get bottom_ring()       { return this.rings[0] }
    get rings_reversed()    { return this.rings.slice().reverse() }

    __create__(specs) {
        this._ring_specs = specs
    }

    async open(cluster_ring = null) {
        /* Set and load rings for self while updating the global registry, so that subsequent ring objects (items)
           can be loaded from lower rings.
         */
        for (const spec of this._ring_specs) {
            await this.add_ring(spec)
            await schemat.boot()                    // reload `root_category` and `site` to have the most relevant objects after a next ring is added
        }
    }

    async add_ring(spec) {
        assert(this.is_newborn())                   // add_ring() is a mutable operation, so it can only be called on a newborn object (not in DB)
        let ring

        if (spec.item) ring = await schemat.get_loaded(spec.item)
        else if (spec instanceof Ring) ring = spec
        else {
            ring = PlainRing.create(spec)           // a plain ring object that is NOT stored in DB
            await ring.open()
        }
        this.rings.push(ring)

        print(`...opened ring [${ring._id_ || '---'}] ${ring.name} (${ring.readonly ? 'readonly' : 'read-write'})`)

        if (ring.is_newborn())
            await ring._init_indexes(new DataRequest(this, 'add_ring'))   // TODO: temporary
    }

    async __init__() {
        await Promise.all(this.rings.map(ring => ring.load()))              // load all rings
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
        return this.update(item._id_, new EditData(item.dump_data()))
    }

    async insert(item_or_data, ring_name = null) {
        /* Find the top-most ring where the item's ID is writable and insert there. If a new ID is assigned,
           it is written to item._id_. `ring` is an optional name of a ring to use.
           TODO: simplify the code if predefined ID is never used (id=undefined below); .save() can be used instead
         */
        let item = (item_or_data instanceof Item) && item_or_data
        let data = item ? item._data_ : item_or_data

        if (!T.isString(data)) data = data.dump()

        let id //= item._id_          // can be undefined
        let req = new DataRequest(this, 'insert', {id, data})
        let ring

        if (ring_name) {                                            // find the ring by name
            ring = await this.find_ring({name: ring_name})
            if (!ring) return req.error_access(`target ring not found: '${ring_name}'`)
            if (!ring.writable(id)) return req.error_access(`the ring '${ring_name}' is read-only or the ID is not writable`)
        }
        else ring = this.rings_reversed.find(r => r.writable(id))         // find the first ring where `id` can be written

        if (ring) {
            id = await ring.handle(req)
            if (item) item._set_id(id)
            return id
        }
        return req.error_access(id === undefined ?
            "cannot insert the item, the ring(s) are read-only" :
            "cannot insert the item, either the ring(s) are read-only or the ID is outside the ring's valid ID range"
        )
    }

    async insert_many(...items) {
        /* Insert multiple interconnected objects that reference each other and can't be inserted one by one.
           The insertion proceeds in two phases:
           1) the objects are inserted with empty data, to have their IDs assigned if missing;
           2) the objects are updated with actual data, with all references (incl. bidirectional) correctly replaced with IDs.
           This method can also be used to insert a single object that contains a self-reference.
         */
        let empty_data = new Data({_status_: 'DRAFT'}).dump()               // empty data

        // 1st phase: insert stubs
        for (let item of items)
            item._meta_.provisional_id = await this.insert(empty_data)      // TODO: await all in parallel (here and below)

        // 2nd phase: update records with actual data
        for (let item of items) {
            item._data_ = item._data_ || await Data.from_object(item)       // if item has no _data_, create it from the object's properties
            item._id_ = item._meta_.provisional_id
            schemat.register(item)      // during the update (below), the item may already be referenced by other items (during change propagation!), hence it needs to be registered to avoid creating incomplete duplicates
            await this.update_full(item)
        }
    }

    async delete(item_or_id) {
        /* Find and delete the top-most occurrence of the item or ID.
           Return true on success, or false if the ID was not found (no modifications are done in such case).
         */
        let id = T.isNumber(item_or_id) ? item_or_id : item_or_id._id_
        return this.forward_down(new DataRequest(this, 'delete', {id}))
    }

    async *scan_all() {
        /* Scan each ring and merge the sorted streams of entries. */
        // TODO: remove duplicates while merging
        let streams = this.rings.map(r => r.scan_all())
        yield* merge(Item.compare, ...streams)
    }

    async *scan_index(name, opts) {
        /* Yield a stream of plain Records from the index, merge-sorted from all the rings. */
        let streams = this.rings.map(r => r.scan_index(name, opts))
        yield* merge(Record.compare, ...streams)
        // TODO: apply `limit` to the merged stream
        // TODO: apply `batch_size` to the merged stream and yield in batches
    }


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
        /* Save an item update (args = {id,key,value}) to the lowest ring starting at current_ring that's writable and allows this ID.
           Called after the 1st phase of update which consisted of top-down search for the ID in the stack of rings.
         */
        let ring = req.current_ring || this.bottom_ring
        let id = req.args.id

        // find the ring that's writable and allows this ID
        while (ring && !ring.writable(id))
            ring = this._next(ring)

        return ring ? ring.handle(req, 'put')
            : req.error_access(`can't save an updated item, either the ring(s) are read-only or the ID is outside the ring's valid ID range`)
    }
}

