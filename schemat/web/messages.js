import {assert, T} from "../common/utils.js";
import {RequestFailed} from "../common/errors.js";
import {JSONx} from "../common/jsonx.js";
import {Catalog} from "../core/catalog.js";


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
    encode_error(error)     { let {name, message} = error; return [JSON.stringify({error: {name, message}}), error.code || 500] }
    decode_error(msg, code) { throw new RequestFailed({...JSON.parse(msg).error, code}) }
}

export class mJsonxError extends mJsonBase {
    encode_error(error)     { return [JSONx.stringify({error}), error.code || 500] }
    decode_error(msg, code) { throw JSONx.parse(msg).error }
}


export class mJson extends mJsonError {
    /* Encode one, but arbitrary, object through JSON.stringify(). */
    encode(obj)     { return JSON.stringify(obj) }
    decode(message) { return JSON.parse(message) }
}

export class mJsonArray extends mJsonError {
    /* Encode an array of values (arguments) through JSON.stringify(). */
    array = true
    encode(...objs) { return JSON.stringify(objs) }
    decode(message) { return JSON.parse(message) }
}

export class mJsonx extends mJsonxError {
    /* Encode one, but arbitrary, object through JSONx.stringify(). */
    encode(obj)     { return JSONx.stringify(obj) }
    decode(message) { return JSONx.parse(message) }
}

export class mJsonxArray extends mJsonxError {
    /* Encode an array of objects through JSONx.stringify(). */
    array = true
    encode(...objs) { return JSONx.stringify(objs) }
    decode(message) { return JSONx.parse(message) }
}

/**********************************************************************************************************************/

export class mData extends MessageEncoder {
    /* Encode: a Catalog, either in its original form, or after __getstate__(), but NOT yet JSONx-encoded.
       Decode: fully parsed and decoded Catalog instance.
     */
    encode(data) {
        if (typeof data === 'string') return data       // already encoded
        return JSONx.stringify(data instanceof Catalog ? data.__getstate__() : data)
    }
    decode(message) {
        let data = JSONx.parse(message)
        return data instanceof Catalog ? data : Catalog.__setstate__(data)
    }
}

export class mDataString extends mData {
    /* Like mData, but no decoding: decode() returns a JSONx string representing the Catalog instance. */
    decode(message) { return message }
}


export class mDataRecord extends MessageEncoder {
    /* Encoded: object of the form {id, data}, where `data` is a stringified or *encoded* (plain-object) representation of a Catalog instance.
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
        // if (!(data instanceof Catalog)) data = Catalog.__setstate__(data)
        // return {id, data}
    }
}

/**********************************************************************************************************************/

export class mWebObjects extends MessageEncoder {
    /* Encodes and decodes an array of web objects, [obj1, obj2, ...], through JSONx.
       After decoding, all records get automatically registered as the newest representations of the corresponding IDs
       and get converted to fully-loaded web objects. However, there's NO guarantee that a particular returned object
       was actually built from `rec.data` received in this particular request (!) - this is because a newer record might
       have arrived in the registry in the meantime while the asynchronous .get_loaded() was running!
     */
    array = true

    encode(objects) { return objects.map(obj => obj?.__record) }
    decode(message) {
        let records = JSON.parse(message)
        return Promise.all(records.map(rec => rec && schemat.register_record(rec) && schemat.get_loaded(rec.id)))
    }
}

