import path from 'path'

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

        let {readonly = false, start_iid = 0} = opts
        this.readonly = readonly
        this.start_iid = start_iid
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

    stack(next) {
        this.block.stack(next.block)
        this.nextDB = next
        next.prevDB = this
        return next
    }

    get top()       { return this.nextDB ? this.nextDB.top : this }         // top-most ring in the database
    get bottom()    { return this.prevDB ? this.prevDB.bottom : this }      // bottom-most ring in the database

    findRing(name)  { return this.name === name ? this : this.prevDB?.findRing(name) }   // find a ring in the stack (up to this level) by its name, or return undefined

    async select(id)    { return this.block.select(id) }
    async delete(item_or_id) {
        let id = typeof item_or_id === 'object' ? item_or_id.id : item_or_id
        return this.block.delete(id)
    }
    async insert(item, opts = {})   { return this.block.insert(item, opts) }
    async update(item, opts = {})   { return this.block.update(item, opts) }

    async *scan(cid)    { yield* this.block.scan(cid) }
}


export class Database extends Item {
    /* A number of Rings stacked on top of each other. Each select/update/delete is executed on the outermost
       ring possible; while each insert - on the innermost ring starting at the category's own ring.
       If NotFound/ReadOnly is caught, the next ring is tried.
       In this way, all inserts go to the outermost writable ring only (warning: the items may receive IDs
       that already exist in a lower DB!), but selects/updates/deletes may go to any lower DB.
       NOTE: the underlying DBs may become interrelated, i.e., refer to item IDs that only exist in another DB
       -- this is neither checked nor prevented. Typically, an outer DB referring to lower-ID items in an inner DB
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
                // if (ex instanceof DB.NotFound || ex instanceof DB.ReadOnly) continue
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

