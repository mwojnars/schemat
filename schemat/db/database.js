import {Item} from "../item.js"
import {BaseError} from "../errors.js"
import {YamlDB} from "./storage.js";



export class Ring {

    block

    constructor({file, item, ...opts}) {
        this.file = file
        this.item = item
        this.opts = opts

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

    stack(next)     { this.block.stack(next.block); return next }

    async select(id)    { return this.block.select(id) }
    async delete(item)  { return this.block.delete(item) }
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

