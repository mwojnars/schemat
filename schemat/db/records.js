/*
    Low-level representation of objects and index records, for storage and transmission from/to the database.
 */

import {PLURAL} from "../common/globals.js";
import {assert, print, T} from "../common/utils.js";
import {JSONx} from "../common/jsonx.js";
import {BinaryInput, BinaryOutput, compare_uint8, fnv1aHash} from "../common/binary.js";
import {Catalog} from "../core/catalog.js";
import {INTEGER} from "../types/type.js";


// EMPTY token marks missing payload in a record
const EMPTY = Symbol.for('empty')


/**********************************************************************************************************************/

export class Record {

    schema                  // RecordSchema of the parent Sequence of this record

    _key                    // array of fields decoded from the binary key
    _value                  // object or plain JS value parsed from JSON string, or EMPTY (empty value)

    _binary_key             // `key` encoded as Uint8Array through `schema`
    _object_key             // object representation of the key, as {field: value}
    _string_value           // JSON-stringified `value`, or empty string (when empty value)

    _hash                   // hash computed from _binary_key and _string_value combined

    get key()               { return this._key || (this._key = this.schema.decode_key(this._binary_key)) }
    get value()             { let val = (this._value !== undefined ? this._value : this._decode_value()); return val === EMPTY ? undefined : val }
    get binary_key()        { return this._binary_key || (this._binary_key = this.schema.encode_key(this._key)) }
    get object_key()        { return this._object_key || this._key_to_object() }
    get string_value()      { return this._string_value || this._encode_value() }
    get hash()              { return this._hash || this._compute_hash() }

    _key_to_object() {
        let fields = this.schema.key_fields
        let key = this.key
        let obj = {}

        for (let i = 0; i < fields.length; i++) {
            let field = fields[i]
            if (field.endsWith(PLURAL)) field = field.slice(0, -PLURAL.length)
            obj[field] = key[i]
        }

        return this._object_key = obj
    }

    _encode_value() {
        return this._string_value = (this._value === EMPTY ? '' : JSON.stringify(this._value))
    }

    _decode_value() {
        return this._value = (this._string_value === '' ? EMPTY : JSON.parse(this._string_value))
    }

    _compute_hash() {
        let key = this.binary_key                                   // Uint8Array
        let val = new TextEncoder().encode(this.string_value)       // value string converted to Uint8Array

        // write [length of key] + `key` + `val` into a single Uint8Array
        let offset = 4                                              // 4 bytes for the length of key
        let length = offset + key.length + val.length               // total length of the result
        let result = new Uint8Array(length)

        // write key.length into the first 4 bytes of result
        result[0] = (key.length >> 24) & 0xFF
        result[1] = (key.length >> 16) & 0xFF
        result[2] = (key.length >>  8) & 0xFF
        result[3] =  key.length        & 0xFF

        // append key and val to result
        result.set(key, offset)
        result.set(val, offset + key.length)

        return this._hash = fnv1aHash(result)
    }

    static compare(rec1, rec2) {
        /* Compare two records by their binary keys (byte order). */
        return compare_uint8(rec1.binary_key, rec2.binary_key)
    }

    constructor(schema, plain = null, binary = null) {
        assert(schema instanceof RecordSchema)
        this.schema = schema

        if (plain) {
            this._key = plain.key
            this._value = (plain.value === undefined ? EMPTY : plain.value)
            assert(T.isArray(this._key), `invalid key: ${this._key}`)
        }
        if (binary) {
            this._binary_key = binary.key
            this._string_value = binary.value
            assert(this._binary_key instanceof Uint8Array, `expected a binary key in record, got ${this._binary_key}`)
            assert(typeof this._string_value === 'string', `expected a string value in record, got: ${this._string_value}`)
        }
    }

    static binary(schema, key, value)   { return new Record(schema, null, {key, value}) }
    static plain(schema, key, value)    { return new Record(schema, {key, value}, null) }

    decode_object() {
        /* Create an {id, data} object from this binary record, where [id]=key and `data` is decoded from the record's value.
           It is assumed that this record actually represents a web object, with key=[id] and value=json_data.
         */
        let key = this.key                      // array of key fields, decoded
        assert(key.length === 1)                // key should be a single field, the item ID - that's how it's stored in a data sequence in the DB
        let id = key[0]

        let json = this.string_value            // JSONx-serialized content of an object
        let data = JSONx.parse(json)
        if (T.isPOJO(data)) data = Catalog.__setstate__(data)

        return {id, data}
    }
}


/**********************************************************************************************************************/

export class RecordSchema {
    /* Schema of records in a Sequence. Defines the key and value to be stored in records. */

    key                 // {name: type}, a Map of names and Types of fields to be included in the sequence's key
    payload             // array of property names to be included in the value object (for repeated props of an item, only the first value is included)

    _key_fields         // array of names of consecutive fields in the key
    _key_types          // array of Types of consecutive fields in the key

    get key_fields()    { return this._key_fields || (this._key_fields = [...this.key.keys()]) }
    get key_types()     { return this._key_types || (this._key_types = [...this.key.values()]) }

    constructor(key, payload = []) {
        assert(key?.size > 0, `key is empty`)
        this.key = key
        this.payload = payload || []
    }

    has_payload() { return !!this.payload?.length }     // true if payload part is present in records

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

    decode_key(binary_key) {
        /* Decode a `binary_key` (Uint8Array) back into an array of field values. Partial keys are NOT supported here. */
        let types  = this.key_types
        let input  = new BinaryInput(binary_key)
        let length = types.length
        let key = []

        for (let i = 0; i < length; i++) {
            const type = types[i]
            const last = (i === length - 1)
            const val  = type.binary_decode(input, last)
            key.push(val)
        }
        assert(input.pos === binary_key.length)

        return key
    }
}


// schema of the data sequence in every DB ring; value encoding is handled outside schema, through method overloading
export const data_schema = new RecordSchema(new Map([['id', new INTEGER()]]))

