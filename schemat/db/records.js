/*
    Low-level representation of items and index records, for storage and transmission from/to the database.
 */

import {assert} from "../utils.js";
import {JSONx} from "../serialize.js";

/**********************************************************************************************************************/


export class BinaryRecord {
    key                         // Uint8Array
    value                       // string (JSON), or undefined
}

export class PlainRecord {
    key                         // array of 1+ field values - JS objects or primitives
    value                       // object to be JSON-stringified, or undefined
}

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
