import path from 'path'
import {DataAccessError, DatabaseError} from "../errors.js"
import {T, assert, print, merge} from '../utils.js'
import {Item} from "../item.js"
import {Database} from "./db.js"
import {EditData} from "./edits.js";
import {IndexByCategory} from "./index.js";
import {Record, ItemRecord} from "./records.js";
import {DataRequest} from "./data_request.js";
import {DataSequence} from "./sequence.js";
import {JSONx} from "../serialize.js";
import {Data} from "../data.js";


/**********************************************************************************************************************
 **
 **  Data RING
 **
 */

export class Ring extends Item {

    static role = 'ring'    // Actor.role, for use in requests (ProcessingStep, DataRequest)

    data_sequence           // the main DataSequence containing all primary data of this ring
    indexes = new Map()     // {name: Index} map of all derived indexes of this ring

    name                    // human-readable name of this ring for find_ring()
    readonly                // if true, the ring does NOT accept modifications: inserts/updates/deletes

    start_iid = 0           // minimum IID of all items; helps maintain separation of IDs between different rings stacked together
    stop_iid                // (optional) maximum IID of all items


    constructor({name, ...opts}) {
        super(globalThis.registry)

        let {file} = opts
        this.opts = opts
        this.file = file
        this.name = name || (file && path.basename(file, path.extname(file)))

        let {readonly = false, start_iid = 0, stop_iid} = opts
        this.readonly = readonly
        this.start_iid = start_iid
        this.stop_iid = stop_iid
    }

    async open(req) {
        this.data_sequence = new DataSequence(this.opts)
        return this.data_sequence.open(req.make_step(this, 'open'))
    }

    async _init_indexes(req) {
        let filename = this.file.replace(/\.yaml$/, '.idx_category_item.jl')
        req = req.safe_step(this)

        this.indexes = new Map([
            ['idx_category_item', new IndexByCategory(this.data_sequence, filename)],    // index of item IDs sorted by parent category ID
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
    valid_id(id)    { return this.start_iid <= id && (!this.stop_iid || id < this.stop_iid) }

    assert_valid_id(id, msg) { if (!this.valid_id(id)) throw new DataAccessError(msg, {id, start_iid: this.start_iid, stop_iid: this.stop_iid}) }
    assert_writable(id, msg) { if (!this.writable(id)) throw new DataAccessError(msg, {id}) }


    /***  Data access & modification  ***/

    async handle(req, command = null) {
        /* Handle a DataRequest by passing it to an appropriate method of this.data sequence. */
        if (command === req.command)            // don't overwrite the command if it already occurred in the previous step
            command = null
        return this.data_sequence.handle(req.make_step(this, command))
    }

    async _insert(id, data) {
        /* Insert a new item into this ring. No forward to a lower ring. */
        return this.handle(new DataRequest(this, 'insert', {id, data}))
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


/**********************************************************************************************************************
 **
 **  DATABASE
 **
 */

export class ServerDB extends Database {
    /* Container for a number of Rings stacked on top of each other. Each select/insert/delete is executed on the outermost
       ring possible; while each update - on the innermost ring starting at the outermost ring containing a given ID.
       If ItemNotFound/ReadOnly is caught, the next ring is tried.
     */
    static role = 'db'      // for use in ProcessingStep and DataRequest

    rings = []              // [0] is the innermost ring (bottom of the stack), [-1] is the outermost ring (top)


    /***  Rings manipulation  ***/

    get top()       { return this.rings.at(-1) }
    get bottom()    { return this.rings[0] }
    get reversed()  { return this.rings.slice().reverse() }

    async init_as_cluster_database(rings) {
        /* Set and load rings for self while updating the global registry, so that subsequent ring objects (items)
           can be loaded from lower rings.
         */
        let req = new DataRequest(this, 'open')
        for (const spec of rings) {
            let ring = spec instanceof Ring ? spec : new Ring(spec)
            await ring.open(req.clone())
            this.append(ring)
            await globalThis.registry.boot()        // reload `root` and `site` to have the most relevant objects after a next ring is added
            await ring._init_indexes(req.clone())   // TODO: temporary

            // // if `spec` describes a new ring, insert `ring` as an item to the previous ring in the database
            // if (spec.file) {
            //     await this.insert_many(null, ring)
            // }
        }
    }

    append(ring) {
        /* The ring must be already open. */
        // if (this.top) this.top.stack(ring)
        this.rings.push(ring)
    }

    async find_ring({item, name}) {
        /* Return the top-most ring that contains a given item's ID (`item`), or has a given ring name (`name`).
           Return undefined if not found. Can be called to check if an item ID or a ring name exists.
         */
        let req = new DataRequest(this, 'find_ring', {id: item})
        for (const ring of this.reversed) {
            if (name && ring.name === name) return ring
            if (item) {
                let data = await ring.handle(req.clone(), 'get')
                if (data !== undefined) return ring
            }
        }
    }

    _prev(ring) {
        /* Find a ring that directly precedes `ring` in this.rings. Return the top ring if `ring` if undefined,
           or undefined if `ring` has no predecessor, or throw RingUnknown if `ring` cannot be found.
         */
        if (!ring) return this.top
        let pos = this.rings.indexOf(ring)
        if (pos < 0) throw new DatabaseError(`reference ring not found in the database`)
        if (pos > 0) return this.rings[pos-1]
    }

    _next(ring) {
        /* Find a ring that directly succeeds `ring` in this.rings. Return the bottom ring if `ring` is undefined,
           or undefined if `ring` has no successor, or throw RingUnknown if `ring` cannot be found.
         */
        if (!ring) return this.bottom
        let pos = this.rings.indexOf(ring)
        if (pos < 0) throw new DatabaseError(`reference ring not found in the database`)
        if (pos < this.rings.length-1) return this.rings[pos+1]
    }


    /***  Data access & modification (CRUD operations)  ***/

    async select(id) {
        // returns a json string (`data`) or undefined
        return this.forward_down(new DataRequest(this, 'select', {id}))
    }

    async update(id, ...edits) {
        /* Apply `edits` to an item's data and store under the `id` in top-most ring that allows writing this particular `id`.
           FUTURE: `edits` may contain tests, for example, for a specific item's version to apply the edits to.
         */
        assert(edits.length, 'missing edits')
        return this.forward_down(new DataRequest(this, 'update', {id, edits}))
    }

    async update_full(item) {
        /* Replace all data inside the item's record in DB with item.data. */
        return this.update(item.id, new EditData(item.dumpData()))
    }

    async insert(item) {
        /* Find the top-most ring where the item's ID is writable and insert there. If a new ID is assigned,
           it is written to item.id.
         */
        let id = item.id
        let req = new DataRequest(this, 'insert', {id, data: item.dumpData()})

        for (const ring of this.reversed)
            if (ring.writable(id)) return item.id = await ring.handle(req)

        return req.error_access(id === undefined ?
            "cannot insert the item, the ring(s) are read-only" :
            "cannot insert the item, either the ring(s) are read-only or the ID is outside the ring's valid ID range"
        )
    }

    async insert_many(target_ring = null, ...items) {
        /* Insert multiple interconnected items that reference each other and can't be inserted one by one.
           The insertion proceeds in two phases: 1) the items are inserted with empty data, to obtain their IDs;
           2) the items are updated with their actual data, with all references (incl. bidirectional) correctly replaced with IDs.
         */
        let req = new DataRequest(this, 'insert_many')
        let rings = this.reversed
        let empty_data = JSONx.stringify(new Data({_status_: 'draft'}))     // empty data

        if (target_ring) {
            let pos = rings.indexOf(target_ring)
            if (pos < 0) return req.error_access(`target ring not found in the database`)
            rings = rings.slice(pos)
        }

        // 1st phase: insert stubs, each stub is inserted to the highest possible ring
        for (let item of items) {
            let id = item.id
            let data = ''  // id > 0 ? empty_data : item.dumpData()
            let req2 = req.safe_step(null, 'insert', {id, data})     // insert stubs with empty data
            let ring = rings.find(r => r.writable(id))
            if (!ring) return req2.error_access(`cannot insert the item, either the ring(s) are read-only or the ID is outside the ring's valid ID range`)
            item.id = await ring.handle(req2)
        }

        // 2nd phase: update items with actual data
        for (let item of items) {
            // if item has no _data_, impute it from the object's properties; skip private props (starting with '_')
            if (!item._data_) {
                let entries = Object.entries(item).filter(([k]) => !k.startsWith('_'))
                item._data_ = new Data(entries)
                print(`imputed data for item [${item.id}]:`, entries)
            }
            await this.update_full(item)
        }
    }

    async delete(item_or_id) {
        /* Find and delete the top-most occurrence of the item or ID.
           Return true on success, or false if the ID was not found (no modifications are done in such case).
         */
        let id = T.isNumber(item_or_id) ? item_or_id : item_or_id.id
        return this.forward_down(new DataRequest(this, 'delete', {id}))
    }

    async *scan_all() {
        /* Scan each ring and merge the sorted streams of entries. */
        let streams = this.rings.map(r => r.scan_all())
        yield* merge(Item.orderAscID, ...streams)
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
        return req.error_item_not_found()
    }

    save(req) {
        /* Save an item update (args = {id,key,value}) to the lowest ring starting at current_ring that's writable and allows this ID.
           Called after the 1st phase of update which consisted of top-down search for the ID in the stack of rings.
         */
        let ring = req.current_ring || this.bottom
        let id = req.args.id

        // find the ring that's writable and allows this ID
        while (ring && !ring.writable(id))
            ring = this._next(ring)

        return ring ? ring.handle(req, 'put')
            : req.error_access(`can't save an updated item, either the ring(s) are read-only or the ID is outside the ring's valid ID range`)
    }
}

