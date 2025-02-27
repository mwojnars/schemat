/* Subsequence class is NOT USED right now! */

import {INTEGER} from "../types/type.js";
import {BinaryInput} from "../common/binary.js";


export class Subsequence {
    /* !! NOT USED right now !!
       A sequence of binary key-value pairs that is physically stored as a subsequence of another Sequence, with keys prefixed
       by a constant: the ID of the Operator that produced this subsequence. As a thin wrapper around the underlying
       physical (sub)sequence, this class is NOT stored in the DB, and does NOT inherit from Sequence nor WebObject.
     */

    base_sequence               // the underlying Sequence
    id                          // ID of the Operator that produced this subsequence

    static iid_type = new INTEGER({blank: false})       // for encoding/decoding the ID using variable-length encoding

    constructor(id, base_sequence) {
        this.base_sequence = base_sequence
        this.id = id
        this.prefix = Subsequence.iid_type.encode_uint(id)
    }

    async put({key, value}) {
        let prefixed_key = this._prefix_key(key)
        return this.base_sequence.put({key: prefixed_key, value})
    }

    async del({key, value}) {
        let prefixed_key = this._prefix_key(key)
        return this.base_sequence.del({key: prefixed_key, value})
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

