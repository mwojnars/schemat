import {BinaryRecord, ItemRecord, SequenceSchema} from "./records.js";
import {INTEGER} from "../type.js";
import {assert} from "../utils.js";
import {YamlDataBlock} from "./block.js";


/**********************************************************************************************************************
 **
 **  SEQUENCE & DATA SEQUENCE
 **
 */

export class Sequence {    // Series?
    /* Ordered sequence of key-value records, possibly distributed and/or replicated (TODO).
       Keys and values (payload) can be composite.
       May consist of multiple - possibly overlapping (replicated) - Blocks. TODO
       Maintains a map of blocks. Allows reshaping (splitting, merging) of blocks. TODO
       The Sequence is a NoSQL counterpart of a table in a relational database (DataSequence subclass),
       and is also used as a basis for implementation of indexes (the Index subclass).

           Database > Ring > Data/Index Sequence > Block > Storage > Record
     */

    schema          // SequenceSchema that defines this sequence's key and value
    splits          // array of split points between blocks
    blocks          // array of Blocks that make up this sequence
    derived = []    // array of derived sequences (indexes) that must be updated when this sequence changes

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

        for await (let [key, value] of block.scan({start, stop}))
            yield new BinaryRecord(this.schema, key, value)
    }

    propagate(change /*RecordChange*/) {
        /* Propagate a change in this sequence to all derived sequences. */
        for (const sequence of this.derived)
            sequence.apply(change)                      // no need to await, the result is not used
    }
}

export class DataSequence extends Sequence {
    /* Data sequence. The main sequence in the database. Consists of item records, {key: item-id, value: item-data}.
       Supports direct inserts (of new items) with auto-assignment and autoincrement of ID.
     */
    static role = 'data'        // for use in ProcessingStep and DataRequest

    schema = new SequenceSchema(
        new Map([['id', new INTEGER()]]),
        // value encoding is handled outside schema: through method overloading
    );

    constructor(ring, {file, item} = {}) {
        super()
        this.ring = ring

        // block is a local file, or an item that must be loaded from a lower ring
        let block = file ? new YamlDataBlock(ring, file) : globalThis.registry.getLoaded(item)
        this.blocks = [block]
    }

    _make_key(id)   { return id !== undefined ? this.schema.encode_key([id]) : undefined }

    _prepare(req, id) {
        let key = this._make_key(id)
        let block = this._find_block(key)
        req.make_step(this)
        return [key, block]
    }

    /***  low-level API (no request forwarding)  ***/

    async get(req, {id}) {
        /* Read item's data from this sequence, no forward to a lower ring. Return undefined if `id` not found. */
        assert(false, "this method seems to be not used (or maybe only with an Item ring?)")
        let [key, block] = this._prepare(req, id)
        return block.get(req, key)
    }

    async put(req, {id, data}) {
        let [key, block] = this._prepare(req, id)
        return block.put(req, key, data)
    }

    erase()     { return Promise.all(this.blocks.map(b => b.erase())) }
    flush()     { return Promise.all(this.blocks.map(b => b.flush())) }


    /***  high-level API (with request forwarding)  ***/

    async select(req, {id}) {
        let [key, block] = this._prepare(req, id)
        return block.select(req, id)
    }

    async insert(req, {id, data}) {
        let [key, block] = this._prepare(req, id)
        return block.insert(req, id, data)
    }

    async update(req, {id, edits}) {
        let [key, block] = this._prepare(req, id)
        return block.update(req, id, edits)
    }

    async delete(req, {id}) {
        let [key, block] = this._prepare(req, id)
        return block.delete(req, id)
    }
}