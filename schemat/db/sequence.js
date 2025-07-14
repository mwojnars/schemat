import {data_schema} from "./records.js";
import {assert, print, T} from "../common/utils.js";
import {BootDataBlock} from "./block.js";
import {WebObject} from "../core/object.js";
import {JSONx} from "../common/jsonx.js";
import {Catalog} from "../common/catalog.js";


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

           Database > Ring > Sequence (data/index) > Block > Store > Record
     */

    ring            // parent Ring of this sequence
    operator        // Operator that defines this sequence's name, record schema and sources; same operators are shared across rings
    splits          // array of split points between blocks
    blocks          // array of Blocks that make up this sequence, can be empty []
    flush_delay     // delay (in seconds) before flushing all recent updates in a block to disk (to combine multiple consecutive updates in one write)
    file_tag
    derived         // array of derived sequences that capture data from this one

    // get file_tag() { return 'index' }

    __setup__() {
        print('Sequence.__setup__() creating a block')
        let Block = schemat.std.Block
        this.blocks = [Block.new({sequence: this, storage: 'json'})]
        // this._print(`tx._staging:`, schemat.tx._staging)
    }

    async __load__() {
        // TODO: drop __load__() and perform lazy loading of blocks
        //  (but block.load() must only use lower rings to search for the block! otherwise infinite recursion occurs)

        if (CLIENT) return                                  // don't initialize internals when on client
        if (!this.ring) return                              // don't initialize internals when not yet assigned to a ring
        if (!this.ring.is_loaded()) this.ring.load()        // intentionally not awaited to avoid deadlocks
            // assert(this.ring.__meta.loading)

        await this.operator?.load()
        if (this.derived) await Promise.all(this.derived.map(seq => seq.load()))

        // 1) Doing block.load() in __load__ is safe, because this sequence (ring) is not yet part of the database (!);
        // doing the same later may cause infinite recursion, because the load() request for a block may be directed
        // to the current sequence (which has an unloaded block!), and cause another block.load(), and so on...
        // 2) Setting a custom {ring} is needed to enable distributed storage, so that searching for the block object
        // over the cluster does NOT evoke an infinite chain of cyclic load attempts. Here, it's assumed that
        // this.__ring is a special type of system-level ring whose data is readily available on every cluster node.
        // ...
        // return Promise.all(this.blocks.map(b => b.load({ring: this.__ring})))
    }

    find_block(key_binary) {
        // print('key_binary:', key_binary)
        if (!this.splits?.length) return this.blocks[0]

        let index = this.splits.findIndex(split => compare_uint8(split, key_binary) > 0)
        if (index === -1) index = this.blocks.length - 1
        return this.blocks[index]

        // let left = 0
        // let right = this.splits.length - 1
        //
        // // binary search over `splits` to find the block containing the given key
        // while (left <= right) {
        //     let mid = Math.floor((left + right) / 2)
        //     let cmp = compare_uint8(this.splits[mid], key_binary)
        //     if (cmp > 0) right = mid - 1
        //     else left = mid + 1
        // }
        // return this.blocks[left]
    }

    async put(key, value) {
        let block = this.find_block(key)
        // if (!block.is_loaded()) block = await block.load()
        return block.$agent.put(key, value)
    }

    async del(key) {
        let block = this.find_block(key)
        // if (!block.is_loaded()) block = await block.load()
        return block.$agent.del(key)
    }


    // if (!this.operator.is_loaded()) this._print(`UNLOADED operator ${this.operator}, __meta=${this.operator.__meta}, __data=${this.operator.__data}`)
    encode_key(key) { return this.operator.encode_key(key) }    // app > binary representation
    decode_key(bin) { return this.operator.decode_key(bin) }    // binary > app representation

    async* scan_binary(opts = {}) {
        /* Scan this sequence in [`start`, `stop`) range and yield [key, value] pairs, where `key` is an Uint8Array
           and `value` is a JSON string. The options, start/stop, should already be encoded as binary.
         */
        let {start = null, stop = null, reverse = false} = opts
        assert(!reverse)

        let block_start = this.find_block(start)
        let block_stop = this.find_block(stop)
        assert(block_start === block_stop)

        // block_start.assert_active()
        // if (!block.is_loaded()) block = await block.load()
        yield* await block_start.$agent.scan(opts)
    }

    async erase()   { return Promise.all(this.blocks.map(b => b.$agent.erase())) }
    async flush()   { return Promise.all(this.blocks.map(b => b.$agent.flush())) }

    capture_change(key, prev, next) {
        /* Update this sequence to apply a [prev > next] change that originated in the source sequence
           at a binary `key`. Here, `prev` and `next` are source-sequence entities: objects or records.
           Missing 'prev' represents insertion; missing `next` represents deletion.
         */
        // this._print(`capture_change(), binary key [${key}]:\n   ${prev} \n->\n   ${next}`)
        let [del_records, put_records] = this.operator.derive(key, prev, next)

        // delete old records
        for (let [key, value] of del_records || [])
            this.del(key)                   // no need to await, the result is not used by the caller

        // (over)write new records
        for (let [key, value] of put_records || [])
            this.put(key, value)
    }

    async 'action.create_derived'(operator) {
        /* Create a derived sequence that would implement a data `operator`. */

        let category = schemat.std.Sequence
        let seq = await category.new({ring: this.ring, operator})
        this.derived = [...this.derived || [], seq]

        let opts = {ring: this.__ring, broadcast: true}
        await this.save(opts)

        // this.blocks.map(b => b.edit.touch()) -- touch all blocks to let them know about the new derived sequence ??
        // schemat.tx.save({broadcast: true})   -- broadcast performed AFTER commit
        // schemat.tx.broadcast()       = commit + broadcast
    }
}


/**********************************************************************************************************************/

export class DataSequence extends Sequence {
    /* Data sequence. The main sequence in the database. Consists of item records, {key: item-id, value: item-data}.
       Supports direct inserts (of new items) with auto-assignment and autoincrement of ID.
     */

    get file_tag() { return 'data' }

    __new__(boot_file = null) {
        if (boot_file) this.blocks = [BootDataBlock.draft({sequence: this}, boot_file)]
    }

    async __setup__() {
        let DataBlock = schemat.std.DataBlock
        this.blocks = [DataBlock.new({sequence: this, storage: 'yaml'})]
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
        for await (let [key, json] of this.scan_binary()) {
            let id = this.decode_id(key)
            let data = JSONx.parse(json)
            if (T.isPOJO(data)) data = Catalog.__setstate__(data)
            yield {id, data}
        }
    }
}
