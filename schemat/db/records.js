/*
    Low-level representation of objects and index records, for storage and transmission from/to the database.
 */

import {drop_plural} from "../common/globals.js";
import {assert, print, T} from "../common/utils.js";
import {JSONx} from "../common/jsonx.js";
import {BinaryInput, BinaryOutput} from "../common/binary.js";
import {INTEGER} from "../types/type.js";


// // EMPTY token marks missing payload in a record
// const EMPTY = Symbol.for('empty')
//
// export class Record {
//
//     schema              // RecordSchema of the parent Sequence of this record
//
//     _key                // array of fields decoded from the binary key
//     _val                // object or plain JS value parsed from JSON string, or EMPTY (empty value)
//
//     _key_binary         // _key encoded as Uint8Array through `schema`
//     _key_object         // _key unwrapped into a plain object (dictionary) with {field: value} pairs
//     _val_json           // JSON-stringified _val, or empty string (when empty value)
//
//
//     get key()           { return this._key || (this._key = this.schema.decode_key(this._key_binary)) }
//     get key_binary()    { return this._key_binary || (this._key_binary = this.schema.encode_key(this._key)) }
//     get key_object()    { return this._key_object || this._key_to_object() }
//
//     // get val()           { let val = (this._val !== undefined ? this._val : this._decode_value()); return val === EMPTY ? undefined : val }
//     get val_json()      { return this._val_json || this._encode_value() }
//
//     _hash               // hash computed from _key_binary and _val_json combined; to be used for eviction/update of record cache in Registry ???
//     get hash()          { return this._hash || this._compute_hash() }
//
//     _key_to_object() {
//         let fields = this.schema.key_names
//         let key = this.key
//         let obj = {}
//
//         for (let i = 0; i < fields.length; i++) {
//             let field = fields[i]
//             if (field.endsWith(PLURAL)) field = field.slice(0, -PLURAL.length)
//             obj[field] = key[i]
//         }
//
//         return this._key_object = obj
//     }
//
//     _encode_value() {
//         return this._val_json = (this._val === EMPTY ? '' : JSON.stringify(this._val))
//     }
//
//     _decode_value() {
//         return this._val = (this._val_json === '' ? EMPTY : JSON.parse(this._val_json))
//     }
//
//     _compute_hash() {
//         let key = this.key_binary                                   // Uint8Array
//         let val = new TextEncoder().encode(this.val_json)           // value string converted to Uint8Array
//
//         // write [length of key] + `key` + `val` into a single Uint8Array
//         let offset = 4                                              // 4 bytes for the length of key
//         let length = offset + key.length + val.length               // total length of the result
//         let result = new Uint8Array(length)
//
//         // write key.length into the first 4 bytes of result
//         result[0] = (key.length >> 24) & 0xFF
//         result[1] = (key.length >> 16) & 0xFF
//         result[2] = (key.length >>  8) & 0xFF
//         result[3] =  key.length        & 0xFF
//
//         // append key and val to result
//         result.set(key, offset)
//         result.set(val, offset + key.length)
//
//         return this._hash = fnv1aHash(result)
//     }
//
//     static compare(rec1, rec2) {
//         /* Compare two records by their binary keys (byte order). */
//         return compare_uint8(rec1.key_binary, rec2.key_binary)
//     }
//
//     constructor(schema, binary = null, /*plain = null*/) {
//         assert(schema instanceof RecordSchema)
//         this.schema = schema
//
//         // if (plain) {
//         //     this._key = plain.key
//         //     this._val = (plain.val === undefined ? EMPTY : plain.val)
//         //     assert(T.isArray(this._key), `invalid key: ${this._key}`)
//         // }
//         if (binary) {
//             this._key_binary = binary.key
//             this._val_json = binary.val
//             assert(this._key_binary instanceof Uint8Array, `expected a binary key in record, got ${this._key_binary}`)
//             assert(typeof this._val_json === 'string', `expected a string value in record, got ${this._val_json}`)
//         }
//     }
//
//     // static binary(schema, key, val) { return new Record(schema, {key, val}) }
//     // static plain(schema, key, val)  { return new Record(schema, null, {key, val}) }
// }


/**********************************************************************************************************************/

export class RecordSchema {
    /* Schema of records in a Sequence. Defines the key and value to be stored in records. */

    key_fields          // {name: type}, a Map of names and Types of fields to be included in the sequence's key
    val_fields          // array of property names to be included in the "value" (payload) part of the record

    _key_names          // array of names of consecutive fields in the key
    _key_types          // array of Types of consecutive fields in the key

    get key_names()     { return this._key_names || (this._key_names = [...this.key_fields.keys()]) }
    get key_types()     { return this._key_types || (this._key_types = [...this.key_fields.values()]) }

    constructor(key_fields, val_fields = []) {
        assert(key_fields?.size > 0, `key is empty`)
        this.key_fields = key_fields
        this.val_fields = val_fields || []
    }

    // has_payload() { return !!this.val_fields?.length }     // true if payload part is present in records

    encode_key(key) {
        /* `key` is an array of field values. The array can be shorter than this.key_types ("partial key")
           - this may happen when a key is used for a partial match as a lower/upper bound in a scan() operation.
         */
        let types  = this.key_types
        let output = new BinaryOutput()
        let length = Math.min(types.length, key.length)

        assert(key.length <= types.length, `key length ${key.length} > field types length ${types.length}`)

        for (let i = 0; i < length; i++) {
            const type = types[i]
            const last = (i === types.length - 1)
            const bin  = type.binary_encode(key[i], last)
            output.write(bin)
        }
        return output.result()
    }

    decode_key(key_binary) {
        /* Decode a `key_binary` (Uint8Array) back into an array of field values. Partial keys are NOT supported here. */
        let types  = this.key_types
        let input  = new BinaryInput(key_binary)
        let length = types.length
        let key = []

        for (let i = 0; i < length; i++) {
            const type = types[i]
            const last = (i === length - 1)
            const val  = type.binary_decode(input, last)
            key.push(val)
        }
        assert(input.pos === key_binary.length)

        return key
    }

    decode_key_object(key_binary) {
        let fields = this.key_names
        let key = this.decode_key(key_binary)
        let obj = {}

        for (let i = 0; i < fields.length; i++) {
            let field = drop_plural(fields[i])
            obj[field] = key[i]
        }
        return obj
    }

    encode_value(obj) {
        /* Encode an object into a JSONx-stringified vector of field values, with surrounding brackets stripped.
           Undefined values are replaced with null.

           TODO: use CBOR encoding (https://github.com/kriszyp/cbor-x)
           import cbor from 'cbor-x'
           let buf = cbor.encode(obj)
           let obj = cbor.decode(buf)
         */
        let {val_fields} = this
        if (!val_fields.length || obj === undefined) return ''
        let vector = val_fields.map(field => {let val = obj[field]; return val === undefined ? null : val})
        return JSONx.stringify(vector).slice(1, -1)
    }

    decode_value(val_json) {
        if (!val_json) return {}
        let vector = JSONx.parse(`[${val_json}]`)
        return Object.fromEntries(this.val_fields.map((field, i) => [field, vector[i]]))
    }

    decode_object(key, val) {
        /* Key & value fully decoded, then merged into an object that resembles original web object ("pseudo-object"). */
        return {...this.decode_key_object(key), ...this.decode_value(val)}
    }
}

/**********************************************************************************************************************/

export class DataSchema extends RecordSchema {

    constructor() {
        super(new Map([['id', new INTEGER()]]))
    }

    encode_id(id) {
        assert(id !== undefined)
        return this.encode_key([id])
    }

    decode_id(key) {
        return this.decode_key(key)[0]
    }
}

// schema of the data sequence in every DB ring; value encoding is handled outside schema, through method overloading
export const data_schema = new DataSchema()

