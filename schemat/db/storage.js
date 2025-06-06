import {assert, print, T} from '../common/utils.js'
import {NotImplemented} from '../common/errors.js'
import {BinaryMap, compare_uint8} from "../common/binary.js"
import {data_schema} from "./records.js"

const fs = await server_import('node:fs')
const yaml = (await server_import('yaml'))?.default



function createFileIfNotExists(filename, fs) {
    /* Create an empty file if it doesn't exist yet. Do nothing otherwise. */
    try { fs.writeFileSync(filename, '', {flag: 'wx'}) }
    catch(ex) {}
}


/**********************************************************************************************************************
 **
 **  STORAGE
 **
 */

export class Storage {

    block

    constructor(block) {
        assert(block)
        this.block = block
    }

    // all the methods below can be ASYNC in subclasses... (!)

    get(key)            { throw new NotImplemented() }      // return JSON string stored under the binary `key`, or undefined
    put(key, value)     { throw new NotImplemented() }      // no return value
    del(key)            { throw new NotImplemented() }      // return true if `key` found and deleted, false if not found

    *scan(opts)         { throw new NotImplemented() }      // generator of [binary-key, json-value] pairs
    erase()             { throw new NotImplemented() }
    flush()             { }
    // get size()          { }                                 // number of records in this storage, or undefined if not implemented
}

export class MemoryStorage extends Storage {
    /* All records stored in a Map in memory. Possibly synchronized with a file on disk (implemented in subclasses). */

    _records = new BinaryMap()       // preloaded records, {binary-key: json-data}; unordered, sorting is done during scan()
    dirty = false

    get(key)            { return this._records.get(key) }
    put(key, value)     { this.dirty = true; this._records.set(key, value) }
    del(key)            { this.dirty = true; return this._records.delete(key) }

    erase()             { this.dirty = true; this._records.clear() }
    // get size()       { return this._records.size }

    *scan({start /*Uint8Array*/, stop /*Uint8Array*/} = {}) {
        /* Iterate over records in this block whose keys are in the [start, stop) range, where `start` and `stop`
           are binary keys (Uint8Array).
         */
        let sorted_keys = [...this._records.keys()].sort(compare_uint8)
        let total = sorted_keys.length

        let start_index = start ? sorted_keys.findIndex(key => compare_uint8(key, start) >= 0) : 0
        let stop_index = stop ? sorted_keys.findIndex(key => compare_uint8(key, stop) >= 0) : total

        if (start_index < 0) start_index = total
        if (stop_index < 0) stop_index = total

        for (let key of sorted_keys.slice(start_index, stop_index))
            yield [key, this._records.get(key)]
    }
}

/**********************************************************************************************************************
 **
 **  YAML DATA
 **
 */

export class YamlDataStorage extends MemoryStorage {
    /* Items stored in a YAML file. The file can be unordered. For use during development only. */

    filename

    constructor(filename, block) {
        super(block)
        this.filename = filename
    }

    open() {
        /* Load records from this block's file. */

        // print(`YamlDataStorage opening ${this.filename}...`)
        // assert(this.sequence = this.block.sequence)
        // assert(this.block.sequence.ring)

        // if (!this.sequence.is_loaded() && this.sequence.is_linked())
        //     await this.sequence.load()
        // if (!this.sequence.ring) await this.sequence.load()
        // let ring = this.sequence.ring

        // let ring = req.current_ring
        // let block = req.current_block
        // this.sequence = req.current_data

        assert(!this.dirty)
        createFileIfNotExists(this.filename, fs)

        let content = fs.readFileSync(this.filename, 'utf8')
        let records = yaml.parse(content) || []
        let max_id = 0
        this._records.clear()

        for (let record of records) {
            let id = T.pop(record, 'id')
            let key = data_schema.encode_key([id])

            // ring.assert_valid_id(id, `item ID loaded from ${this.filename} is outside the valid bounds for this ring`)
            // await this.block.assert_unique(key, id, `duplicate item ID loaded from ${this.filename}`)

            max_id = Math.max(max_id, id)

            let data = '__data' in record ? record.__data : record

            this._records.set(key, JSON.stringify(data))
        }
        // print(`YamlDataStorage loaded ${this._records.size} items from ${this.filename}...`)
        return max_id
    }

    async flush() {
        /* Save the entire database (this.records) to a file. */
        print(`YamlDataStorage flushing ${this._records.size} items to ${this.filename}...`)
        let recs = [...this.scan()].map(([key, data_json]) => {
            let id = data_schema.decode_key(key)[0]
            let data = JSON.parse(data_json)
            assert(data.id === undefined)       // there must be no `id` included as a plain attribute
            return T.isPOJO(data) ? {id, ...data} : {id, __data: data}
        })
        let out = yaml.stringify(recs)
        fs.writeFileSync(this.filename, out, 'utf8')
        this.dirty = false
    }
}

/**********************************************************************************************************************
 **
 **  JSON INDEX
 **
 */

export class JsonIndexStorage extends MemoryStorage {
    /* Index records stored in a .jl file (JSON Lines). The file can be unordered. For use during development only. */

    filename

    constructor(filename, block) {
        super(block)
        this.filename = filename
    }

    open() {
        /* Load records from this.filename file into this.records. */
        assert(!this.dirty)
        createFileIfNotExists(this.filename, fs)

        let content = fs.readFileSync(this.filename, 'utf8')
        let lines = content.split('\n').filter(line => line.trim().length > 0)
        let records = lines.map(line => JSON.parse(line))

        this._records.clear()

        for (let [key, value] of records)
            this._records.set(this.block.encode_key(key), value ? JSON.stringify(value) : '')
            // this._records.set(Uint8Array.from(key), value ? JSON.stringify(value) : '')
    }

    async flush() {
        /* Save the entire database (this.records) to a file. */
        // print(`YamlIndexStorage flushing ${this._records.size} records to ${this.filename}...`)

        let lines = [...this.scan()].map(([binary_key, json_value]) => {
            let key = this.block.decode_key(binary_key)
            let json_key = JSON.stringify(key)  //Array.from(binary_key))
            return json_value ? `[${json_key}, ${json_value}]` : `[${json_key}]`
        })
        fs.writeFileSync(this.filename, lines.join('\n') + '\n', 'utf8')
        this.dirty = false
    }
}


