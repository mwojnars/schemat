/*
    Low-level representation of items and index records, for storage and transmission from/to the database.
 */

import {assert} from "../utils.js";
import {JSONx} from "../serialize.js";
import {BinaryInput, BinaryOutput} from "../util/binary.js";


/**********************************************************************************************************************/

// EMPTY token marks an empty value in a record
export const EMPTY = Symbol('empty')


export class Record {

    schema                  // array of Types of consecutive fields in the key;
                            // typically, `schema` is taken from the parent Sequence of this record

    _key                    // array of fields decoded from the binary key
    _value                  // object parsed from JSON string, or EMPTY (empty value)

    _binary_key             // `key` encoded as Uint8Array through `schema`
    _string_value           // JSON-stringified `value`, or empty string (when empty value)

    get key()               { return this._key || this._decode_key() }
    get value()             { return this._value !== undefined ? this._value : this._decode_value() }
    get binary_key()        { return this._binary_key || this._encode_key() }
    get string_value()      { return this._string_value || this._encode_value() }

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
}

// export class BinaryRecord {
//     key                         // Uint8Array
//     value                       // string (JSON), or undefined
// }
//
// export class PlainRecord {
//     key                         // array of 1+ field values - JS objects or primitives
//     value                       // object to be JSON-stringified, or undefined
// }

/**********************************************************************************************************************/

export class ItemRecord {
    /* Raw item as an {id, data} pair, with the data initialized from a JSONx string or a Data object. */

    id                          // item ID
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
        // return this._data_object = JSONx.parse(this._data_json)
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

    constructor(id, data) {
        /* ItemRecord can be initialized either with a JSON string `data`, or a Data object. */
        this.id = id

        assert(data, `missing 'data' for ItemRecord, id=${id}`)
        if (typeof data === 'string') this._data_json = data
        else this._data_object = data
    }
}

/**********************************************************************************************************************/

export class Change {
    /* Change of a binary record in a Sequence to be propagated to derived sequences.
       `key` should be a Uint8Array; `value_*` should be json strings.
       For value_old and value_new, null means the corresponding old/new record is missing  (which represents
       insertion or deletion), and empty string (or undefined) means the record exists, but its value is empty.
     */

    key
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

