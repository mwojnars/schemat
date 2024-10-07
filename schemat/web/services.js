import {print, assert, T, isPromise} from "../common/utils.js"
import { NotFound, RequestFailed } from '../common/errors.js'
import { JSONx } from '../core/jsonx.js'
import {Data} from "../core/data.js";
import {DataRecord} from "../db/records.js";


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

export class mString extends MessageEncoder {
    /* No encoding. A plain string (or any object) is passed along unchanged. */
    encode(arg)     { return arg }
    decode(message) { return message }
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
        if (typeof rec === 'string') assert(false)  //return rec         // already encoded
        if (rec instanceof DataRecord) assert(false)  //return JSON.stringify(rec.encoded())

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


/**********************************************************************************************************************/

export class Protocol {
    /* A pair of functions: client() and server(), that can communicate with each other over the network
       after the server() gets exposed on a particular endpoint - done by creating a Service on top of a Protocol.
     */
}

/**********************************************************************************************************************/

export class Service {
    /*
       A Service is any server-side functionality that's exposed on a particular (fixed) `endpoint` of a group
       of objects and can be invoked in a context of a `target` object: directly on the server (with server()),
       remotely through a web request (that triggers handle()), or through an RPC call from a client (client()).

       The service's functionality - represented by a `service` function by default - is called in a context
       of a `target` object (this = target), so the function behaves like a method of this object.
       Typically, two copies of the target object are present: one on the server and another one on the client,
       and they communicate with each other through their corresponding instances of the Service.
       Instead of exposing a single function, `service`, subclasses may implement a more complex protocol and,
       for instance, accept multiple different commands (actions) on the same endpoint.

       The target object is typically an Item (although this is not a strict requirement), and it may change between
       invocations of the Service's methods. Multiple services are usually combined into an API (see the API class)
       that can be linked through Network adapters to a number of different target objects.
     */

    endpoint            // the target object's endpoint where this service is exposed; a string of the form "PROTOCOL/name",
                        // where PROTOCOL is one of GET/POST/CALL/..., and the name is a service name etc.

    service_function    // a function, f(request, ...args), to be called on the server when the protocol is invoked;
                        // inside the call, `this` is bound to a supplied "target" object, so the function behaves
                        // like a method of the "target"; `request` is a Request, or {} if called directly on the server

    input               // MessageEncoder for input messages (client > server)
    output              // MessageEncoder for output messages (server > client)
    error               // MessageEncoder for error messages (server > client); same as `output` if missing

    static input        // class default for this.input
    static output
    static error


    get endpoint_type()   { return this._splitEndpoint()[0] }       // access method of the endpoint: GET/POST/CALL/...
    get endpoint_name()   { return this._splitEndpoint()[1] }       // name of the endpoint (function/action to execute)

    constructor(service_function = null, opts = {}) {
        this.service_function = service_function
        this._init_encoders(opts)
    }

    _init_encoders(opts) {
        let {input  = this.constructor.input,
             output = this.constructor.output,
             error  = this.constructor.error } = opts
        error = error || output

        this.input  = T.isClass(input)  ? new input()  : input
        this.output = T.isClass(output) ? new output() : output
        this.error  = T.isClass(error)  ? new error()  : error
    }

    bindAt(endpoint) { this.endpoint = endpoint }

    _splitEndpoint() {
        assert(this.endpoint, this.endpoint)
        let parts = this.endpoint.split('/')
        if (parts.length !== 2) throw new Error(`incorrect endpoint format: ${this.endpoint}`)
        return parts
    }

    // the methods below may return a Promise or be declared as async in subclasses...

    client(target, ...args) {
        /* Client-side remote invocation (RPC) of the service through a network request
           to be handled on the server by the handle() method (see below).
           Subclasses should override this method to encode arguments in a service-specific way.
         */
        throw new Error(`client-side invocation not allowed for this service`)
    }

    handle(target, request) {
        /* Server-side request handler that decodes arguments passed from the client(), executes the server(), and sends back the result. */
        throw new Error(`no server-side request handler for the service`)
    }

    server(target, request, ...args) {
        /* The actual execution of the service, server-side, without pre- & post-processing of web requests/responses.
           Here, `request` can be null, so server() can be called directly *outside* of a web request,
           if only the service supports this.
         */
        return this.service_function.call(target, request, ...args)
    }
}


// export class InternalService extends Service {
//     /* A service that can only be used on CALL endpoints, i.e., on internal endpoints that handle local URL-requests
//        defined as SUN routing paths but executed server-side exclusively.
//      */
//     handle(target, request)  { return this.server(target, request) }
// }


export class HttpService extends Service {
    /* Base class for HTTP-based services. Does not interpret input/output data in any way; the service function
       should use `req` and `res` objects directly, and it is also responsible for error handling.
       client() returns response body as a raw string.
     */

    static input  = mJsonObjects   // client submits an array of JSON-encoded objects by default
    static output = mString
    static error  = mJsonError


    async client(target, ...args) {
        let base_url = target.url(this.endpoint_name)       // it's assumed the `target` is an Item instance with .url()
        let message  = this.input.encode(...args)
        let response = await this.submit(base_url, message)
        let result   = await response.text()
        return response.ok ? this.output.decode(result) : this.error.decode_error(result, response.status)
    }

    async submit(url, message) { return fetch(url, {}) }    // `message` not used for now in the HttpService base class

    async handle(target, request) {
        try {
            let args = this.decode_args(target, request)
            let result = this.server(target, request, ...args)
            if (isPromise(result)) result = await result
            return this.send_result(target, request, result, ...args)
        }
        catch (ex) {
            print('ERROR in HttpService.serve():', ex)
            let [msg, code] = this.error.encode_error(ex)
            request.res.status(code).send(msg)
            throw ex
        }
    }

    decode_args(target, request)   { return [] }            // on the server, decode the arguments from the request object

    send_result(target, {res}, result, ...args) {           // on the server, encode the result and send it to the client
        if (this.output.type) res.type(this.output.type)
        if (result === undefined) return res.end()          // missing result --> empty response body
        res.send(this.output.encode(result))
    }
}


/*************************************************************************************************/

export class JsonService extends HttpService {
    /* JSON-based communication over HTTP POST: the service function accepts a series of arguments, `args`, that are
       encoded as a JSON array and sent to the server as a POST request body; the result is also encoded as JSON.
       The standard JSON object is used here, *not* JSONx, so if you want to transfer more complex Schemat-native
       objects as arguments or results, you should perform JSONx.encode/decode() before and after the call.
     */

    static input  = mJsonObjects   // client submits an array of JSON-encoded objects by default
    static output = mJsonObject    // server responds with a single JSON-encoded object by default

    async submit(url, message) {
        let method = this.endpoint_type || 'POST'
        if (message && typeof message !== 'string') message = JSON.stringify(message)
        if (message && method === 'GET') throw new Error(`HTTP GET not allowed with non-empty body`)

        let params = {method, body: message, headers: {}}
        return fetch(url, params)
    }

    decode_args(target, request) {
        /* The request body should be empty or contain a JSON array of arguments: [...args]. */

        let body = request.req.body             // `req` is Express's request object
        assert(typeof body === 'string')

        let args = this.input.decode(body)
        if (!this.input.array) args = [args]

        if (!T.isArray(args)) throw new Error("incorrect format of arguments in the web request")
        return args
    }
}


export class Task {
    /* A single task supported by a TaskService, as a collection of three functions that comprise the task.
       Every function below (if present) is called with `this` bound to the target object (an owner of the task).
       The functions can be sync or async.
     */
    // prepare      // client-side function args=prepare(...args) called before sending the arguments to the server
    process         // server-side function process(request, ...args) called with the arguments received from the client
    encode_result   // server-side function encode_result(result, ...args) called before sending the result to the client
    decode_result   // client-side function decode_result(result, ...args) called with the result received from the server

    constructor({process, encode_result, decode_result} = {}) {
        // this.prepare = prepare
        this.process = process
        this.encode_result = encode_result
        this.decode_result = decode_result
    }
}

export class TaskService extends JsonService {
    /* JSON-based service over HTTP POST that exposes multiple functions ("tasks") on a single endpoint.
       The server interprets req.body as a JSON array of the form [task-name, ...args].
       If the function completes correctly, its `result` is sent as a JSON-serialized object;
       otherwise, if an exception (`error`) occurred, it's sent as a JSON-serialized object of the form: {error}.
       Each task is either a plain function process(request, ...args) to be called on the server, or a Task instance
       if any pre- or postprocessing is needed on the client.
     */

    tasks                 // tasks supported by this service, as {name: function_or_task} pairs

    constructor(tasks = {}, opts = {}) {
        super(null, opts)
        this.tasks = tasks
    }

    async client(target, ...args) {
        /* Call super.client() with optional pre- and postprocessing of the arguments and the result. */

        let task_name = args[0]
        let task = this.tasks[task_name]
        let decode_result = task instanceof Task ? task.decode_result : null

        // if (prepare) args = await prepare.call(target, ...args)
        let result = await super.client(target, ...args)
        if (decode_result) result = decode_result.call(target, result, ...args)

        return result
    }

    server(target, request, task_name, ...args) {
        let task = this.tasks[task_name]
        if (!task) throw new NotFound(`unknown task name: '${task_name}'`)
        let process = task instanceof Task ? task.process : task
        return process.call(target, request, ...args)
    }

    async send_result(target, request, result, task_name, ...args) {
        let task = this.tasks[task_name]
        let encode_result = task instanceof Task ? task.encode_result : null
        if (encode_result) {
            result = encode_result.call(target, result, ...args)
            if (isPromise(result)) result = await result
        }
        return super.send_result(target, request, result, ...args)
    }

    // ? how to detect a response was sent already ... response.writableEnded ? res.headersSent ?
}

/**********************************************************************************************************************/

// export class Network {
//     /*
//        Network interface of a `target` object. Handles incoming communication through resolve(), and outgoing
//        communication through action calls: action.*(). The API exposed on the interface is defined by `api`.
//        Typically, this class is instantiated as a .net property of the target, so the entire network-related
//        functionality is accessible through a single property and doesn't clutter the target's own interface.
//        Typically, a Network adapter is created for an Item object, but it may also be used for other JS objects.
//
//        Certain endpoints of the `api` may be used to define "actions", i.e., internal RPC calls, local or remote, that
//        can be invoked on a server or client alike using the exact same syntax, so the caller does NOT
//        have to check every time whether it plays a role of a client or a server in a given moment, because the action
//        automatically chooses the right way to execute itself (locally or remotely), and is properly performed in both cases.
//        As such, an action can be viewed as a "network method" of the target object: while a regular method always executes
//        locally, a "network method" is smart enough to execute itself remotely if needed, depending on the current
//        `role` of the target object. ("Network polimorphism", similar to the "method polimorphism" of regular methods.)
//
//        Note that, while actions are the only way to perform an outgoing (local or remote) communication through the Network
//        adapter, incoming communication may originate NOT ONLY from actions (of a Network adapter of this or another node),
//        but also from regular web requests initiated by the user's browser, so it still makes sense to have endpoints
//        in the API that are not used by any action.
//
//        In the future, multiple APIs may be supported in a single Network adapter, with the target object playing
//        different roles (of a client/server) in different APIs, all at the same time. Actions will be defined jointly for all APIs.
//      */
//
//     target      // target (owner) object; all the network operations are reflected in the `target` or its remote counterpart
//
//     // trigger functions are created for each endpoint and grouped by endpoint type;
//     // each trigger is internally bound to the target object and may return a Promise;
//     // a trigger function makes a call to the server through the protocol if executed on the client;
//     // or calls the service function directly if executed on the server...
//     //
//     GET  = {}           // {endpoint_name: trigger_function}
//     POST = {}
//     CALL = {}
//     // ... other endpoint types are added dynamically if found in endpoint specification ...
//
//
//     constructor(target, services) {
//         this.target = target
//
//         // create triggers for all endpoints in the API
//         for (let [endpoint, service] of Object.entries(services))
//         {
//             let {type, name} = new Endpoint(endpoint)
//             let triggers = this[type] = this[type] || {}
//             // if (!triggers) throw new Error(`unknown endpoint type: ${type}`)
//
//             if (typeof service === 'function') {
//                 service = {
//                     execute: () => service.call(target),
//                     client:  (request) => service.call(target, request),
//                 }
//                 // service = service.call(target)
//                 // service.bindAt(endpoint)
//             }
//
//             triggers[name] = SERVER
//                 ? (...args) => service.server(target, null, ...args)        // may return a Promise
//                 : (...args) => service.client(target, ...args)              // may return a Promise
//         }
//     }
// }
