/*
    Low-level representation of items and index records, for storage and transmission from/to the database.
    Instances of Record, ItemRecord, Change - should be used as IMMUTABLE objects, i.e., once created,
    they should not be modified (except for lazy internal calculation of missing derived fields).
 */

import {assert, T} from "../utils.js";
import {JSONx} from "../serialize.js";
import {BinaryInput, BinaryOutput, fnv1aHash} from "../util/binary.js";
import {Data} from "../data.js";


// EMPTY token marks an empty value in a record
export const EMPTY = Symbol('empty')


/**********************************************************************************************************************/

export class Record {

    schema                  // array of Types of consecutive fields in the key;
                            // typically, `schema` is taken from the parent Sequence of this record

    _key                    // array of fields decoded from the binary key
    _value                  // object parsed from JSON string, or EMPTY (empty value)

    _binary_key             // `key` encoded as Uint8Array through `schema`
    _string_value           // JSON-stringified `value`, or empty string (when empty value)

    _hash                   // hash computed from _binary_key and _string_value combined

    get key()               { return this._key || this._decode_key() }
    get value()             { let val = (this._value !== undefined ? this._value : this._decode_value()); return val === EMPTY ? undefined : val }
    get binary_key()        { return this._binary_key || this._encode_key() }
    get string_value()      { return this._string_value || this._encode_value() }
    get hash()              { return this._hash || this._compute_hash() }

    _encode_key() {
        let output = new BinaryOutput()
        let length = this.schema.length

        for (let i = 0; i < length; i++) {
            const type = this.schema[i]
            const last = (i === length - 1)
            const bin  = type.binary_encode(this._key[i], last)
            output.write(bin)
        }
        return this._binary_key = output.result()
    }

    _decode_key() {
        let input = new BinaryInput(this._binary_key)
        let length = this.schema.length
        let key = []

        for (let i = 0; i < length; i++) {
            const type = this.schema[i]
            const last = (i === length - 1)
            const val  = type.binary_decode(input, last)
            key.push(val)
        }
        assert(input.pos === this._binary_key.length)

        return this._key = key
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

    constructor(schema, plain = null, binary = null) {
        this.schema = schema
        if (plain) {
            this._key = plain.key
            this._value = (plain.value === undefined ? EMPTY : plain.value)
            assert(T.isArray(this._key), `invalid key: ${this._key}`)
        }
        if (binary) {
            this._binary_key = binary.key
            this._string_value = binary.value
            assert(this._binary_key instanceof Uint8Array, `invalid binary key: ${this._binary_key}`)
            assert(typeof this._string_value === 'string', `invalid string value: ${this._string_value}`)
        }
    }
}

export class BinaryRecord extends Record {
    /* A Record initialized with encoded (binary) data. */

    constructor(schema, key, value)     { super(schema, null, {key, value}) }
}

export class PlainRecord extends Record {
    /* A Record initialized with decoded (plain) data. */

    constructor(schema, key, value)     { super(schema, {key, value}, null) }
}


/**********************************************************************************************************************/

export class ItemRecord {
    /* Raw item as an {id, data} pair, with the data initialized from a JSONx string or a Data object. */

    id                          // item ID; can be undefined (new item, not yet inserted into DB)
    _data_object                // item data as a Data object decoded from _data_plain
    _data_plain                 // item data as a plain JS object parsed form _data_json or encoded from _data_object
    _data_json                  // item data as a JSONx-encoded and JSON-stringified string

    get data() {
        return this._data_object || this._decode_data()
    }

    get data_plain() {
        return this._data_plain || (this._data_json && this._parse_data()) || (this._data_object && this._encode_data())
    }

    get data_json() {
        return this._data_json || this._stringify_data()
    }

    _decode_data() {
        return this._data_object = JSONx.decode(this.data_plain)
    }
    
    _parse_data() {
        return this._data_plain = JSON.parse(this._data_json)
    }
    
    _stringify_data() {
        return this._data_json = JSON.stringify(this.data_plain)
    }

    _encode_data() {
        return this._data_plain = JSONx.encode(this._data_object)
    }

    encoded() {
        return {id: this.id, data: this.data_plain}
    }

    stringified() {
        return {id: this.id, data: this.data_json}
    }

    static from_binary(binary_record /*Record*/) {
        /* Create an ItemRecord from a binary data record, where key = [id], and value is a JSONx-serialized Data object. */
        let json = binary_record.string_value        // plain object, JSONx-encoded Data of an item
        let key = binary_record.key                  // array of key fields, decoded
        let id = key[0]
        return new ItemRecord(id, json)
    }

    constructor(id, data) {
        /* `id` is a Number; `data` is either a JSONx string, or a Data object. */
        this.id = id

        assert(data, `missing 'data' for ItemRecord, id=${id}`)
        if (typeof data === 'string') this._data_json = data
        else this._data_object = data
        // else if (data instanceof Data) this._data_object = data
        // else this._data_plain = data
    }
}

/**********************************************************************************************************************/

export class Change {
    /* Data change in a binary record of a Sequence, to be propagated to derived sequences.
       `key` should be a Uint8Array; `value_*` should be json strings.
       For value_old and value_new, null means the corresponding old/new record is missing  (which represents
       insertion or deletion), and empty string (or undefined) means the record exists, but its value is empty.
     */

    key                 // binary key
    value_old           // null if missing record (insertion); undefined if empty value, but record exists (update)
    value_new           // null if missing record (deletion); undefined if empty value, but record exists (update)

    get record_old()    { return this.value_old === null ? null : {key: this.key, value: this.value_old} }
    get record_new()    { return this.value_new === null ? null : {key: this.key, value: this.value_new} }

    constructor(key, value_old = null, value_new = null) {
        this.key = key
        this.value_old = value_old
        this.value_new = value_new
    }
}

