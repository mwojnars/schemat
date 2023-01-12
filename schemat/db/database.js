import path from 'path'
import {BaseError, ItemNotFound} from "../errors.js"
import {T, assert, print, merge} from '../utils.js'
import {Item} from "../item.js"
import {YamlDB} from "./storage.js";


/**********************************************************************************************************************
 **
 **  Data RING
 **
 */

export class Ring {

    block

    nextDB                  // younger (higher-priority) ring on top of this one; fallback for insert/save()
    prevDB                  // older (lower-priority) ring beneath this one; fallback for select/update/delete()

    name                    // human-readable name of this ring for findRing()
    readonly                // if true, the database does NOT accept modifications: inserts/updates/deletes

    start_iid = 0           // minimum IID of all items; helps maintain separation of IDs between different databases stacked together
    stop_iid                // (optional) maximum IID of all items

    constructor({file, item, name, ...opts}) {
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
        if (this.file) block = new YamlDB(this.file, this.opts)         // block is a local file
        else {                                                  // block is an item that must be loaded from a lower ring
            block = await globalThis.registry.getLoaded(this.item)
            block.setExpiry('never')                           // prevent eviction of this item from Registry's cache (!)
        }
        await block.open(this)
        this.block = block
    }

    async erase() {
        /* Remove all records from this ring; open() should be called first. */
        this.checkReadOnly()
        return this.block.erase()
    }

    /***  Rings manipulation  ***/
    
    stack(next) {
        this.nextDB = next
        next.prevDB = this
        return next
    }

    get top()       { return this.nextDB ? this.nextDB.top : this }         // top-most ring in the database
    get bottom()    { return this.prevDB ? this.prevDB.bottom : this }      // bottom-most ring in the database

    // async findRing(query) {
    //     /* Return the top-most ring that contains a given item's ID (query.item), or has a given ring name (query.name).
    //        Return undefined if not found. Can be called to check if an item ID or a ring name exists.
    //      */
    //     let {item, name} = query
    //     if (name && this.name === name) return this
    //     if (item) {
    //         let data = await this.block._select(item)
    //         if (data !== undefined) return this
    //     }
    //     return this.prevDB?.findRing(query)
    // }


    /***  Errors & internal checks  ***/

    static Error = class extends BaseError        {}
    // static ItemNotFound = class extends Ring.Error    { static message = "item ID not found in the database" }
    static ReadOnly = class extends Ring.Error    { static message = "the ring is read-only" }
    static InvalidIID = class extends Ring.Error  { static message = "IID is outside the range" }
    static NotWritable = class extends Ring.Error {
        static message = "record cannot be written, the data ring is either read-only or the id is outside the range"
    }

    throwNotFound(msg, args)    { throw new ItemNotFound(msg, args) }
    throwReadOnly(msg, args)    { throw new Ring.ReadOnly(msg, args) }
    throwNotWritable(id)        { throw new Ring.NotWritable({id, start_iid: this.start_iid, stop_iid: this.stop_iid}) }
    throwInvalidIID(id)         { throw new Ring.InvalidIID({id, start_iid: this.start_iid, stop_iid: this.stop_iid}) }

    writable(id)                { return !this.readonly && (id === undefined || id[1] === undefined || this.validIID(id)) }    // true if `id` is allowed to be written here
    validIID(id)                { return this.start_iid <= id[1] && (!this.stop_iid || id[1] < this.stop_iid) }
    checkReadOnly(id)           { if (this.readonly) this.throwReadOnly({id}) }

    checkValidID(id, msg) {
        if (!this.validIID(id)) throw new Block.InvalidIID(msg, {id, start_iid: this.start_iid, stop_iid: this.stop_iid})
    }


    /***  Data access & modification (CRUD operations)  ***/

    async select(id) {
        /* Find the top-most occurrence of `id` in this ring or any lower one in the stack (through .prevDB).
           If found, return a JSON-encoded data stored under the `id`; otherwise throw ItemNotFound.
         */
        let data = await this.read(id)
        if (data !== undefined) return data
        return this.forward_select(id)
    }

    forward_select(id) {
        if (this.prevDB) return this.prevDB.select(id)
        this.throwNotFound({id})
    }

    async insert(item) {
        /* High-level insert. The `item` can have an IID already assigned (then it's checked that
           this IID is not yet present in the DB), or not.
           If item.iid is missing, a new IID is assigned and stored in `item.iid` for use by the caller.
           If this db is readonly, forward the operation to a lower DB (prevDB), or raise an exception.
         */
        let json = item.dumpData()
        let cid  = item.cid
        let id   = item.id
        assert(cid || cid === 0)

        // create IID for the item if missing or use the provided IID; in any case, store `json` under the resulting ID
        if (this.writable(id)) item.iid = await this.block.insert(id, json, this)
        else if (this.prevDB) return this.prevDB.insert(item)
        else if (this.readonly) this.throwReadOnly()
        else this.throwNotWritable(id)
    }

    async update([db], id, ...edits) {
        /* Apply `edits` to an item's data and store under the `id` in this ring, or any higher one that allows
           writing this particular `id`. The `id` is searched for in the current ring and below.
         */
        return this.block.update([db, this], id, ...edits)
    }

    async delete(item_or_id) {
        /* Find and delete the top-most occurrence of the item's ID in this Ring or a lower Ring in the stack (through .prevDB).
           Return true on success, or false if the `id` was not found (no modifications done then).
           TODO: delete all delete-able copies of `id` across different rings, or insert a tombstone if one or more
                 of the copies remain - to ensure that subsequent select(id) will fail, as would normally be expected.
         */
        let id = T.isArray(item_or_id) ? item_or_id : item_or_id.id

        if (this.writable(id)) {
            print('id', id)
            let ret = await this.block.delete(id)
            if (ret) {
                this.block.flush(1)
                return ret
            }
        }
        else if (!this.writable() && this.validIID(id) && await this.block._select(id))
            this.throwReadOnly({id})

        return this.prevDB ? this.prevDB.delete(id) : false
    }

    async *scan(cid) {
        if (this.prevDB) yield* merge(Item.orderAscID, this.block._scan(cid), this.prevDB.scan(cid))
        else yield* this.block._scan(cid)
    }


    /***  Lower-level implementations of CRUD  ***/

    async read(id) {
        /* Find the top-most occurrence of `id` in this DB or any lower DB in the stack (through .prevDB).
           If found, return a JSON-encoded data stored under the `id`; otherwise return undefined.
         */
        // if (!this.validIID(id)) return       // record that doesn't satisfy IID constraints, even if exists in DB, is ignored
        return this.block._select(id)

        // if (this.validIID(id)) {                               // record that doesn't satisfy IID constraints, even if exists in DB, is ignored
        //     let data = this.block._select(id)
        //     if (data instanceof Promise) data = await data      // must await here to check for "not found" result
        //     if (data !== undefined) return data
        // }
        // if (this.prevDB) return this.prevDB.read(id)
    }

    async save([db], block, id, data) {
        /* Save updated item's `data` under the `id`. Forward to a higher ring if needed.
           `block` serves as a hint of which block of `this` actually contains the `id` - can be null (after forward).
         */
        block = block || this.block
        return this.writable(id) ? block.save(id, data) : db.forward_save([this], id, data)
    }
}


/**********************************************************************************************************************
 **
 **  DATABASE
 **
 */

export class Database {
    /* A number of Rings stacked on top of each other. Each select/insert/delete is executed on the outermost
       ring possible; while each update - on the innermost ring starting at the outermost ring containing a given ID.
       If ItemNotFound/ReadOnly is caught, the next ring is tried.
     */

    rings = []          // [0] is the innermost ring (bottom of the stack), [-1] is the outermost ring (top)


    /***  Rings manipulation  ***/

    get top()       { return this.rings.at(-1) }
    get bottom()    { return this.rings[0] }

    append(ring) {
        /* The ring must be already open. */
        if (this.top) this.top.stack(ring)
        this.rings.push(ring)
    }

    async findRing({item, name}) {
        /* Return the top-most ring that contains a given item's ID (`item`), or has a given ring name (`name`).
           Return undefined if not found. Can be called to check if an item ID or a ring name exists.
         */
        for (const ring of this.rings.slice().reverse()) {
            if (name && ring.name === name) return ring
            if (item) {
                let data = await ring.read(item)
                if (data !== undefined) return ring
            }
        }
    }

    _prev(ring) {
        /* Find a ring that directly preceeds `ring` in this.rings. Return undefined if `ring` has no predecessor,
           or throw RingUnknown if `ring` cannot be found.
         */
        let pos = this.rings.indexOf(ring)
        if (pos < 0) throw new Database.RingUnknown()
        if (pos > 0) return this.rings[pos-1]
    }

    _next(ring) {
        /* Find a ring that directly succeeds `ring` in this.rings. Return undefined if `ring` has no successor,
           or throw RingUnknown if `ring` cannot be found.
         */
        let pos = this.rings.indexOf(ring)
        if (pos < 0) throw new Database.RingUnknown()
        if (pos < this.rings.length-1) return this.rings[pos+1]
    }


    /***  Errors & internal checks  ***/

    static Error = class extends BaseError {}
    static RingUnknown = class extends Database.Error   { static message = "reference ring not found in this database" }
    static RingReadOnly = class extends Database.Error  { static message = "the ring is read-only" }
    static InvalidID = class extends Database.Error     { static message = "item ID is outside of the valid set for the ring(s)" }


    /***  Data access & modification (CRUD operations)  ***/

    async select(id)                { if (this.top) return this.top.select(id); else throw new ItemNotFound() }
    async insert(item)              { assert(this.top); return this.top.insert(item) }
    async delete(item_or_id)        { assert(this.top); return this.top.delete(item_or_id) }
    async *scan(cid)                { if(this.top) yield* this.top.scan(cid) }

    async update(id, ...edits) {
        /* Apply `edits` to an item's data and store under the `id` in the ring that contains the item,
           or in the nearest higher ring from there that allows writing the particular `id`.
           FUTURE: `edits` may contain tests, for example, for a specific item's version to apply the edits to.
         */
        assert(edits.length, 'missing edits')
        assert(this.top, 'no rings in the database')
        return this.top.update([this], id, ...edits)
    }

    forward_update([ring], id, ...edits) {
        /* Forward an update(id, edits) operation to a lower ring; called during the top-down search phase,
           if the current `ring` doesn't contain the requested `id`. */
        let prev = this._prev(ring)
        if (prev) return prev.update([this], id, ...edits)
        throw new ItemNotFound({id})
    }

    forward_save([ring], id, data) {
        /* Forward a save(id, data) operation to a higher ring; called when the current ring is not allowed to save the update. */
        let next = this._next(ring)
        if (next) return next.save([this], null, id, data)
        if (ring.readonly) throw new Database.RingReadOnly({id})
        assert(!ring.validIID(id))
        throw new Database.InvalidID({id})
    }
}

