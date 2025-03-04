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
    stream              // parent Stream of this sequence
    splits              // array of split points between blocks
    blocks              // array of Blocks that make up this sequence
    flush_delay         // delay (in seconds) before flushing all recent updates in a block to disk (to combine multiple consecutive updates in one write)


    __new__(ring) {
        ring.assert_active()
        this.ring = ring
    }

    async __init__() {
        // TODO: drop __init__() and perform lazy loading of blocks
        //  (but block.load() must only use lower rings to search for the block! otherwise infinite recursion occurs)

        if (CLIENT) return                                  // don't initialize internals when on client
        if (!this.ring) return                              // don't initialize internals when not yet assigned to a ring
        if (!this.ring.is_loaded()) this.ring.load()        // intentionally not awaited to avoid deadlocks
            // assert(this.ring.__meta.loading)

        // doing block.load() in __init__ is safe, because this sequence (ring) is not yet part of the database (!);
        // doing the same later may cause infinite recursion, because the load() request for a block may be directed
        // to the current sequence (which has an unloaded block!), and cause another block.load(), and so on...
        return Promise.all(this.blocks?.map(b => b.load()))
    }

    // add_derived(sequence) {
    //     /* Add a derived sequence (index) that must be updated when this sequence changes. */
    //     this.derived.push(sequence)
    // }


    _find_block(binary_key) {
        // print('binary_key:', binary_key)
        if (!this.splits) return this.blocks?.[0]

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
        let block = this._find_block(key)
        if (!block.is_loaded()) block = await block.load()
        return block.remote.put(key, value)
    }

    async del(key, value) {
        let block = this._find_block(key)
        if (!block.is_loaded()) block = await block.load()
        return block.remote.del(key, value)
    }

    async* scan_binary({start = null, stop = null, limit = null, reverse = false, batch_size = 100} = {}) {
        /* Scan this sequence in the [`start`, `stop`) range and yield [key, value] pairs.
           If `limit` is defined, yield at most `limit` items.
           If `reverse` is true, scan in the reverse order.
           If `batch_size` is defined, yield items in batches of `batch_size` items.
         */
        let block = this._find_block(start)
        block.assert_active()
        // if (!block.is_loaded()) block = await block.load()
        yield* block.scan({start, stop})
    }

    async erase()   { return Promise.all(this.blocks?.map(b => b.erase())) }
    async flush()   { return Promise.all(this.blocks?.map(b => b.flush())) }
}


/**********************************************************************************************************************/

export class IndexSequence extends Sequence {
    static __category = 22

    __new__(ring, filename) {
        super.__new__(ring)
        assert(filename.endsWith('.jl'))
        this.blocks = [Block.new(this, filename)]

        // let {IndexBlock} = this.__category.preloaded
        // let IndexBlock = await this.__category.import('./IndexBlock')
        // let IndexBlock = await schemat.import('/$/sys/IndexBlock')
        // this.blocks = [await IndexBlock.new(this, filename)]
    }

    // async __setup__(id) {
    //     // let {IndexBlock} = this.__category.preloaded
    //     // let IndexBlock = await this.__category.import('./IndexBlock')
    //     let IndexBlock = await schemat.import('/$/sys/IndexBlock')
    //     this.blocks = [await IndexBlock.new(id, this.filename).save()]
    // }
}

/**********************************************************************************************************************/

export class DataSequence extends Sequence {
    /* Data sequence. The main sequence in the database. Consists of item records, {key: item-id, value: item-data}.
       Supports direct inserts (of new items) with auto-assignment and autoincrement of ID.
     */
    static __category = 14
    static role       = 'data'          // for use in ProcessingStep and DataRequest
    static COMMANDS   = ['select', 'insert', 'update', 'upsave', 'delete']

    get file_prefix() { return 'data' }

    __new__(ring, filename) {
        super.__new__(ring)
        this.blocks = [DataBlock.new(this, filename)]
    }

    encode_key(id) {
        assert(id !== undefined)
        return data_schema.encode_key([id])
    }
    decode_key(key) {
        return data_schema.decode_key(key)[0]
    }

    async handle(req /*DataRequest*/, ...args) {
        /* Handle a request for data access/modification. The call is redirected to [req.command] method
           of the block containing a given item ID or record key.
         */
        let command = req.command
        assert(this.constructor.COMMANDS.includes(command), `unknown command: ${command}`)

        let {id, key} = req.args

        // calculate a `key` from `id` if missing in args
        if (key === undefined && id !== undefined && id !== null) {
            key = this.encode_key(id)
            req.make_step(this, null, {...req.args, key})
        }
        else
            req.make_step(this)

        let block = this._find_block(key)
        block.assert_active()
        // if (!block.is_loaded()) block = await block.load()

        return block[`cmd_${command}`].call(block, req)
    }
}


/**********************************************************************************************************************/

export class Operator extends WebObject {
    /* Specification of a data operator: source operator(s) + schema of output records + access methods (scan/min/max).
       The same operator can be applied to multiple rings, producing another stream in each ring.
     */

    get record_schema() {
        /* RecordSchema that defines the schema (key and payload) of output records produced by this operator. */
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


/**********************************************************************************************************************/

export class Stream extends WebObject {
    /* Logical sequence of records produced by a particular operator and stored in a particular ring. */
    ring
    operator
    sequence            // Sequence where the records of this stream are stored
    // derived          // derived streams that must be updated upon changes in this stream

    __new__(ring, operator) {
        this.ring = ring
        this.operator = operator
        // let index_file = ring._file.replace(/\.yaml$/, '.index.jl')
        // this.sequence = IndexSequence.new(ring, index_file)
    }

    async __init__() {
        await this.sequence.load()
        await this.operator.load()
    }

    change(key, prev, next) { return this.operator.change(this.sequence, key, prev, next) }
    async* scan(opts)       { yield* this.operator.scan(this.sequence, opts) }

    async rebuild() {
        await this.sequence.erase()
        await this.build()
    }

    async build() {
        for await (let {id, data} of this.ring.scan_all()) {
            let key = data_schema.encode_key([id])
            let obj = await WebObject.from_data(id, data, {activate: false})
            await this.change(key, null, obj)
        }
        // for await (let record of this.source.scan())
        //     await this.change(record.key, null, record)
    }
}

export class ObjectsStream extends Stream {
    /* The "objects" stream: primary data stream containing web objects. */
    get file_prefix() { return 'data' }
}

export class IndexStream extends Stream {
    /* Index deployed in a particular ring's sequence. */
    get file_prefix() { return 'index' }
}


