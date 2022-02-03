import { assert, print, T } from '../utils.js'
import { ItemsMap } from '../data.js'
import { Item } from "../item.js";


/**********************************************************************************************************************
 **
 **  Server-side DB
 **
 */

class ServerDB {
    async flush() { throw new Error("not implemented") }
    async insert(item, flush = true) { throw new Error("not implemented") }
    async update(item, flush = true) { throw new Error("not implemented") }
    async upsert_many(items, flush = true) {
        for (const item of items)
            if (item.newborn) await this.insert(item)
            else              await this.update(item)
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
    async *scanCategory(cid) {
        for (const record of this.records.values())
            if (cid === record.cid) yield record
    }
}

export class YamlDB extends FileDB {
    /* Items stored in a YAML file. For use during development only. */

    max_iid = new Map()         // current maximum IIDs per category, as {cid: maximum_iid}

    async load() {
        let fs = await import('fs')
        let YAML = (await import('yaml')).default
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
    async insert(...items) {
        await Promise.all(items.map(item => this.insertOne(item, false)))
        await this.flush()
    }
    async insertOne(item, flush = true) {

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

        this.records.set(item.id, {cid, iid, data: item.dumpData()})
        if (flush) await this.flush()
    }

    async update(item, flush = true) {
        assert(item.has_data())
        assert(item.has_id())
        let [cid, iid] = item.id
        this.records.set(item.id, {cid, iid, data: item.dumpData()})
        if (flush) await this.flush()
    }
    async delete(id) {
        this.records.delete(id)
        return this.flush()
    }

    async flush() {
        /* Save the entire database (this.records) to a file. */
        print(`YamlDB flushing ${this.records.size} items to ${this.filename}...`)
        let fs   = await import('fs')
        let YAML = (await import('yaml')).default
        let flat = [...this.records.values()]
        let recs = flat.map(({cid, iid, data:d}) => {
                let id = {__id: [cid, iid]}, data = JSON.parse(d)
                return T.isDict(data) ? {...id, ...data} : {...id, __data: data}
            })
        let out = YAML.stringify(recs)
        return fs.promises.writeFile(this.filename, out, 'utf8')
    }
}

/**********************************************************************************************************************/

export class DatabaseYaml extends Item {
}
