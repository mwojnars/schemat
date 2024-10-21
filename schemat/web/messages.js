import {assert, T} from "../common/utils.js";
import {RequestFailed} from "../common/errors.js";
import {JSONx} from "../core/jsonx.js";
import {Data} from "../core/catalog.js";


/**********************************************************************************************************************/

export class MessageEncoder {
    /* Encoder for an input/output message transmitted between client & server of a service. */

    type                // optional HTTP response type (mime)
    array = false       // if true, the result of decode() must be an Array of arguments for subsequent client/server function;
                        // otherwise, the result of decode(), even if an Array, is treated as a single argument

    encode(...args) {
        /* Convert argument(s) of client-side call to a message (typically, a string) that will be passed to the recipient. */
    }
    decode(message) {
        /* Convert encoded message (string) back to an array of [...arguments] for the server. */
    }

    encode_error(error) {
        return [error.message || 'Internal Error', error.code || 500]
    }
    decode_error(message, code) {
        throw new RequestFailed({message, code})
    }
}

/**********************************************************************************************************************/

export class mString extends MessageEncoder {
    /* No encoding. A plain string (or any object) is passed along unchanged. */
    encode(arg)     { return arg }
    decode(message) { return message }
}

export class mQueryString extends MessageEncoder {
    /* Encoding of a plain object {key:val} into a URL query string. */
    encode(arg)     { assert(!arg || T.isPlain(arg)); return arg }
    decode(msg)     { assert(!msg || T.isPlain(msg)); return msg }
}

/**********************************************************************************************************************/

export class mJsonBase extends MessageEncoder {
    type = 'json'
}

export class mJsonError extends mJsonBase {
    encode_error(error)     { return [JSON.stringify({error}), error.code || 500] }
    decode_error(msg, code) { throw new RequestFailed({...JSON.parse(msg).error, code}) }
}

export class mJsonxError extends mJsonBase {
    encode_error(error)     { return [JSONx.stringify({error}), error.code || 500] }
    decode_error(msg, code) { throw JSONx.parse(msg).error }
}


export class mJsonObject extends mJsonError {
    /* Encode one, but arbitrary, object through JSON.stringify(). */
    encode(obj)     { return JSON.stringify(obj) }
    decode(message) { return JSON.parse(message) }
}

export class mJsonObjects extends mJsonError {
    /* Encode an array of objects through JSON.stringify(). */
    array = true
    encode(...objs) { return JSON.stringify(objs) }
    decode(message) { return JSON.parse(message) }
}

export class mJsonxObject extends mJsonxError {
    /* Encode one, but arbitrary, object through JSONx.stringify(). */
    encode(obj)     { return JSONx.stringify(obj) }
    decode(message) { return JSONx.parse(message) }
}

export class mJsonxObjects extends mJsonxError {
    /* Encode an array of objects through JSONx.stringify(). */
    array = true
    encode(...objs) { return JSONx.stringify(objs) }
    decode(message) { return JSONx.parse(message) }
}

/**********************************************************************************************************************/

export class mData extends MessageEncoder {
    /* Encode: a Data instance, either in its original form, or after __getstate__(), but NOT yet JSONx-encoded.
       Decode: fully parsed and decoded Data instance.
     */
    encode(data) {
        if (typeof data === 'string') return data       // already encoded
        return JSONx.stringify(data instanceof Data ? data.__getstate__() : data)
    }
    decode(message) {
        let data = JSONx.parse(message)
        return data instanceof Data ? data : Data.__setstate__(data)
    }
}

export class mDataString extends mData {
    /* Like mData, but no decoding: decode() returns a JSONx string representing the Data instance. */
    decode(message) { return message }
}


export class mDataRecord extends MessageEncoder {
    /* Encoded: object of the form {id, data}, where `data` is a stringified or *encoded* (plain-object) representation of a Data instance.
       Decoded: {id, data}, where `data` is still JSONx-encoded, but no longer stringified.
       After decoding, the record gets automatically registered as the newest representation of a given ID.
     */
    encode(rec) {
        // if (rec instanceof DataRecord) return JSON.stringify(rec.encoded())
        let {id, data} = rec
        if (typeof data === 'string') return JSON.stringify({id, data: JSON.parse(data)})
        return JSONx.stringify({id, data: data.__getstate__()})
    }
    decode(message) {
        let rec = JSON.parse(message)
        schemat.register_record(rec)
        return rec
        // let {id, data} = JSONx.parse(message)
        // if (!(data instanceof Data)) data = Data.__setstate__(data)
        // return {id, data}
    }
}

export class mDataRecords extends MessageEncoder {
    /* Encoded: array of web objects, [obj1, obj2, ...].
       Decoded: [{id, data},...], where `data` is a JSONx-encoded state of __data, not stringified.
       After decoding, all records get automatically registered as the newest representations of the corresponding IDs.
     */
    array = true

    encode(objects) { return objects.map(obj => obj.self_encode()) }
    decode(message) {
        let records = JSON.parse(message)
        return records.map(rec => schemat.register_record(rec))
    }
}

