import {Record, data_schema, RecordSchema} from "./records.js";
import {assert, print} from "../common/utils.js";
import {Block, DataBlock} from "./block.js";
import {WebObject} from "../core/object.js";
import {BinaryInput} from "../common/binary.js";
import {INTEGER} from "../types/type.js";


/**********************************************************************************************************************
 **
 **  SEQUENCE & DATA SEQUENCE
 **
 */

export class Sequence extends WebObject {
    /* Ordered binary sequence of key-value records, possibly distributed and/or replicated (TODO).
       Keys and values (payload) can be composite.
       May consist of multiple - possibly overlapping (replicated) - Blocks. TODO
       Maintains a map of blocks. Allows reshaping (splitting, merging) of blocks. TODO
       A NoSQL counterpart of a table/index in a relational database.

           Database > Ring > Sequence (data/index) > Block > Storage > Record
     */

    ring                // parent Ring of this sequence
    operator            // Operator that defines this sequence's name, record schema and sources; same operators are shared across rings
    splits              // array of split points between blocks
    blocks              // array of Blocks that make up this sequence, can be empty []
    flush_delay         // delay (in seconds) before flushing all recent updates in a block to disk (to combine multiple consecutive updates in one write)
    file_prefix

    // impute_name() { return this.operator?.name }

    __new__(ring, operator) {
        ring.assert_active()
        this.ring = ring
        this.operator = operator
        this.blocks = []
    }

    async __init__() {
        // TODO: drop __init__() and perform lazy loading of blocks
        //  (but block.load() must only use lower rings to search for the block! otherwise infinite recursion occurs)

        if (CLIENT) return                                  // don't initialize internals when on client
        if (!this.ring) return                              // don't initialize internals when not yet assigned to a ring
        if (!this.ring.is_loaded()) this.ring.load()        // intentionally not awaited to avoid deadlocks
            // assert(this.ring.__meta.loading)

        await this.operator?.load()

        // doing block.load() in __init__ is safe, because this sequence (ring) is not yet part of the database (!);
        // doing the same later may cause infinite recursion, because the load() request for a block may be directed
        // to the current sequence (which has an unloaded block!), and cause another block.load(), and so on...
        return Promise.all(this.blocks.map(b => b.load()))
    }

    // add_derived(sequence) {
    //     /* Add a derived sequence (index) that must be updated when this sequence changes. */
    //     this.derived.push(sequence)
    // }


    find_block(binary_key) {
        // print('binary_key:', binary_key)
        if (!this.splits?.length) return this.blocks[0]

        let index = this.splits.findIndex(split => compare_uint8(split, binary_key) > 0)
        if (index === -1) index = this.blocks.length - 1
        return this.blocks[index]

        // let left = 0
        // let right = this.splits.length - 1
        //
        // // binary search over `splits` to find the block containing the given key
        // while (left <= right) {
        //     let mid = Math.floor((left + right) / 2)
        //     let cmp = compare_uint8(this.splits[mid], binary_key)
        //     if (cmp > 0) right = mid - 1
        //     else left = mid + 1
        // }
        // return this.blocks[left]
    }


    async put(key, value) {
        let block = this.find_block(key)
        if (!block.is_loaded()) block = await block.load()
        return block.remote.put(key, value)
    }

    async del(key, value) {
        let block = this.find_block(key)
        if (!block.is_loaded()) block = await block.load()
        return block.remote.del(key, value)
    }

    async* scan_binary({start = null, stop = null, limit = null, reverse = false, batch_size = 100} = {}) {
        /* Scan this sequence in the [`start`, `stop`) range and yield [key, value] pairs.
           If `limit` is defined, yield at most `limit` items.
           If `reverse` is true, scan in the reverse order.
           If `batch_size` is defined, yield items in batches of `batch_size` items.
         */
        let block = this.find_block(start)
        block.assert_active()
        // if (!block.is_loaded()) block = await block.load()
        yield* block.scan({start, stop})
    }

    async* scan(opts)       { yield* this.operator.scan(this, opts) }

    change(key, prev, next) { return this.operator.change(this, key, prev, next) }

    async erase()   { return Promise.all(this.blocks.map(b => b.erase())) }
    async flush()   { return Promise.all(this.blocks.map(b => b.flush())) }

    async build() {
        for await (let {id, data} of this.ring.scan_all()) {
            let key = data_schema.encode_key([id])
            let obj = await WebObject.from_data(id, data, {activate: false})
            await this.change(key, null, obj)
        }
        // for await (let record of this.source.scan())
        //     await this.change(record.key, null, record)
    }

    async rebuild() {
        await this.erase()
        await this.build()
    }
}


/**********************************************************************************************************************/

export class IndexSequence extends Sequence {

    get file_prefix() { return 'index' }

    async __setup__() {
        print('IndexSequence.__setup__() creating a block')
        let Block = await schemat.import('/$/sys/Block')
        this.blocks = [Block.new(this, {format: 'index-jl'})]
    }
}

/**********************************************************************************************************************/

export class DataSequence extends Sequence {
    /* Data sequence. The main sequence in the database. Consists of item records, {key: item-id, value: item-data}.
       Supports direct inserts (of new items) with auto-assignment and autoincrement of ID.
     */

    get file_prefix() { return 'data' }

    __new__(ring, {boot_file} = {}) {
        super.__new__(ring)
        if (boot_file) this.blocks = [DataBlock._draft(this, {filename: boot_file})]
    }

    async __setup__() {
        let DataBlock = await schemat.import('/$/sys/DataBlock')
        this.blocks = [DataBlock.new(this, {format: 'data-yaml'})]
    }

    encode_id(id) {
        assert(id !== undefined)
        return data_schema.encode_key([id])
    }
    decode_id(key) {
        return data_schema.decode_key(key)[0]
    }

    find_block_id(id) {
        let key = this.encode_id(id)
        return this.find_block(key)
    }
}


/**********************************************************************************************************************/

export class Operator extends WebObject {
    /* Specification of a data sequence operator: source operator(s) + schema of output records + access methods (scan/min/max).
       The same operator can be applied to multiple rings, producing a different sequence in each ring.
     */

    get record_schema() {
        /* RecordSchema that defines the schema (composite key + payload) of output records produced by this operator. */
        return new RecordSchema(this.key_spec, this.payload)
    }

    async* scan(sequence, opts = {}) {
        /* Scan this operator's output in the [`start`, `stop`) range and yield BinaryRecords. See Sequence.scan() for details. */
        let {start, stop} = opts
        let rschema = this.record_schema

        start = start && rschema.encode_key(start)          // convert `start` and `stop` to binary keys (Uint8Array)
        stop = stop && rschema.encode_key(stop)

        for await (let [key, value] of sequence.scan_binary({...opts, start, stop}))
            yield Record.binary(rschema, key, value)
    }

    // async min(seq)
    // async max(seq)
}

export class DataOperator extends Operator {
    /* Special type of Operator that has no source and represents the main data sequence. */

    record_schema = data_schema
}

