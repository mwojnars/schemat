import {Record, data_schema, RecordSchema} from "./records.js";
import {assert, print} from "../common/utils.js";
import {BootDataBlock} from "./block.js";
import {WebObject} from "../core/object.js";


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

        // 1) Doing block.load() in __init__ is safe, because this sequence (ring) is not yet part of the database (!);
        // doing the same later may cause infinite recursion, because the load() request for a block may be directed
        // to the current sequence (which has an unloaded block!), and cause another block.load(), and so on...
        // 2) Setting a custom {ring} is needed to enable distributed storage, so that searching for the block object
        // over the cluster does NOT evoke an infinite chain of cyclic load attempts. Here, it's assumed that
        // this.__ring is a special type of system-level ring whose data is readily available on every cluster node.
        return Promise.all(this.blocks.map(b => b.load({ring: this.__ring})))
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


    // if (!this.operator.is_loaded()) this._print(`UNLOADED operator ${this.operator.__label}, __meta=${this.operator.__meta}, __data=${this.operator.__data}`)
    encode_key(key) { return this.operator.encode_key(key) }    // app > binary representation
    decode_key(bin) { return this.operator.decode_key(bin) }    // binary > app representation

    async* scan_binary({start = null, stop = null, limit = null, reverse = false, batch_size = 100} = {}) {
        /* Scan this sequence in the [`start`, `stop`) range and yield [key, value] pairs.
           If `limit` is defined, yield at most `limit` items.
           If `reverse` is true, scan in the reverse order.
           If `batch_size` is defined, yield items in batches of `batch_size` items.
         */
        assert(!reverse)

        let block_start = this.find_block(start)
        let block_stop = this.find_block(stop)
        assert(block_start === block_stop)

        block_start.assert_active()
        // if (!block.is_loaded()) block = await block.load()
        yield* block_start.scan({start, stop})
    }

    async* scan(opts = {}) {
        /* Scan this sequence in the [`start`, `stop`) range and yield BinaryRecords. */
        let {start, stop} = opts
        let rschema = this.operator.record_schema

        start = start && rschema.encode_key(start)          // convert `start` and `stop` to binary keys (Uint8Array)
        stop = stop && rschema.encode_key(stop)

        for await (let [key, value] of this.scan_binary({...opts, start, stop}))
            yield Record.binary(rschema, key, value)
    }

    async erase()   { return Promise.all(this.blocks.map(b => b.erase())) }
    async flush()   { return Promise.all(this.blocks.map(b => b.flush())) }
}


/**********************************************************************************************************************/

export class IndexSequence extends Sequence {

    get file_prefix() { return 'index' }

    async __setup__() {
        print('IndexSequence.__setup__() creating a block')
        let Block = this.__lib.Block
        this.blocks = [Block.new(this, {format: 'index-jl'})]
    }

    async put(key, value) {
        let block = this.find_block(key)
        if (!block.is_loaded()) block = await block.load()
        return block.$agent.put(key, value)
    }

    async del(key, value) {
        let block = this.find_block(key)
        if (!block.is_loaded()) block = await block.load()
        return block.$agent.del(key, value)
    }

    apply_change(key, prev, next) { return this.operator.apply_change(this, key, prev, next) }
}

/**********************************************************************************************************************/

export class DataSequence extends Sequence {
    /* Data sequence. The main sequence in the database. Consists of item records, {key: item-id, value: item-data}.
       Supports direct inserts (of new items) with auto-assignment and autoincrement of ID.
     */

    get file_prefix() { return 'data' }

    __new__(ring, operator, {boot_file} = {}) {
        super.__new__(ring, operator)
        if (boot_file) this.blocks = [BootDataBlock._draft(this, {filename: boot_file})]
    }

    async __setup__() {
        let DataBlock = this.__lib.DataBlock
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

    async* scan_objects() {
        /* Yield all objects in this sequence as {id, data} pairs.
           Scanning a data sequence differs from an index scan because the key space is sharded (by low bits),
           not segmented (by high bits/bytes), hence the result stream is not monotonic, OR it will require a merge-sort
           to become monotonic. Plus, the function outputs {id, data} pairs (decoded) instead of binary records.
         */
        for await (let record of this.scan())
            yield record.decode_object()
    }
}


/**********************************************************************************************************************/

export class Operator extends WebObject {
    /* Specification of a data sequence operator: source operator(s) + schema of output records + access methods (scan/min/max).
       The same operator can be applied to multiple rings, producing a different sequence in each ring.
     */

    key_spec
    payload
    file_prefix

    get record_schema() {
        /* RecordSchema that defines the schema (composite key + payload) of output records produced by this operator. */
        return new RecordSchema(this.key_spec, this.payload)
    }

    encode_key(key) {
        /* Encode an array of field values [f1,f2,...] to binary representation (Uint8Array). */
        return this.record_schema.encode_key(key)
    }

    decode_key(bin) {
        /* Decode binary representation of a key back to an array of field values. */
        return this.record_schema.decode_key(bin)
    }

    // async min(seq)
    // async max(seq)
}

export class DataOperator extends Operator {
    /* Special type of Operator that has no source and represents the main data sequence. */

    get record_schema() { return data_schema }
}

