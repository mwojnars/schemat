import {BinaryRecord, SequenceSchema} from "./records.js";
import {INTEGER} from "../type.js";
import {assert, print} from "../utils.js";
import {DataBlock} from "./block.js";
import {Item} from "../item.js";


/**********************************************************************************************************************
 **
 **  SEQUENCE & DATA SEQUENCE
 **
 */

export class Sequence extends Item {    // Series?
    /* Ordered sequence of key-value records, possibly distributed and/or replicated (TODO).
       Keys and values (payload) can be composite.
       May consist of multiple - possibly overlapping (replicated) - Blocks. TODO
       Maintains a map of blocks. Allows reshaping (splitting, merging) of blocks. TODO
       The Sequence is a NoSQL counterpart of a table in a relational database (DataSequence subclass),
       and is also used as a basis for implementation of indexes (the Index subclass).

           Database > Ring > Data/Index Sequence > Block > Storage > Record
     */

    ring                // Ring that this sequence belongs to
    schema              // SequenceSchema that defines this sequence's key and value
    splits              // array of split points between blocks
    blocks              // array of Blocks that make up this sequence
    derived = []        // array of derived sequences (indexes) that must be updated when this sequence changes
    flush_delay = 1.0   // delay (in seconds) before flushing all recent updates in a block to disk (to combine multiple consecutive updates in one write)


    __create__(ring) {
        this.ring = ring
    }

    // TODO: drop __init__() and perform lazy loading of blocks
    //  (block.load() must only use lower rings to search for the block, otherwise infinite recursion occurs)
    async __init__() {
        return this.blocks[0].load()
    }

    _find_block(binary_key)     { return this.blocks[0] }

    async open() {
        for (let block of this.blocks) {
            await block
            await block.open()
            block.setExpiry('never')            // prevent eviction of this item from Registry's cache (!)
        }
    }

    async* scan({start = null, stop = null, limit = null, reverse = false, batch_size = 100} = {}) {
        /* Scan this sequence in the [`start`, `stop`) range and yield BinaryRecords.
           If `limit` is defined, yield at most `limit` items.
           If `reverse` is true, scan in the reverse order.
           If `batch_size` is defined, yield items in batches of `batch_size` items.
         */

        // convert `start` and `stop` to binary keys (Uint8Array)
        start = start && this.schema.encode_key(start)
        stop = stop && this.schema.encode_key(stop)

        let block = this._find_block(start)
        if (!block.is_loaded()) block = await block.load()

        for await (let [key, value] of block.scan({start, stop}))
            yield new BinaryRecord(this.schema, key, value)
    }

    add_derived(sequence) {
        /* Add a derived sequence (index) that must be updated when this sequence changes. */
        this.derived.push(sequence)
    }

    propagate(req, change /*ChangeRequest*/) {
        /* Propagate a change in this sequence, as submitted by a child block, to all derived sequences. */
        for (const sequence of this.derived)
            sequence.apply(change)                      // no need to await, the result is not used
    }
}

export class DataSequence extends Sequence {
    /* Data sequence. The main sequence in the database. Consists of item records, {key: item-id, value: item-data}.
       Supports direct inserts (of new items) with auto-assignment and autoincrement of ID.
     */
    static role = 'data'        // for use in ProcessingStep and DataRequest
    static COMMANDS = ['get', 'put', 'select', 'insert', 'update', 'delete']

    schema = new SequenceSchema(
        new Map([['id', new INTEGER()]]),
        // value encoding is handled outside schema: through method overloading
    );

    __create__(ring, filename) {
        super.__create__(ring)
        this.blocks = [DataBlock.create(this, filename)]
    }

    encode_key(id) {
        assert(id !== undefined)
        return this.schema.encode_key([id])
    }
    decode_key(key) {
        return this.schema.decode_key(key)[0]
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
        if (!block.is_loaded()) block = await block.load()

        return block[command].call(block, req)
    }

    async erase(req)   { return Promise.all(this.blocks.map(async b => (await b.load()).erase(req.make_step(this)))) }
    // async flush()   { return Promise.all(this.blocks.map(b => b.flush())) }
}