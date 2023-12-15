import path from 'node:path'
import {DataAccessError, DatabaseError} from "../common/errors.js"
import {T, assert, print, merge} from '../common/utils.js'
import {Item} from "../item.js"
import {EditData} from "./edits.js";
import {IndexByCategory} from "./index.js";
import {Record, ItemRecord, ChangeRequest} from "./records.js";
import {DataRequest} from "./data_request.js";
import {DataSequence} from "./sequence.js";
import {JSONx} from "../serialize.js";
import {Data} from "../data.js";


/**********************************************************************************************************************/

export function object_to_item_data(obj) {
    /* Convert a plain object to a Data instance that can be assigned to item's _data_. */

    // filter out undefined values, private props (starting with '_'), and Item's special attributes
    let entries = Object.entries(obj).filter(([k, v]) =>
        (v !== undefined) &&
        !k.startsWith('_') &&
        !['registry','action'].includes(k))

    // if `obj` has a class, and it's not Item, store it in the _class_ attribute
    if (obj.constructor !== Object && obj.constructor !== Item)
        entries.push(['_class_', obj.constructor])

    // print(`object_to_item_data(${obj}) =>`, entries)
    return new Data(Object.fromEntries(entries))
}


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
    valid_id(id)    { return this.start_iid <= id && (!this.stop_iid || id < this.stop_iid) }

    assert_valid_id(id, msg) { if (!this.valid_id(id)) throw new DataAccessError(msg, {id, start_iid: this.start_iid, stop_iid: this.stop_iid}) }
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
        let id = item ? item._id_ : id_or_item
        if (!data) data = item.dumpData()
        let edits = [new EditData(data)]
        return this.handle(req.safe_step(this, 'update', {id, edits}))
    }

    async insert_many(...items) {
        /* Insert multiple interconnected items that reference each other and can't be inserted one by one.
           The insertion proceeds in two phases: 1) the items are inserted with empty data, to obtain their IDs if missing;
           2) the items are updated with their actual data, with all references (incl. bidirectional) correctly replaced with IDs.
         */
        let empty_data = JSONx.stringify(new Data({_status_: 'draft'}))     // empty data

        // 1st phase: insert stubs
        for (let item of items)
            item._set_id(await this.insert(item._id_, empty_data))

        // 2nd phase: update items with actual data
        for (let item of items) {
            // if item has no _data_, create it from the object's properties
            item._data_ = item._data_ || object_to_item_data(item)
            await this.update(item)
        }
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

class PlainRing extends Ring {
    /* A plain ring object that is NOT stored in DB. Only this kind of object needs __create__() and open(). */

    __create__({name, ...opts}) {
        let {file} = opts
        this._file = file
        this.name = name || (file && path.basename(file, path.extname(file)))

        let {readonly = false, start_iid = 0, stop_iid} = opts
        this.readonly = readonly
        this.start_iid = start_iid
        this.stop_iid = stop_iid
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

export class ServerDB {
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

    async init_as_cluster_database(rings, cluster_ring = null) {
        /* Set and load rings for self while updating the global registry, so that subsequent ring objects (items)
           can be loaded from lower rings.
         */
        let req = new DataRequest(this, 'open')
        for (const spec of rings) {
            let ring

            if (spec.item) ring = await registry.getLoaded(spec.item)
            else if (spec instanceof Ring) ring = spec
            else {
                ring = PlainRing.create(spec)           // a plain ring object that is NOT stored in DB
                await ring.open()
            }

            this.append(ring)
            print(`...opened ring [${ring._id_ || '---'}] ${ring.name} (${ring.readonly ? 'readonly' : 'read-write'})`)

            await registry.boot()                       // reload `root` and `site` to have the most relevant objects after a next ring is added

            if (!ring.is_linked())
                await ring._init_indexes(req.clone())   // TODO: temporary
        }
        for (let ring of this.rings.slice(2))
            if (cluster_ring && !ring._id_) {
                // if `ring` is newly created, insert it as an item to the `cluster_ring`, together with its sequences and blocks
                let sequences = [...ring.indexes.values(), ring.data_sequence]
                let blocks = sequences.map(seq => seq.blocks[0])
                await cluster_ring.insert_many(ring, ...sequences, ...blocks)
            }
    }

    append(ring) {
        /* The ring must be already open. */
        // if (this.top) this.top.stack(ring)
        this.rings.push(ring)
    }

    async find_ring({id, name}) {
        /* Return the top-most ring that has a given object `id` in DB, or a given `name`.
           Return undefined if not found. Can be called to check if an item ID or a ring name exists.
         */
        let req = new DataRequest(this, 'find_ring', {id})
        for (const ring of this.reversed) {
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

    async select(req) {
        // returns a json string (`data`) or undefined
        return this.forward_down(req.make_step(this, 'select'))
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
        return this.update(item._id_, new EditData(item.dumpData()))
    }

    async insert(item, ring_name = null) {
        /* Find the top-most ring where the item's ID is writable and insert there. If a new ID is assigned,
           it is written to item._id_. `ring` is an optional name of a ring to use.
         */
        let id = item._id_          // can be undefined
        let req = new DataRequest(this, 'insert', {id, data: item.dumpData()})
        let ring

        if (ring_name) {                                            // find the ring by name
            ring = await this.find_ring({name: ring_name})
            if (!ring) return req.error_access(`target ring not found: '${ring_name}'`)
            if (!ring.writable(id)) return req.error_access(`the ring '${ring_name}' is read-only or the ID is not writable`)
        }
        else ring = this.reversed.find(r => r.writable(id))         // find the first ring where `id` can be written

        if (ring) {
            id = await ring.handle(req)
            return item._set_id(id)
        }
        return req.error_access(id === undefined ?
            "cannot insert the item, the ring(s) are read-only" :
            "cannot insert the item, either the ring(s) are read-only or the ID is outside the ring's valid ID range"
        )
    }

    // async insert_many(target_ring = null, ...items) {
    //     /* Insert multiple interconnected items that reference each other and can't be inserted one by one.
    //        The insertion proceeds in two phases: 1) the items are inserted with empty data, to obtain their IDs;
    //        2) the items are updated with their actual data, with all references (incl. bidirectional) correctly replaced with IDs.
    //      */
    //     let req = new DataRequest(this, 'insert_many')
    //     let rings = this.reversed
    //     let empty_data = JSONx.stringify(new Data({_status_: 'draft'}))     // empty data
    //
    //     if (target_ring) {
    //         let pos = rings.indexOf(target_ring)
    //         if (pos < 0) return req.error_access(`target ring not found in the database`)
    //         rings = rings.slice(pos)
    //     }
    //
    //     // 1st phase: insert stubs, each stub is inserted to the highest possible ring
    //     for (let item of items) {
    //         let id = item._id_
    //         let data = ''  // id > 0 ? empty_data : item.dumpData()
    //         let req2 = req.safe_step(null, 'insert', {id, data})     // insert stubs with empty data
    //         let ring = rings.find(r => r.writable(id))
    //         if (!ring) return req2.error_access(`cannot insert the item, either the ring(s) are read-only or the ID is outside the ring's valid ID range`)
    //         item._set_id(await ring.handle(req2))
    //     }
    //
    //     // 2nd phase: update items with actual data
    //     for (let item of items) {
    //         // if item has no _data_, impute it from the object's properties; skip private props (starting with '_')
    //         if (!item._data_) {
    //             let entries = Object.entries(item).filter(([k]) => !k.startsWith('_'))
    //             item._data_ = new Data(entries)
    //             print(`imputed data for item [${item._id_}]:`, entries)
    //         }
    //         await this.update_full(item)
    //     }
    // }

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
        yield* merge(compare_by_id, ...streams)
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

function compare_by_id(obj1, obj2) {
    /* Ordering function that can be passed to array.sort() to sort objects from DB by ascending ID. */
    return obj1._id_ - obj2._id_
}
