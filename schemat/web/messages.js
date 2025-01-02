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
    decode(msg)     { return msg }
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
    decode_error(msg, code) { throw msg ? new RequestFailed({...JSON.parse(msg).error, code}) : new Error(`Unexpected error`) }
}

export class mJsonxError extends mJsonBase {
    encode_error(error)     { return [JSONx.stringify({error}), error.code || 500] }
    decode_error(msg, code) { throw msg ? JSONx.parse(msg).error : new Error(`Unexpected error`) }
}


export class mJson extends mJsonError {
    /* Encode one, but arbitrary, object through JSON.stringify(). */
    encode(obj)     { return JSON.stringify(obj) }
    decode(msg)     { return msg ? JSON.parse(msg) : undefined }
}

export class mJsonArray extends mJsonError {
    /* Encode an array of values (arguments) through JSON.stringify(). */
    array = true
    encode(...objs) { return JSON.stringify(objs) }
    decode(msg)     { return msg ? JSON.parse(msg) : undefined }
}

export class mJsonx extends mJsonxError {
    /* Encode one, but arbitrary, object through JSONx.stringify(). */
    encode(obj)     { return JSONx.stringify(obj) }
    decode(msg)     { return msg ? JSONx.parse(msg) : undefined }
}

export class mJsonxArray extends mJsonxError {
    /* Encode an array of objects through JSONx.stringify(). */
    array = true
    encode(...objs) { return JSONx.stringify(objs) }
    decode(msg)     { return msg ? JSONx.parse(msg) : undefined }
}

/**********************************************************************************************************************/

export class mData extends MessageEncoder {
    /* Input:  a Catalog, either in its original form, or after __getstate__(), but NOT yet JSONx-encoded.
       Output: fully parsed and decoded Catalog instance.
     */
    encode(data) {
        if (typeof data === 'string') return data       // already encoded
        return JSONx.stringify(data instanceof Catalog ? data.__getstate__() : data)
    }
    decode(msg) {
        let data = JSONx.parse(msg)
        return data instanceof Catalog ? data : Catalog.__setstate__(data)
    }
}

export class mDataString extends mData {
    /* Like mData, but no decoding: decode() returns a JSONx string representing the Catalog instance. */
    decode(msg) { return msg }
}


export class mActionResult extends MessageEncoder {
    /* Result of an insert/update operation, as {id, data} record(s) that were written to DB.
       During decoding, all records are automatically added to the local Registry as the newest representations of their IDs.
       Also, if there is a Transaction object present on the caller, the records are registered with this transaction.

       Input:  record, or array of records, of the form {id, data}, where `data` is a Catalog or its stringified representation.
       Output: record, or array of {id, data} records, where each `data` is JSONx-encoded, but no longer stringified.
     */
    encode(recs) {
        let batch = (recs instanceof Array)
        if (!batch) recs = [recs]
        recs = recs.map(rec => {
            let {id, data} = rec
            if (typeof data === 'string') return JSON.stringify({id, data: JSON.parse(data)})
            return JSONx.stringify({id, data: data.__getstate__()})
        })
        return batch ? `[${recs.join(',')}]` : recs[0]
    }
    decode(msg) {
        if (!msg) return
        let recs = JSON.parse(msg)
        if (recs instanceof Array) recs.map(rec => schemat.register_record(rec))
        else schemat.register_record(recs)
        // schemat.register_modification(recs)
        return recs
    }
}

export class mActionResult__ extends MessageEncoder {
    /* After an action (or transaction) was executed, this encoder transmits {status, result, error, records} encoded with JSONx,
       where `status` is "success" or "error"; `result` is the returned value of the action (missing if undefined);
       `error` is the error message if exception was caught; and `records` is an array of all updated records
       that have been altered (inserted, updated, deleted) during the action. After decoding, the `records` are
       automatically put in the caller's registry and registered with the Transaction object, if present.
     */
    encode(result = undefined) {
        let records = schemat.tx.records
        assert(records?.length)
        records = records.map(({id, data}) => ({id, data: (typeof data === 'string') ? JSON.parse(data) : data.encode()}))
        return JSON.stringify({status: 'success', result, records})
    }
    decode(msg) {
        let {status, result, records} = JSON.parse(msg)
        schemat.register_modification(records)
        return result
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

