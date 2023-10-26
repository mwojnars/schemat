import {BinaryRecord, SequenceSchema} from "./records.js";
import {INTEGER} from "../type.js";
import {assert} from "../utils.js";
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

    schema              // SequenceSchema that defines this sequence's key and value
    splits              // array of split points between blocks
    blocks              // array of Blocks that make up this sequence
    derived = []        // array of derived sequences (indexes) that must be updated when this sequence changes
    flush_delay = 1.0   // delay (in seconds) before flushing all recent updates in a block to disk (to combine multiple consecutive updates in one write)


    _find_block(binary_key)     { return this.blocks[0] }

    async open(req) {
        for (let block of this.blocks) {
            await block
            await block.open(req.make_step(this))
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

    constructor({file, item} = {}) {
        super()

        // block is a local file, or an item that must be loaded from a lower ring
        let block = file ? new DataBlock(file) : globalThis.registry.getLoaded(item)
        this.blocks = [block]
    }

    encode_key(id) {
        assert(id !== undefined)
        return this.schema.encode_key([id])
    }
    decode_key(key) {
        return this.schema.decode_key(key)[0]
    }

    handle(req /*DataRequest*/) {
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

        return block[command].call(block, req)
    }

    async erase(req)   { return Promise.all(this.blocks.map(b => b.erase(req.make_step(this)))) }
    // async flush()   { return Promise.all(this.blocks.map(b => b.flush())) }
}