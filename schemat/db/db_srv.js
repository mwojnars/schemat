import path from 'path'
import {BaseError, ItemNotFound} from "../errors.js"
import {T, assert, print, merge} from '../utils.js'
import {Item} from "../item.js"
import {YamlBlock} from "./block.js"
import {Database} from "./db.js"
import {EditData} from "./edits.js";


/**********************************************************************************************************************
 **
 **  Data RING
 **
 */

export class Ring extends Item {

    block                   // physical storage of this ring's primary data (the items)

    name                    // human-readable name of this ring for find_ring()
    readonly                // if true, the ring does NOT accept modifications: inserts/updates/deletes

    start_iid = 0           // minimum IID of all items; helps maintain separation of IDs between different rings stacked together
    stop_iid                // (optional) maximum IID of all items

    constructor({file, item, name, ...opts}) {
        super(globalThis.registry)
        this.file = file
        this.item = item
        this.opts = opts
        this.name = name || (file && path.basename(file, path.extname(file)))

        let {readonly = false, start_iid = 0, stop_iid} = opts
        this.readonly = readonly
        this.start_iid = start_iid
        this.stop_iid = stop_iid
    }

    async open() {
        let block
        if (this.file) block = new YamlBlock(this.file, this.opts)         // block is a local file
        else {                                                  // block is an item that must be loaded from a lower ring
            block = await globalThis.registry.getLoaded(this.item)
            block.setExpiry('never')                           // prevent eviction of this item from Registry's cache (!)
        }
        await block.open(this)
        this.block = block
    }

    async erase() {
        /* Remove all records from this ring; open() should be called first. */
        if (this.readonly) this.throwReadOnly()
        return this.block.erase()
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


    /***  Data access & modification (CRUD operations)  ***/

    async select_local(id) {
        /* Read item's data from this ring, no forward to a lower ring. Return undefined if `id` not found. */
        return this.block._select(id)
    }

    async select([db], id) {
        /* Find the top-most occurrence of an item in the database, `db`, starting at this ring.
           If found, return a JSON-encoded data; otherwise throw ItemNotFound.
         */
        // todo: find the right block (in Sequence)
        return this.block.select([db], id)
    }

    async insert([db], item) {
        /* `db` is unused (for now). */
        item.id = await this.block.insert([db], item.id, item.dumpData())
    }

    async update([db], id, ...edits) {
        /* Apply `edits` to an item's data and store under the `id` in this ring, or any higher one that allows
           writing this particular `id`. The `id` is searched for in the current ring and below.
           FUTURE: `edits` may contain tests, for example, for a specific item's version to apply the edits to.
         */
        return this.block.update([db], id, ...edits)
    }

    async save([db], block, id, data) {
        /* 2nd phase of update: save updated item's `data` under the `id`. Forward to a higher ring if needed.
           This is called after the 1st phase which consisted of top-down search for the `id` in the stack of rings.
           `block` serves as a hint of which block of `this` actually contains the `id` - can be null (after forward).
         */
        block = block || this.block
        return this.writable(id) ? block.save(id, data) : db.forward_save([this], id, data)
    }

    async delete([db], id) {
        /* Find and delete the top-most occurrence of the item's ID in this Ring or a lower Ring in the stack (through .prevDB).
           Return true on success, or false if the `id` was not found (no modifications done then).
         */

        // in a read-only ring no delete can be done: check if the `id` exists and either forward or throw an error
        if (this.readonly)
            if (await this.block._select(id))
                this.throwReadOnly({id})
            else
                return db.forward_delete([this], id)

        return this.block.delete([db], id)
    }


    /***  Indexes and Transforms  ***/

    async *scan()   { yield* this.block._scan() }

    async *scan_index(name, {start, stop, limit, reverse=false, batch_size=100} = {}) {
        /* Scan an index `name` in the range [`start`, `stop`) and yield the results.
           If `limit` is not null, yield at most `limit` items.
           If `reverse` is true, scan in the reverse order.
           If `batch_size` is not null, yield items in batches of `batch_size` items.
         */
        let index = this.indexes.get(name)      // Index object
        yield* this.block._scan_index(name, {start, stop, limit, reverse, batch_size})
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

    rings = []          // [0] is the innermost ring (bottom of the stack), [-1] is the outermost ring (top)


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
            await ring.open()
            this.append(ring)
            await globalThis.registry.boot()        // reload `root` and `site` to have the most relevant objects after a next ring is added
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
        for (const ring of this.reversed) {
            if (name && ring.name === name) return ring
            if (item) {
                let data = await ring.select_local(item)
                if (data !== undefined) return ring
            }
        }
    }

    _prev(ring) {
        /* Find a ring that directly preceeds `ring` in this.rings. Return the top ring if `ring` if undefined,
           or undefined if `ring` has no predecessor, or throw RingUnknown if `ring` cannot be found.
         */
        if (ring === undefined) return this.top
        let pos = this.rings.indexOf(ring)
        if (pos < 0) throw new ServerDB.RingUnknown()
        if (pos > 0) return this.rings[pos-1]
    }

    _next(ring) {
        /* Find a ring that directly succeeds `ring` in this.rings. Return the bottom ring if `ring` is undefined,
           or undefined if `ring` has no successor, or throw RingUnknown if `ring` cannot be found.
         */
        if (ring === undefined) return this.bottom
        let pos = this.rings.indexOf(ring)
        if (pos < 0) throw new ServerDB.RingUnknown()
        if (pos < this.rings.length-1) return this.rings[pos+1]
    }


    /***  Data access & modification (CRUD operations)  ***/

    async select(id)                { return this.forward_select([], id) }      // returns a json string (`data`) or undefined
    async update(id, ...edits)      { return this.forward_update([], id, ...edits) }

    async update_full(item) {
        /* Replace all data inside the item's record in DB with item.data. */
        return this.update(item.id, new EditData(item.dumpData()))
    }

    async insert(item) {
        /* Find the top-most ring where the item's ID is writable and insert there.
           The ID can be full or partial: [CID,IID] or [CID,undefined]; item.iid is filled with the inserted IID.
         */
        let id = item.id
        for (const ring of this.reversed)
            if (ring.writable(id)) return ring.insert([this], item)

        throw new ServerDB.NotInsertable({id})
    }

    async delete(item_or_id) {
        let id = T.isNumber(item_or_id) ? item_or_id : item_or_id.id
        return this.forward_delete([], id)
    }

    async *scan() {
        /* Scan each ring and merge the sorted streams of entries. */
        let streams = this.rings.map(r => r.scan())
        yield* merge(Item.orderAscID, ...streams)
    }


    /***  CRUD forwarding to other rings  ***/

    forward_select([ring], id) {
        let prev = this._prev(ring)
        if (prev) return prev.select([this], id)
        throw new ItemNotFound({id})
    }

    forward_update([ring], id, ...edits) {
        /* Forward an update(id, edits) operation to a lower ring; called during the top-down search phase,
           if the current `ring` doesn't contain the requested `id`. */
        assert(edits.length, 'missing edits')
        let prev = this._prev(ring)
        if (prev) return prev.update([this], id, ...edits)
        throw new ItemNotFound({id})
    }

    forward_save([ring], id, data) {
        /* Forward a save(id, data) operation to a higher ring; called when the current ring is not allowed to save the update. */
        let next = this._next(ring)
        if (next) return next.save([this], null, id, data)
        if (ring.readonly) throw new ServerDB.RingReadOnly({id})
        assert(!ring.validIID(id))
        throw new ServerDB.InvalidID({id})
    }

    forward_delete([ring], id) {
        let prev = this._prev(ring)
        if (prev) return prev.delete([this], id)
        throw new ItemNotFound({id})
    }
}

