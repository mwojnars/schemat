import {print, assert, T, isPromise} from "../common/utils.js"
import {mJsonError, mJsonx, mJsonxArray, mQueryString, mString} from "./messages.js";


export function url_query(url, params = {}) {
    let entries = params instanceof Map ? params.entries() : Object.entries(params)
    let query = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
    return query ? url + '?' + query : url
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

       The target object is typically a WebObject (although this is not a strict requirement), and it may change between
       invocations of the Service's methods. Multiple services are usually combined into an API (see the API class)
       that can be linked through Network adapters to a number of different target objects.
     */

    endpoint            // the target object's endpoint where this service is exposed; a string of the form "PROTOCOL.name",
                        // where PROTOCOL is one of GET/POST/LOCAL/..., and the name is a service name

    opts = {
        input:  null,
        output: null,
        server: null,   // a function, f(request, ...args), to be called on the server when the protocol is invoked;
                        // inside the call, `this` is bound to a supplied "target" object, so the function behaves
                        // like a method of the "target"; `request` is a Request, or {} if called directly on the server
        error:  null,
        // accept: null,   // client-side postprocessing function, f(result), called after the result is decoded from web response
        // answer
        // reject
        // regret
    }

    input               // MessageEncoder for input messages (client > server)
    output              // MessageEncoder for output messages (server > client)
    error               // MessageEncoder for error messages (server > client); same as `output` if missing

    static input        // class default for this.input
    static output
    static error


    get endpoint_type()   { return this._splitEndpoint()[0] }       // access method of the endpoint: GET/POST/LOCAL/...
    get endpoint_name()   { return this._splitEndpoint()[1] }       // name of the endpoint (function/action to execute)

    constructor(opts = {}) {
        this.opts = opts
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

    _splitEndpoint() {
        assert(this.endpoint, this.endpoint)
        let parts = this.endpoint.split('.')
        if (parts.length !== 2) throw new Error(`incorrect endpoint format: ${this.endpoint}`)
        return parts
    }

    // the methods below may return a Promise or be declared as async in subclasses...

    invoke(target, endpoint, ...args) {
        /* Isomorphic method to invoke this service on a client or a server, via .client() or .server() respectively.
           If called on a server, passes request=null to this.server() method. May return a Promise.
         */
        this.endpoint = endpoint
        return this._is_local(target)
            ? this.local(target, ...args)
            : this.client(target, ...args)
    }

    async local(target, ...args) {
        /* Call this.server() locally; perform encoding+decoding of the output as would be done during remote execution. */
        let result = this.server(target, undefined, ...args)
        if (isPromise(result)) result = await result

        if (result === undefined) return
        if (!this.output.array) result = [result]

        let msg = this.output.encode(...result)
        return this.output.decode(msg)
    }

    async client(target, ...args) {
        /* Client-side remote invocation (RPC) of the service through a network request
           to be handled on the server by the handle() method (see below).
           Subclasses should override this method to encode arguments in a service-specific way.
         */
        let message  = this.input.encode(...args)
        // let address  = this._address(target, ...args)
        let response = await this._submit(target, message)
        let result   = await this._parse_response(response)
        return this.output.decode(result)
    }

    handle(target, request) {
        /* Server-side request handler that decodes arguments passed from the client(), executes the server(), and sends back the result. */
        throw new Error(`no server-side request handler for the service`)
    }

    server(target, request, ...args) {
        /* The actual execution of the service, server-side, without pre- & post-processing of web requests/responses. */
        let {server} = this.opts
        if (!server) throw new Error('missing `server()` function in service definition')
        return server.call(target, ...args)
    }

    _is_local(target) {
        /* True if `target` is locally accessible and executable on the current machine, which means
           the service invocation should be performed via a local (not remote) call.
         */
        return SERVER       // this works for extra-cluster communication, like in HTTP between clients and servers; must be changed for intra-cluster comm
    }

    // _address(target, ...args) {}
    _submit(target, message)  {}
    _parse_response(response) {}
}


export class HttpService extends Service {
    /* Base class for HTTP-based services. Input encoder should encode arguments into a single plain object
       that will be sent as a URL query string - this behavior can be changed in subclasses.
     */

    static input  = mQueryString
    static output = mString
    static error  = mJsonError

    // _address(target) {
    //     return target.url(this.endpoint_name)      // `target` should be a WebObject with .url()
    // }

    async _submit(target, message) {
        /* `message`, if present, should be a plain object to be encoded into GET query string ?k=v&... */
        let url = target.url(this.endpoint_name)
        if (!T.isEmpty(message)) {
            if (!T.isPlain(message)) throw new Error(`cannot encode as a HTTP GET query string (${message})`)
            url = url_query(url, message)
        }
        return fetch(url, {})
    }

    async _parse_response(response) {
        let result = await response.text()
        return response.ok ? result : this.error.decode_error(result, response.status)
    }

    async handle(target, request) {
        try {
            let msg = this._parse_request(request)
            let args = this._decode_args(msg)
            let result = this.server(target, request, ...args)
            if (isPromise(result)) result = await result
            return this._send_result(target, request, result, ...args)
        }
        catch (ex) {
            let [code, msg] = this.error.encode_error(ex)
            request.res.status(code).send(msg)
            throw ex
        }
    }

    _parse_request(request) {
        return request.req.query                            // plain object carrying all GET query string parameters
    }

    _decode_args(msg) {                                     // on the server, decode the arguments from the request
        let args = this.input.decode(msg)
        if (!this.input.array) args = [args]
        if (!T.isArray(args)) throw new Error("incorrect format of arguments in the web request")
        return args
    }

    _send_result(target, {res}, result, input_args) {       // on the server, encode the result and send it to the client
        if (this.output.type) res.type(this.output.type)
        if (result === undefined) return res.end()          // missing result --> empty response body
        if (!this.output.array) result = [result]
        res.send(this.output.encode(...result))
    }
}


/*************************************************************************************************/

export class JsonGET extends HttpService {
    static output = mJsonx          // server responds with a single JSONx-encoded object by default
}

export class JsonPOST extends HttpService {
    /* JSON-based communication over HTTP POST. By default, the server accepts a series of arguments, `...args`, that are
       encoded through JSONx and sent to the server in POST request body; the result is sent back as JSONx string
       - this can be changed by passing a different `input` or `output` class in the constructor.
     */
    static input  = mJsonxArray     // client submits an ...args array of JSONx-encoded arguments
    static output = mJsonx          // server responds with a single JSONx-encoded object

    async _submit(target, message) {
        let url = target.url(this.endpoint_name)
        if (this.endpoint_type !== 'POST') throw new Error(`JsonPOST can only be exposed at HTTP POST endpoint, not ${this.endpoint}`)
        if (message && typeof message !== 'string') message = JSON.stringify(message)
        let params = {method: 'POST', body: message, headers: {}}
        return fetch(url, params)
    }

    _parse_request(request) {
        /* The request body should be empty or contain a JSON array of arguments: [...args]. */
        let body = request.req.body             // `req` is Express's request object
        assert(typeof body === 'string')
        return body
    }
}

/**********************************************************************************************************************/

// export class Network {
//     /*
//        Network interface of a `target` object. Handles incoming communication through resolve(), and outgoing
//        communication through action calls: ax.*(). The API exposed on the interface is defined by `api`.
//        Typically, this class is instantiated as a .net property of the target, so the entire network-related
//        functionality is accessible through a single property and doesn't clutter the target's own interface.
//        Typically, a Network adapter is created for a WebObject, but it may also be used for other JS objects.
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
//      */
