import path from 'path'
import {BaseError, ItemNotFound} from "../errors.js"
import {T, assert, print, merge} from '../utils.js'
import {Item} from "../item.js"
import {Database} from "./db.js"
import {EditData} from "./edits.js";
import {IndexByCategory} from "./index.js";
import {RecordChange, Record, ItemRecord} from "./records.js";
import {DataRequest} from "./data_request.js";
import {DataSequence} from "./sequence.js";


/**********************************************************************************************************************
 **
 **  Data RING
 **
 */

export class Ring extends Item {

    static role = 'ring'    // for use in ProcessingStep and DataRequest

    data                    // DataSequence with all items of this ring

    db                      // the Database this ring belongs to

    name                    // human-readable name of this ring for find_ring()
    readonly                // if true, the ring does NOT accept modifications: inserts/updates/deletes

    start_iid = 0           // minimum IID of all items; helps maintain separation of IDs between different rings stacked together
    stop_iid                // (optional) maximum IID of all items
    indexes = new Map()     // {name: Index} of all indexes in this ring

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

    async open(db) {
        this.db = db
        this.data = new DataSequence(this, this.opts)
        return this.data.open()
    }

    async _init_indexes() {
        let filename = this.file.replace(/\.yaml$/, '.idx_category_item.jl')

        this.indexes = new Map([
            ['idx_category_item', new IndexByCategory(this, this.data, filename)],      // index of item IDs sorted by parent category ID
        ])

        for (let index of this.indexes.values()) {
            await index.open()
            index.derived.push(this.data)           // make connection: data > index, for change propagation
        }

        // for await (let record /*ItemRecord*/ of this.scan_all()) {
        //     for (let index of this.indexes.values()) {
        //         const binary_key = this.data.schema.encode_key([record.id])
        //         const change = new RecordChange(binary_key, null, record.data_json)
        //         await index.apply(change)
        //     }
        // }
    }

    async erase() {
        /* Remove all records from this ring; open() should be called first. */
        if (this.readonly) this.throwReadOnly()
        return this.data.erase()
    }


    /***  Errors & internal checks  ***/

    static Error = class extends BaseError        {}
    static ReadOnly = class extends Ring.Error    { static message = "the ring is read-only" }
    static InvalidIID = class extends Ring.Error  { static message = "IID is outside the range" }

    throwNotFound(msg, args)    { throw new ItemNotFound(msg, args) }
    throwReadOnly(msg, args)    { throw new Ring.ReadOnly(msg, args) }

    writable(id)                { return !this.readonly && (id === undefined || this.validIID(id)) }    // true if `id` is allowed to be written here
    validIID(id)                { return this.start_iid <= id && (!this.stop_iid || id < this.stop_iid) }

    assertValidID(id, msg) {
        if (!this.validIID(id)) throw new Ring.InvalidIID(msg, {id, start_iid: this.start_iid, stop_iid: this.stop_iid})
    }


    /***  Data access & modification  ***/

    async handle(req, new_command = null) {
        /* Handle a DataRequest by passing it to an appropriate method of this.data. */
        const COMMANDS = ['select', 'insert', 'update', 'delete', 'get', 'put']
        let command = new_command || req.command
        let method = this.data[command]

        assert(COMMANDS.includes(command), `command not allowed: ${command}`)
        assert(method, `missing command: ${command}`)

        if (command === req.command)        // don't overwrite the command if it was the same in the previous step
            command = null

        return method.call(this.data, req.make_step(this, command), ...req.args)
    }


    /***  Indexes and Transforms. Change propagation.  ***/

    async* scan_all() {
        /* Yield all items of this ring as ItemRecord objects. */
        for await (let record of this.data.scan())
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

    propagate(change) {
        /* Propagate a change in an item's data to all indexes in this ring. Insertion/deletion is indicated by
           null in `data_old` or `data_new`, respectively.
         */
        for (const index of this.indexes.values())
            index.apply(change)                         // no need to await, the result is not used
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


    /***  Errors & internal checks  ***/

    static RingUnknown = class extends Database.Error   { static message = "reference ring not found in this database" }
    static RingReadOnly = class extends Database.Error  { static message = "the ring is read-only" }
    static InvalidID = class extends Database.Error     { static message = "item ID is outside of the valid range for the ring(s)" }
    static NotInsertable = class extends Ring.Error     { static message = "item cannot be inserted, the ring(s) is either read-only or the ID is outside of the valid range" }


    /***  Rings manipulation  ***/

    get top()       { return this.rings.at(-1) }
    get bottom()    { return this.rings[0] }
    get reversed()  { return this.rings.slice().reverse() }

    async init_as_cluster_database(rings) {
        /* Set and load rings for self while updating the global registry, so that subsequent ring objects (items)
           can be loaded from lower rings.
         */
        for (const spec of rings) {
            let ring = new Ring(spec)
            await ring.open(this)
            this.append(ring)
            await globalThis.registry.boot()        // reload `root` and `site` to have the most relevant objects after a next ring is added
            await ring._init_indexes()              // TODO: temporary
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
        let req = new DataRequest(this, 'find_ring', item)
        for (const ring of this.reversed) {
            if (name && ring.name === name) return ring
            if (item) {
                let data = await ring.handle(req.clone(), 'get')
                if (data !== undefined) return ring
            }
        }
    }

    _prev(ring) {
        /* Find a ring that directly preceeds `ring` in this.rings. Return the top ring if `ring` if undefined,
           or undefined if `ring` has no predecessor, or throw RingUnknown if `ring` cannot be found.
         */
        if (!ring) return this.top
        let pos = this.rings.indexOf(ring)
        if (pos < 0) throw new ServerDB.RingUnknown()
        if (pos > 0) return this.rings[pos-1]
    }

    _next(ring) {
        /* Find a ring that directly succeeds `ring` in this.rings. Return the bottom ring if `ring` is undefined,
           or undefined if `ring` has no successor, or throw RingUnknown if `ring` cannot be found.
         */
        if (!ring) return this.bottom
        let pos = this.rings.indexOf(ring)
        if (pos < 0) throw new ServerDB.RingUnknown()
        if (pos < this.rings.length-1) return this.rings[pos+1]
    }


    /***  Data access & modification (CRUD operations)  ***/

    async select(id) {
        // returns a json string (`data`) or undefined
        return this.forward_down(new DataRequest(this, 'select', id))
    }

    async update(id, ...edits) {
        /* Apply `edits` to an item's data and store under the `id` in top-most ring that allows writing this particular `id`.
           FUTURE: `edits` may contain tests, for example, for a specific item's version to apply the edits to.
         */
        assert(edits.length, 'missing edits')
        return this.forward_down(new DataRequest(this, 'update', id, edits))
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
        let req = new DataRequest(this, 'insert', id, item.dumpData())

        for (const ring of this.reversed)
            if (ring.writable(id)) return item.id = await ring.handle(req)

        throw new ServerDB.NotInsertable({id})
    }

    async delete(item_or_id) {
        /* Find and delete the top-most occurrence of the item or ID.
           Return true on success, or false if the ID was not found (no modifications are done in such case).
         */
        let id = T.isNumber(item_or_id) ? item_or_id : item_or_id.id
        return this.forward_down(new DataRequest(this, 'delete', id))
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
        throw new ItemNotFound({id: req.args[0]})
    }

    save(req) {
        /* Save an item update (args = [id,data]) to the lowest ring starting at current_ring that's writable and allows this ID.
           Called after the 1st phase of update which consisted of top-down search for the ID in the stack of rings.
         */
        let ring = req.current_ring || this.bottom
        let id = req.args[0]

        // find the ring that's writable and allows this ID
        while (ring && !ring.writable(id))
            ring = this._next(ring)

        if (ring) return ring.handle(req, 'put')
        throw new Database.Error(`can't save an updated item, either the rings are read-only or the ID is outside of a ring's valid range`, {id})
    }
}

