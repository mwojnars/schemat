import path from 'path'

import { T, assert, print } from '../utils.js'

import {Item} from "../item.js"
import {BaseError} from "../errors.js"
import {YamlDB} from "./storage.js";



export class Ring {

    block

    nextDB                  // younger (higher-priority) ring on top of this one; fallback for save/mutate/update()
    prevDB                  // older (lower-priority) ring beneath this one; fallback for read/drop/insert()

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

    async open(createRegistry) {
        let block
        if (this.file) block = new YamlDB(this.file, this.opts)         // block is a local file
        else {                                                  // block is an item that must be loaded from a lower ring
            let registry = globalThis.registry || await createRegistry()
            block = await registry.getLoaded(this.item)
            block.setExpiry('never')                           // prevent eviction of this item from Registry's cache (!)
        }
        await block.open()
        this.block = block
    }


    /***  rings  ***/
    
    stack(next) {
        this.block.stack(next.block)
        this.nextDB = next
        next.prevDB = this
        return next
    }

    get top()       { return this.nextDB ? this.nextDB.top : this }         // top-most ring in the database
    get bottom()    { return this.prevDB ? this.prevDB.bottom : this }      // bottom-most ring in the database

    findRing(name)  { return this.name === name ? this : this.prevDB?.findRing(name) }      // find a ring in the stack (up to this level) by its name, or return undefined


    /***  errors & internal checks  ***/

    static Error = class extends BaseError        {}
    static NotFound = class extends Ring.Error    { static message = "item ID not found" }
    static ReadOnly = class extends Ring.Error    { static message = "the database is for read-only access" }
    static InvalidIID = class extends Ring.Error  { static message = "IID is out of range" }
    static NotWritable = class extends Ring.Error {
        static message = "record cannot be written, the data ring is either read-only or the key (iid) is outside the range"
    }

    throwNotFound(msg, args)    { throw new Ring.NotFound(msg, args) }
    throwReadOnly(msg, args)    { throw new Ring.ReadOnly(msg, args) }
    throwNotWritable(key)       { throw new Ring.NotWritable({key, start_iid: this.start_iid, stop_iid: this.stop_iid}) }
    throwInvalidIID(id)         { throw new Ring.InvalidIID({id, start_iid: this.start_iid, stop_iid: this.stop_iid}) }

    writable(id)                { return !this.readonly && (id === undefined || this.validIID(id)) }    // true if `id` is allowed to be written here
    validIID(id)                { return this.start_iid <= id[1] && (!this.stop_iid || id[1] < this.stop_iid) }
    checkIID(id)                { if (this.validIID(id)) return true; this.throwInvalidIID(id) }
    checkReadOnly(key)          { if (this.readonly) this.throwReadOnly({key}) }
    async checkNew(id, msg)     { if (await this._select(id)) throw new Error(msg + ` [${id}]`) }


    /***  Data access & modification (CRUD operations)  ***/

    async select(id)    { return this.block.select(id) }
    async insert(item, opts = {})   { return this.block.insert(item, opts) }
    async update(item, opts = {})   { return this.block.update(item, opts) }

    async delete(item_or_id) {
        /* Find and delete the top-most occurrence of the item's ID in this Ring or a lower Ring in the stack (through .prevDB).
           Return true on success, or false if the `key` was not found (no modifications done then).
         */
        let id = T.isArray(item_or_id) ? item_or_id : item_or_id.id

        if (this.writable(id)) {
            print('id', id)
            let ret = this.block._delete(id)
            if (ret instanceof Promise) ret = await ret                 // must await here to check for "not found" result
            if (ret) return ret
        }
        else if (!this.writable() && this.validIID(id) && await this.block._select(id))
            this.throwReadOnly({id})

        return this.prevDB ? this.prevDB.delete(id) : false
    }

    async *scan(cid)    { yield* this.block.scan(cid) }
}


export class Database extends Item {
    /* A number of Rings stacked on top of each other. Each select/update/delete is executed on the outermost
       ring possible; while each insert - on the innermost ring starting at the category's own ring.
       If NotFound/ReadOnly is caught, the next ring is tried.
       In this way, all inserts go to the outermost writable ring only (warning: the items may receive IDs
       that already exist in a lower Ring!), but selects/updates/deletes may go to any lower Ring.
       NOTE: the underlying DBs may become interrelated, i.e., refer to item IDs that only exist in another Ring
       -- this is neither checked nor prevented. Typically, an outer Ring referring to lower-ID items in an inner Ring
       is expected; while the reversed relationship is a sign of undesired convolution between the databases.
     */

    static DBError = class extends BaseError {}
    static ItemNotFound = class extends Database.DBError { static message = "item not found in the database" }

    constructor(...rings) {
        /* `rings` are ordered by increasing level: from innermost to outermost. */
        super()
        this.rings = rings.reverse()        // in `this`, rings are ordered by DECREASING level for easier looping

        this.get    = this.outermost('get')
        this.del    = this.outermost('del')
        this.insert = this.outermost('insert')
        this.update = this.outermost('update')
        // this.select = this.outermost('select')
    }
    load()  { return Promise.all(this.rings.map(d => d.load())) }

    outermost = (method) => async function (...args) {
        let exLast
        for (const ring of this.rings)
            try {
                let result = ring[method](...args)
                return result instanceof Promise ? await result : result
            }
            catch (ex) {
                if (ex instanceof Database.ItemNotFound) { exLast = ex; continue }
                // if (ex instanceof Ring.NotFound || ex instanceof Ring.ReadOnly) continue
                throw ex
            }
        throw exLast || new Database.ItemNotFound()
        // throw new RingsDB.RingNotFound()
    }

    // async *scanCategory(cid) {
    //     for (const db of this.rings)
    //         yield* db.scanCategory(cid)
    // }
}

