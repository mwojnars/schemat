import {print, assert, T, isPromise} from "../common/utils.js"
import {mJsonError, mJsonObject, mJsonObjects, mString} from "./messages.js";


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

    opts = {
        server: null,   // a function, f(request, ...args), to be called on the server when the protocol is invoked;
                        // inside the call, `this` is bound to a supplied "target" object, so the function behaves
                        // like a method of the "target"; `request` is a Request, or {} if called directly on the server
        accept: null,   // client-side postprocessing function, f(result), called after the result is decoded from web response
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


    get endpoint_type()   { return this._splitEndpoint()[0] }       // access method of the endpoint: GET/POST/CALL/...
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
           Here, `request` can be null, so server() can be called directly *outside* of a web request, if only the service supports this.
         */
        let {server} = this.opts
        if (!server) throw new Error('missing `server()` function in service definition')
        return server.call(target, request, ...args)
    }
}


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
        if (!response.ok) return this.error.decode_error(result, response.status)

        result = this.output.decode(result)
        return this.opts.accept ? this.opts.accept(result) : result
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


/**********************************************************************************************************************/

// export class InternalService extends Service {
//     /* A service that can only be used on CALL endpoints, i.e., on internal endpoints that handle local URL-requests
//        defined as SUN routing paths but executed server-side exclusively.
//      */
//     handle(target, request)  { return this.server(target, request) }
// }

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
//      */
