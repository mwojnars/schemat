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
    /* Item as a {id, data} pair, with the data initialized from a JSONx string or a Data object. */

    id                          // item ID
    _data_object                // item data as a Data object decoded from _data_json
    _data_json                  // item data as a JSONx-encoded string

    get data() {
        return this._data_object || this._decode_data()
    }

    get json() {
        return this._data_json || this._encode_data()
    }

    _decode_data() {
        return this._data_object = JSONx.parse(this._data_json)
    }

    _encode_data() {
        return this._data_json = JSONx.stringify(this._data_object)
    }

    constructor(id, data) {
        /* ItemRecord can be initialized either with a JSON string in `data`, or a Data object. */
        this.id = id

        assert(data, `missing 'data' for ItemRecord, id=${id}`)
        if (typeof data === 'string') this._data_json = data
        else this._data_object = data
    }
}
