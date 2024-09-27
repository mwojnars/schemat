import {BinaryRecord, data_schema} from "./records.js";
import {assert, print} from "../common/utils.js";
import {DataBlock, IndexBlock} from "./block.js";
import {Item} from "../core/object.js";
import {BinaryInput} from "../common/binary.js";
import {INTEGER} from "../types/type.js";


/**********************************************************************************************************************
 **
 **  SEQUENCE & DATA SEQUENCE
 **
 */

export class Sequence extends Item {    // Series?
    /* Ordered binary sequence of key-value records, possibly distributed and/or replicated (TODO).
       Keys and values (payload) can be composite.
       May consist of multiple - possibly overlapping (replicated) - Blocks. TODO
       Maintains a map of blocks. Allows reshaping (splitting, merging) of blocks. TODO
       A NoSQL counterpart of a table/index in a relational database.

           Database > Ring > Sequence (data/index) > Block > Storage > Record
     */

    ring                // parent Ring of this sequence
    splits              // array of split points between blocks
    blocks              // array of Blocks that make up this sequence
    flush_delay         // delay (in seconds) before flushing all recent updates in a block to disk (to combine multiple consecutive updates in one write)
    // derived = []        // array of derived sequences (indexes) that must be updated when this sequence changes


    __create__(ring) {
        ring.assert_loaded_or_newborn()
        this.ring = ring
    }

    async __init__() {
        // TODO: drop __init__() and perform lazy loading of blocks
        //  (but block.load() must only use lower rings to search for the block! otherwise infinite recursion occurs)

        if (CLIENT) return                                  // don't initialize internals when on client
        if (!this.ring) return                              // don't initialize internals when not yet assigned to a ring
        if (!this.ring.is_loaded()) this.ring.load()        // intentionally not awaited to avoid deadlocks

        // doing block.load() in __init__ is safe, because this sequence (ring) is not yet part of the database (!);
        // doing the same later on may cause infinite recursion, because the load() request for a block may be directed
        // to the current sequence (which has an unloaded block!), and cause another block.load(), and so on...
        return this.blocks[0].load()
    }

    // add_derived(sequence) {
    //     /* Add a derived sequence (index) that must be updated when this sequence changes. */
    //     this.derived.push(sequence)
    // }

    async open() {
        // this method is only called when the sequence is created anew and its ID is not yet assigned!
        for (let block of this.blocks) {
            await block
            await block.open()
            // block._set_expiry('never')          // prevent eviction of this block from cache (!)
        }
    }


    _find_block(binary_key)     { return this.blocks[0] }


    async put(req) {
        let block = this._find_block(req.args.key)
        if (!block.is_loaded()) block = await block.load()
        return block.put(req)
    }

    async del(req) {
        let block = this._find_block(req.args.key)
        if (!block.is_loaded()) block = await block.load()
        return block.del(req)
    }

    async* scan_binary({start = null, stop = null, limit = null, reverse = false, batch_size = 100} = {}) {
        /* Scan this sequence in the [`start`, `stop`) range and yield [key, value] pairs.
           If `limit` is defined, yield at most `limit` items.
           If `reverse` is true, scan in the reverse order.
           If `batch_size` is defined, yield items in batches of `batch_size` items.
         */
        let block = this._find_block(start)
        block.assert_loaded_or_newborn()
        // if (!block.is_loaded()) block = await block.load()
        yield* block.scan({start, stop})
    }

    async erase(req)   { return Promise.all(this.blocks.map(b => b.erase(req.make_step(this)))) }
    // async erase(req)   { return Promise.all(this.blocks.map(async b => (await b.load()).erase(req.make_step(this)))) }
    // async flush()   { return Promise.all(this.blocks.map(b => b.flush())) }
}


/**********************************************************************************************************************/

export class IndexSequence extends Sequence {
    /* A Sequence composed of IndexBlock type of blocks. */

    __create__(ring, filename) {
        super.__create__(ring)
        assert(filename.endsWith('.jl'))
        this.blocks = [IndexBlock.create(this, filename)]
    }
}

export class Subsequence {
    /* A sequence of binary key-value pairs that is physically stored as a subsequence of another Sequence, with keys prefixed
       by a constant: the IID of the Operator that produced this subsequence. As a thin wrapper around the underlying
       physical (sub)sequence, this class is NOT stored in the DB, and does NOT inherit from Sequence nor Item.
     */

    base_sequence               // the underlying Sequence
    id                          // IID of the Operator that produced this subsequence

    static iid_type = new INTEGER({blank: false})       // for encoding/decoding the IID using variable-length encoding

    constructor(id, base_sequence) {
        this.base_sequence = base_sequence
        this.id = id
        this.prefix = Subsequence.iid_type.encode_uint(id)
    }

    async put(req) {
        let prefixed_key = this._prefix_key(req.args.key)
        let modified_req = req.safe_step(this, 'put', {...req.args, key: prefixed_key})
        return this.base_sequence.put(modified_req)
    }

    async del(req) {
        let prefixed_key = this._prefix_key(req.args.key)
        let modified_req = req.safe_step(this, 'del', {...req.args, key: prefixed_key})
        return this.base_sequence.del(modified_req)
    }

    async* scan_binary(opts = {}) {
        let start = opts.start ? this._prefix_key(opts.start) : null
        let stop = opts.stop ? this._prefix_key(opts.stop) : null

        let base_scan = this.base_sequence.scan_binary({...opts, start, stop})

        for await (let [key, value] of base_scan)
            yield [this._unprefix_key(key), value]
    }

    _prefix_key(key) {
        let result = new Uint8Array(this.prefix.length + key.length)
        result.set(this.prefix, 0)
        result.set(key, this.prefix.length)
        return result
    }

    _unprefix_key(prefixed_key) {
        let input = new BinaryInput(prefixed_key)
        let id = Subsequence.iid_type.decode_uint(input)
        if (id !== this.id) throw new Error(`Invalid subsequence key, found ID prefix=${id} instead of ${this.id} in key ${prefixed_key}`)
        return input.current()
    }
}

/**********************************************************************************************************************/

export class DataSequence extends Sequence {
    /* Data sequence. The main sequence in the database. Consists of item records, {key: item-id, value: item-data}.
       Supports direct inserts (of new items) with auto-assignment and autoincrement of ID.
     */
    static __category = 14
    static role       = 'data'          // for use in ProcessingStep and DataRequest
    static COMMANDS   = ['get', 'put', 'select', 'insert', 'update', 'delete']

    __create__(ring, filename) {
        super.__create__(ring)
        this.blocks = [DataBlock.create(this, filename)]
    }

    encode_key(id) {
        assert(id !== undefined)
        return data_schema.encode_key([id])
    }
    decode_key(key) {
        return data_schema.decode_key(key)[0]
    }

    async handle(req /*DataRequest*/) {
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
        block.assert_loaded_or_newborn()
        // if (!block.is_loaded()) block = await block.load()

        return block[command].call(block, req)
    }
}


/**********************************************************************************************************************/

export class Operator extends Item {

    record_schema       // RecordSchema that defines keys and values of records produced by this operator

    async* scan(sequence, opts = {}) {
        /* Scan this operator's output in the [`start`, `stop`) range and yield BinaryRecords. See Sequence.scan() for details. */
        let {start, stop} = opts
        let rschema = this.record_schema

        start = start && rschema.encode_key(start)          // convert `start` and `stop` to binary keys (Uint8Array)
        stop = stop && rschema.encode_key(stop)

        for await (let [key, value] of sequence.scan_binary({...opts, start, stop}))
            yield new BinaryRecord(rschema, key, value)
    }
}

export class DataOperator extends Operator {
    /* Operator that scans the main data sequence. */

    record_schema = data_schema
}


