import fs from 'node:fs'
import YAML from 'yaml'

import {assert, print, T} from '../common/utils.js'
import {NotImplemented} from '../common/errors.js'
import {BinaryMap, compare_bin} from "../common/binary.js"
import {data_schema} from "./records.js"

// const fs = await server_import('node:fs')
// const YAML = (await server_import('yaml'))?.default


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

export class Store {
    /* Base class for local data storage. Every Block instance has at least one local store to save its records. */

    block
    filename

    constructor(filename, block) {
        assert(block)
        this.block = block
        this.filename = filename
    }

    // all the methods below can be ASYNC in subclasses... (!)

    open() {}
    close() {}

    get(key)            { throw new NotImplemented() }      // return JSON string stored under the binary `key`, or undefined
    put(key, value)     { throw new NotImplemented() }      // no return value
    del(key, checked)   { throw new NotImplemented() }      // if checked=true, return true/false to indicate if `key` was found and deleted

    *scan(opts)         { throw new NotImplemented() }      // generator of [binary-key, json-value] pairs
    erase()             { throw new NotImplemented() }
    flush()             { return this._flush() }
    _flush()            {}
    // get size()          { }                                 // number of records in this storage, or undefined if not implemented

    async bulk(operations, opts = {}) {
        /* Execute multiple write operations together. */
        for (let {type, key, value} of operations) {
            if (type === 'put')
                await this.put(key, value)
            else if (type === 'del')
                await this.del(key, true)
            else
                throw new Error(`unknown operation type: ${type}`)
        }
        if (opts.sync)
            await this.flush(0)
    }

    _normalize_scan_opts({start, stop, gt, gte, lt, lte /*Uint8Array*/, ...opts} = {}) {
        gte ??= start
        lt  ??= stop

        // drop one of (gt, gte) if both are present, same for (lt, lte):
        // - if XX=XXe, XXe is a weaker constraint and should be dropped
        // - if gtX>gtY, gtY is a weaker constraint and should be dropped
        // - if ltX<ltY, ltY is a weaker constraint and should be dropped
        if (gt && gte)
            if (compare_bin(gt, gte) >= 0) gte = undefined
            else gt = undefined

        if (lt && lte)
            if (compare_bin(lt, lte) <= 0) lte = undefined
            else lt = undefined

        return {gt, gte, lt, lte, ...opts}
    }
}


/**********************************************************************************************************************/

export class MemoryStore extends Store {
    /* Base class for stores that load all records at once and keep them in memory as a Map. */

    _records = new BinaryMap()       // preloaded records, {binary-key: json-data}; unordered, sorting is done during scan()

    get(key)            { return this._records.get(key) }
    put(key, value)     { this._records.set(key, value); this.flush() }
    del(key)            { if (this._records.delete(key)) {this.flush(); return true} return false }
    erase()             { this._records.clear(); this.flush(0) }
    // get size()       { return this._records.size }

    *scan(opts) {
        /* Iterate over records in this block whose keys are in the [start, stop) range, where `start` and `stop`
           are binary keys (Uint8Array). Yield [key, value] pairs.
         */
        let {gt, gte, lt, lte, limit} = this._normalize_scan_opts(opts)

        let sorted_keys = [...this._records.keys()].sort(compare_bin)
        let total = sorted_keys.length

        // indexes for slice(start, stop) on sorted list of records
        let start = 0
        let stop  = total

        if (gt) {
            let pos = sorted_keys.findIndex(key => compare_bin(key, gt) > 0)        // first `key` to be accepted
            if (pos >= 0) start = pos; else start = total
        }
        if (gte) {
            let pos = sorted_keys.findIndex(key => compare_bin(key, gte) >= 0)
            if (pos >= 0) start = pos; else start = total
        }
        if (lt) {
            let pos = sorted_keys.findIndex(key => compare_bin(key, lt) >= 0)       // first `key` to be rejected
            if (pos >= 0) stop = pos
        }
        if (lte) {
            let pos = sorted_keys.findIndex(key => compare_bin(key, lte) > 0)
            if (pos >= 0) stop = pos
        }
        let count = 0

        for (let key of sorted_keys.slice(start, stop)) {
            if (limit !== undefined && ++count > limit) break
            yield [key, this._records.get(key)]
        }
    }

    flush(delay = 0.1) {
        /* Write unsaved modifications to disk, possibly with a `delay` seconds to combine multiple consecutive updates in one write. */
        if (!delay) {
            this._pending_flush = false
            return this._flush()
        }
        if (this._pending_flush) return
        this._pending_flush = true
        setTimeout(() => this.flush(0), delay * 1000)
    }
}

/**********************************************************************************************************************/

export class JsonStore extends MemoryStore {
    /* Binary key-value records stored in a .jl file (JSON Lines) in decoded form. */

    open() {
        /* Load records from this.filename file into this.records. */
        createFileIfNotExists(this.filename, fs)

        let content = fs.readFileSync(this.filename, 'utf8')
        let lines = content.split('\n').filter(line => line.trim().length > 0)
        let records = lines.map(line => JSON.parse(line))

        this._records.clear()

        for (let [key, value] of records)
            this._records.set(this.block.encode_key(key), value ? JSON.stringify(value) : '')
            // this._records.set(Uint8Array.from(key), value ? JSON.stringify(value) : '')
    }

    async _flush() {
        /* Save the entire database (this.records) to a file. */
        // print(`YamlIndexStorage flushing ${this._records.size} records to ${this.filename}...`)

        let lines = [...this.scan()].map(([key_binary, val_json]) => {
            let key = this.block.decode_key(key_binary)
            let key_json = JSON.stringify(key)  //Array.from(key_binary))
            return val_json ? `[${key_json}, ${val_json}]` : `[${key_json}]`
        })
        fs.writeFileSync(this.filename, lines.join('\n') + '\n', 'utf8')
    }
}


/**********************************************************************************************************************/

export class YamlDataStore extends MemoryStore {
    /* Web objects stored in a YAML file, with object ID saved as .id with other attributes. For use in DataBlock. */

    open() {
        /* Load records from this block's file. */

        // print(`YamlDataStore opening ${this.filename}...`)
        // assert(this.sequence = this.block.sequence)
        // assert(this.block.sequence.ring)

        // if (!this.sequence.is_loaded() && this.sequence.is_linked())
        //     await this.sequence.load()
        // if (!this.sequence.ring) await this.sequence.load()
        // let ring = this.sequence.ring

        // let ring = req.current_ring
        // let block = req.current_block
        // this.sequence = req.current_data

        createFileIfNotExists(this.filename, fs)

        let content = fs.readFileSync(this.filename, 'utf8')
        let records = YAML.parse(content) || []
        this._records.clear()

        for (let record of records) {
            let id = T.pop(record, 'id')
            let key = data_schema.encode_key([id])

            // ring.assert_valid_id(id, `item ID loaded from ${this.filename} is outside the valid bounds for this ring`)
            // await this.block.assert_unique(key, id, `duplicate item ID loaded from ${this.filename}`)

            let data = '__data' in record ? record.__data : record
            this._records.set(key, JSON.stringify(data))
        }
        // print(`YamlDataStore loaded ${this._records.size} items from ${this.filename}...`)
        return this.get_max_id()
    }

    get_max_id() {
        /* Maximum ID across all records. The encoding may use reversed binary representation of IDs,
           and for this reason it may be incorrect to rely on the ordering of binary keys to find the largest one.
         */
        let max = 0
        for (let key of this._records.keys()) {
            let id = data_schema.decode_key(key)[0]
            if (max < id) max = id
        }
        return max
    }

    async _flush() {
        /* Save the entire database (this.records) to a file. */
        print(`YamlDataStore flushing ${this._records.size} items to ${this.filename}...`)
        let recs = [...this.scan()].map(([key, data_json]) => {
            let id = data_schema.decode_key(key)[0]
            let data = JSON.parse(data_json)
            assert(data.id === undefined)       // there must be no `id` included as a plain attribute
            return T.isPOJO(data) ? {id, ...data} : {id, __data: data}
        })
        let out = YAML.stringify(recs)
        fs.writeFileSync(this.filename, out, 'utf8')
    }
}

