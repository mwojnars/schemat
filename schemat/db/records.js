/*
    Low-level representation of items and index records, for storage and transmission from/to the database.
    Instances of Record, ItemRecord, ChangeRequest - should be used as IMMUTABLE objects, i.e., once created,
    they should not be modified (except for lazy internal calculation of missing derived fields).
 */

import {assert, print, T} from "../utils.js";
import {JSONx} from "../serialize.js";
import {BinaryInput, BinaryOutput, compareUint8Arrays, fnv1aHash} from "../util/binary.js";
import {Data} from "../data.js";


// EMPTY token marks an empty value in a record
export const EMPTY = Symbol.for('empty')


/**********************************************************************************************************************/

export class Record {

    schema                  // SequenceSchema of the parent Sequence of this record

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
        let names = this.schema.field_names
        let key = this.key
        let obj = {}
        for (let i = 0; i < names.length; i++) obj[names[i]] = key[i]
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
        return compareUint8Arrays(rec1.binary_key, rec2.binary_key)
    }

    constructor(schema, plain = null, binary = null) {
        assert(schema instanceof SequenceSchema)
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
        // if (!(this._data_object instanceof Data)) assert(false)
        // return this._data_object
    }
    
    _parse_data() {
        return this._data_plain = JSON.parse(this._data_json)
        // if(!(JSONx.decode(this._data_plain) instanceof Data)) assert(false)
        // return this._data_plain
    }
    
    _stringify_data() {
        return this._data_json = JSON.stringify(this.data_plain)
    }

    _encode_data() {
        return this._data_plain = JSONx.encode(this._data_object)
        // if(!(JSONx.decode(this._data_plain) instanceof Data)) assert(false)
        // return this._data_plain
    }

    encoded() {
        // if(!(JSONx.decode(this.data_plain) instanceof Data)) assert(false)
        assert(this.id !== undefined, `missing 'id' in ItemRecord.encoded(), data=${this.data_plain}`)
        return {id: this.id, data: this.data_plain}
    }

    stringified() {
        return {id: this.id, data: this.data_json}
    }

    static from_binary(binary_record /*Record*/) {
        /* Create an ItemRecord from a binary Record, where key = [id] and value is a JSONx-serialized Data object. */
        assert(binary_record instanceof Record, `invalid binary_record: ${binary_record}, should be a Record`)
        let json = binary_record.string_value       // plain object, JSONx-encoded Data of an item
        let key = binary_record.key                 // array of key fields, decoded
        assert(key.length === 1)                    // key should be a single field, the item ID - that's how it's stored in a data sequence in the DB
        let id = key[0]
        return new ItemRecord(id, json)
    }

    constructor(id, data) {
        /* `id` is a Number; `data` is either a JSONx string, or a Data object. */
        this.id = id
        assert(data, `missing 'data' for ItemRecord, id=${id}`)

        if (typeof data === 'string') this._data_json = data
        else if (data instanceof Data) this._data_object = data
        else
            assert(false, `plain data objects not accepted for ItemRecord, id=${id}: ${data}`)
            // for now, it's not needed to accept plain objects as data - this can change later

        // else {
        //     assert(JSONx.decode(data) instanceof Data, `invalid 'data' for ItemRecord, id=${id}: ${data}`)
        //     this._data_plain = data
        // }
    }
}

/**********************************************************************************************************************/

export class ChangeRequest {
    /* Data change in a binary record of a Sequence, to be propagated to derived sequences.
       `key` should be a Uint8Array; `value_*` should be json strings.
       For value_old and value_new, null means the corresponding old/new record is missing  (which represents
       insertion or deletion), and empty string (or undefined) means the record exists, but its value is empty.
     */

    key                 // binary key (Uint8Array)
    value_old           // null if missing record (insertion); undefined if empty value, but record exists (update)
    value_new           // null if missing record (deletion); undefined if empty value, but record exists (update)

    record_old(schema)  { return this.value_old !== null && new BinaryRecord(schema, this.key, this.value_old) }
    record_new(schema)  { return this.value_new !== null && new BinaryRecord(schema, this.key, this.value_new) }

    constructor(key, value_old = null, value_new = null) {
        this.key = key
        this.value_old = value_old
        this.value_new = value_new
    }
}

/**********************************************************************************************************************/

export class SequenceSchema {
    /* Schema of a Sequence: defines the sequence's key and value. */

    fields              // {name: type}, a Map of names and Types of fields to be included in the sequence's key
    properties          // array of property names to be included in the value object (for repeated props of an item, only the first value is included)

    _field_names        // array of names of consecutive fields in the key
    _field_types        // array of Types of consecutive fields in the key

    get field_names()   { return this._field_names || (this._field_names = [...this.fields.keys()]) }
    get field_types()   { return this._field_types || (this._field_types = [...this.fields.values()]) }

    constructor(fields, properties = []) {
        this.fields = fields
        this.properties = properties
    }

    empty_value()       { return !this.properties?.length }

    encode_key(key) {
        /* `key` is an array of field values. The array can be shorter than this.field_types ("partial key")
           - this may happen when a key is used for a partial match as a lower/upper bound in a scan() operation.
         */
        let types  = this.field_types
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
        let types  = this.field_types
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