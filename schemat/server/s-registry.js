import fs from 'fs'
import YAML from 'yaml'

import { assert, print, T } from '../utils.js'
import { ItemsMap } from '../data.js'
import { Item, RootCategory } from '../item.js'
import { Database, Registry } from '../registry.js'


/**********************************************************************************************************************
 **
 **  Server-side DB
 **
 */

class ServerDB extends Database {
    async flush() { throw new Error("not implemented") }
    async insert(item, flush = true) { throw new Error("not implemented") }
    async update(item, flush = true) { throw new Error("not implemented") }
    // async upsert(item, flush = true) {
    //     /* UPSERT = UPDATE or INSERT, depending whether `item` has an IID already, or not. */
    //     return item.iid === null ? this.insert(item, flush) : this.update(item, flush)
    // }

    // async insert_many(items, flush = true) {
    //     for (const item of items)
    //         await this.insert(item, false)
    //     if (flush) await this.flush()
    // }
    // async update_many(items, flush = true) {
    //     for (const item of items)
    //         await this.update(item, false)
    //     if (flush) await this.flush()
    // }
    async upsert_many(items, flush = true) {
        for (const item of items)
            if (item.iid === null) await this.insert(item, false)
            else                   await this.update(item, false)
        if (flush) await this.flush()
    }
}

class FileDB extends ServerDB {
    /* Items stored in a file. For use during development only. */

    filename = null
    records  = new ItemsMap()   // preloaded item records, as {key: record} pairs; keys are strings "cid:iid";
                                // values are objects {cid,iid,data}, `data` is JSON-encoded for mem usage & safety,
                                // so that clients create a new deep copy of item data on every access

    constructor(filename) {
        super()
        this.filename = filename
    }

    async select(id) {
        let record = this.records.get(id)
        if (!record)
            throw new Error(`undefined record for ${id}`)
        assert(record.cid === id[0] && record.iid === id[1])
        return record
    }
    async *scan_category(cid) {
        for (const record of this.records.values())
            if (cid === record.cid) yield record
    }
}

class YamlDB extends FileDB {
    /* Items stored in a YAML file. For use during development only. */

    max_iid = new Map()         // current maximum IIDs per category, as {cid: maximum_iid}

    async load() {
        let file = await fs.promises.readFile(this.filename, 'utf8')
        let db = YAML.parse(file)
        this.records.clear()
        this.max_iid.clear()

        for (let record of db) {
            let id = T.pop(record, '__id')
            let [cid, iid] = id
            assert(!this.records.has(id), `duplicate item ID: ${id}`)

            let data = '__data' in record ? record.__data : record
            let curr_max = this.max_iid.get(cid) || 0
            this.max_iid.set(cid, Math.max(curr_max, iid))
            this.records.set(id, {cid, iid, data: JSON.stringify(data)})
        }
        // print('YamlDB items loaded:')
        // for (const [id, data] of this.records)
        //     print(id, data)
    }
    async insert(item, flush = true) {

        if (item.cid === null)
            item.cid = item.category.iid
        let cid = item.cid
        let max_iid

        if (cid === 0 && !this.max_iid.has(cid))
            max_iid = -1   // use =0 if the root category is not getting an IID here
        else
            max_iid = this.max_iid.get(cid) || 0

        let iid = item.iid = max_iid + 1
        this.max_iid.set(cid, iid)

        assert(item.has_data())
        assert(!this.records.has(item.id), "an item with the same ID already exists")

        this.records.set(item.id, {cid, iid, data: await item.dumpData()})

        if (flush) await this.flush()
    }

    async update(item, flush = true) {
        assert(item.has_data())
        assert(item.has_id())
        let [cid, iid] = item.id
        this.records.set(item.id, {cid, iid, data: await item.dumpData()})
        if (flush) await this.flush()
    }
    async flush() {
        /* Save the entire database (this.records) to a file. */
        print(`YamlDB flushing ${this.records.size} items to ${this.filename}...`)
        let flat = [...this.records.values()]
        let recs = flat.map(({cid, iid, data:d}) => {
                let id = {__id: [cid, iid]}, data = JSON.parse(d)
                return T.isDict(data) ? {...id, ...data} : {...id, __data: data}
            })
        let out  = YAML.stringify(recs)
        await fs.promises.writeFile(this.filename, out, 'utf8')
    }
}

/**********************************************************************************************************************
 **
 **  Server-side REGISTRY
 **
 */

export class ServerRegistry extends Registry {

    staging = []                // list of modified or newly created items that will be updated/inserted to DB
                                // on next commit(); the items will be commited to DB in the SAME order as in this list;
                                // if a staged item is already in cache, it can't be purged there until committed (TODO)
    staging_ids = new Map()     // dict of items with a non-empty ID that have already been added to `staging`,
                                // to avoid repeated insertion of the same item twice and to verify its identity (newborn items excluded)

    constructor(filename) {
        super()
        this.db = new YamlDB(filename)
    }
    async boot() {
        await this.db.load()
        await super.boot()
    }
    async create_root(root_data = null) {
        /*
        Create the RootCategory object, ID=(0,0). If `root_data` is provided, the properties
        are initialized from there rather than being loaded from DB.
        */
        let root = this.root = new RootCategory(this, root_data)
        if (!root_data) await root.load()
        return root
    }

    async set_site(site) {
        let Site = (await import('../item.js')).Site
        assert(site instanceof Site)
        assert(site.has_id())
        this.site_id = site.id
        await this.root.data.set(this.constructor.STARTUP_SITE, site.id)      // plain ID (not object) is stored to avoid circular dependency when loading RootCategory
        await this.commit(this.root)
    }
    
    /***  DB modifications  ***/

    // async insert(...items) {
    //     for (const item of items) {
    //         assert(!item.has_id() || (item instanceof RootCategory))
    //         // this.stage(item)
    //     }
    //     await this.db.insert_many(items)
    // }
    stage(item) {
        /*
        Add an updated or newly created `item` to the staging area.
        For updates, this typically should be called BEFORE modifying an item,
        so that its refresh in cache is prevented during modifications (TODO).
        */
        assert(item instanceof Item)
        let has_id = item.has_id()
        if (has_id && this.staging_ids.has(item.id)) {      // do NOT insert the same item twice (NOT checked for newborn items)
            assert(item === this.staging_ids.get(item.id))  // make sure the identity of `item` hasn't changed - this should be ...
            return                                          // guaranteed by the way how Cache and Registry work (single-threaded; cache eviction only after request)
        }
        this.staging.push(item)
        if (has_id) this.staging_ids.set(item.id, item)
    }
    async commit(...items) {
        /* Insert/update all staged items (this.staging) in DB and purge the staging area. Append `items` before that. */
        for (const item of items) this.stage(item)
        if (!this.staging.length) return

        // assert cache validity: the items to be updated must not have been substituted in cache in the meantime
        for (const item of this.staging) {
            if (!item.has_id()) continue
            let incache = this.items.get(item.id)
            if (!incache) continue
            assert(item === incache, `item instance substituted in cache while being modified: ${item}, instances ${id(item)} vs ${id(incache)}`)
        }
        await this.db.upsert_many(this.staging)

        this.staging_ids.clear()
        this.staging.length = 0
    }
}
