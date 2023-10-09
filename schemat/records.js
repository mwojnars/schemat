import {JSONx} from "./serialize.js";

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
}
