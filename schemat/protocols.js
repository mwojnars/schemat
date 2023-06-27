import { print, assert, T } from "./utils.js"
import { NotFound, RequestFailed } from './errors.js'
import { JSONx } from './serialize.js'


export class Protocol {
    /* Client/server communication protocol for "network objects", i.e., objects that are instantiated both on the server
       side and on the client side - exposing THE SAME API (methods) in both environments - that need to communicate
       transparently between their "client" and "server" copies while providing an appropriate (different) internal
       implementation depending on whether they are called on the server or on the client.
       A Protocol may also be used to define an object's EXTERNAL API that will be accessible to human users
       or other remote objects over the network.

       Typically, a Protocol is linked to an Item object, but it may also be used for
       other JS objects that need to communicate with their own dual instances over the network.

       A protocol is linked to every web endpoint and performs one of the predefined 1+ actions
       through the serve() method when a network request arrives. The protocol may also consist
       of remote() implementation that performs RPC calls from a client to the server-side serve() method.
       Each action function is executed in the context of an agent (`this` is set to the agent object).

       A function ("service") that gets called when a request arrives at a given network `endpoint`.
       A protocol can be instantiated on the server side or client side, and it provides methods for
       either executing this command server-side (execute()) or submitting a remote RPC request from a client.

       A Protocol is a function ("service") that is called when a request arrives at a given network `endpoint`.
       The service can also be called directly on the server side, in which case the `ctx` argument is {}.

       plus a few methods to execute this command server-side or to submit a remote RPC request from a client.
       Protocol classes can be instantiated on the server side or client side.
     */

    endpoint        // the endpoint (string) where this protocol instance is bound to; typically has the form of
                    // "METHOD/name", where METHOD is one of GET/POST/CALL/KAFKA...; the name may be a command name,
                    // a Kafka topic name, etc.

    service         // a function, f(ctx, ...args), to be called when the protocol is invoked;
                    // inside the call, `this` is bound to the owner object of the protocol (!), so the function behaves
                    // like a method of the owner; `ctx` is a RequestContext, or {} in the case when an action
                    // is called directly on the server through item.action.XXX() which invokes protocol.execute()
                    // instead of protocol.serve()

    opts = {}           // configuration options of this protocol instance
    static opts = {}    // default values of configuration options


    get endpoint_method() { return this._splitEndpoint()[0] }       // access method of the endpoint: GET/POST/CALL/...
    get endpoint_name()   { return this._splitEndpoint()[1] }       // name of the endpoint (function/action to execute)

    constructor(service = null, opts = {}) {
        this.service = service
        this.opts = {...this.constructor.opts, ...opts}
    }

    bindAt(endpoint) { this.endpoint = endpoint }

    _splitEndpoint() {
        assert(this.endpoint, this.endpoint)
        let parts = this.endpoint.split('/')
        if (parts.length !== 2) throw new Error(`incorrect endpoint format for a protocol: ${this.endpoint}`)
        return parts
    }

    merge(protocol) {
        /* Create a protocol that combines this one and `protocol`. By default, `protocol` is returned unchanged,
           so that redefining a protocol in a subclass means *overriding* the previous protocol with a new one (no merging).
         */
        return protocol
    }

    // the methods below may return a Promise or be declared as async in subclasses...

    remote(agent, action, ...args) {
        /* Subclasses should override remote() method to encode `args` in a protocol-specific way. */
        throw new Error(`client-side call not allowed for this protocol`)
    }

    serve(agent, ctx) {
        /* Subclasses should override serve() method to decode arguments for execute() in a protocol-specific way. */
        throw new Error(`missing server-side implementation for the protocol, serve()`)
    }

    execute(agent, ctx, ...args) {
        /* The actual execution of the service function, server-side, without pre- & post-processing of web requests/responses.
           Here, `ctx` can be empty {}, so execute() can be called directly *outside* of web request context,
           if only the service function supports this.
         */
        return this.service.call(agent, ctx, ...args)
    }
}

export class InternalProtocol extends Protocol {
    /* Protocol for CALL endpoints that handle URL-requests defined as SUN routing paths,
       but executed server-side (exclusively).
     */
    serve(agent, ctx)  { return this.execute(agent, ctx) }
}

export class HttpProtocol extends Protocol {
    /* General-purpose HTTP protocol. Does not interpret input/output data in any way; the action function
       uses `req` and `res` objects directly, and it is also responsible for error handling.
       remote() returns response body as a raw string. This protocol only accepts one action per endpoint.
     */
    _decodeError(res)   { throw new RequestFailed({code: res.status, message: res.statusText}) }

    async remote(agent, action, ...args) {
        let url = agent.url(this.endpoint_name)
        let res = await fetch(url)                  // client-side JS Response object
        if (!res.ok) return this._decodeError(res)
        return res.text()
    }
    serve(agent, ctx)  { return this.execute(agent, ctx) }
}


/**********************************************************************************************************************/

export class HtmlPage extends HttpProtocol {
    /* Sends an HTML page in response to a browser-invoked web request. No internal calls via remote().
       The page can be built out of separate strings/functions for: title, assets, meta, body, component (React) etc...
     */
}

export class ReactPage extends HtmlPage {
    /* Sends a React-based HTML page whose main content is implemented as a React component. Allows server-side rendering (SSR). */
}

/*************************************************************************************************/

export class JsonProtocol extends HttpProtocol {
    /* JSON-based communication over HTTP POST. A single action is linked to the endpoint.
       Both the arguments of an RPC call and its result are encoded through JSON.
       The standard JSON object is used here, *not* JSONx, so if you expect to transfer more complex Schemat-native
       objects as arguments or results, you should perform JSONx.encode/decode() before and after the call.
     */

    static opts = {
        encodeArgs:   true,         // if true, the arguments of RPC calls are auto-encoded via JSONx before sending
        encodeResult: false,        // if true, the results of RPC calls are auto-encoded via JSONx before sending
    }

    async remote(agent, ...args) {
        /* Client-side remote call (RPC) that sends a request to the server to execute an action server-side. */
        let url = agent.url(this.endpoint_name)
        let res = await this._fetch(url, args, this.endpoint_method)        // client-side JS Response object
        if (!res.ok) return this._decodeError(res)

        let result = await res.text()                           // json string or empty
        if (!result) return

        result = JSON.parse(result)
        if (this.opts.encodeResult) result = JSONx.decode(result)
        return result
    }

    async _fetch(url, args, method = 'POST') {
        /* Fetch the `url` while including the `args` (if any) in the request body, json-encoded.
           For GET requests, `args` must be missing (undefined), as we don't allow body in GET.
         */
        let params = {method, headers: {}}
        if (args !== undefined) {
            if (method === 'GET') throw new Error(`HTTP GET not allowed with non-empty body, url=${url}`)
            if (this.opts.encodeArgs) args = JSONx.encode(args)
            params.body = JSON.stringify(args)
        }
        return fetch(url, params)
    }

    async _decodeError(res) {
        let error = await res.json()
        throw new RequestFailed({...error, code: res.status})
    }

    async serve(agent, ctx) {
        /* Server-side request handler for execution of an RPC call or a regular web request from a browser.
           The request JSON body should be an object {action, args}; `args` is an array (of arguments),
           or an object, or a primitive value (the single argument); `args` can be an empty array/object, or be missing.
         */
        let {req, res} = ctx        // req: RequestContext
        let out, ex
        try {
            let body = req.body
            // let {req: {body}}  = ctx
            // print(body)

            // the arguments may have already been JSON-parsed by middleware if mimetype=json was set in the request; it can also be {}
            let args = (typeof body === 'string' ? JSON.parse(body) : T.notEmpty(body) ? body : [])
            if (!T.isArray(args)) throw new Error("incorrect format of web request")
            if (this.opts.encodeArgs) args = JSONx.decode(args)

            out = this.execute(agent, ctx, ...args)
            if (out instanceof Promise) out = await out
        }
        catch (e) {ex = e}
        return this._sendResponse(res, out, ex)
    }

    _sendResponse(res, output, error, defaultCode = 500) {
        /* JSON-encode and send the {output} result of action execution, or an {error} details with a proper
           HTTP status code if an exception was caught. */
        res.type('json')
        if (error) {
            res.status(error.code || defaultCode)
            res.send({error})
            throw error
        }
        if (output === undefined) res.end()                             // missing output --> empty response body
        if (this.opts.encodeResult) output = JSONx.encode(output)
        res.send(JSON.stringify(output))
    }
}

export class ActionsProtocol extends JsonProtocol {
    /* JSON-based communication over HTTP POST that handles multiple actions.
       The server interprets req.body as a JSON string of the form {action, args}
       and calls the action indicated by the `action` name. If the function completes correctly, its `result` is sent
       as a JSON-serialized object ; otherwise, if an exception (`error`) was caught,
       it's sent as a JSON-serialized object of the form: {error}.
     */

    actions                 // {name: action_function}, specification of actions handled by this protocol

    constructor(actions = {}, opts = {}) {
        super(null, opts)
        this.actions = actions
    }

    merge(protocol) {
        /* If `protocol` is of the exact same class as self, merge actions of both protocols, otherwise return `protocol`.
           The `opts` in both protocols must be exactly THE SAME, otherwise the actions from one protocol could not
           work properly with the options from another one.
         */

        let c1 = T.getClass(this)
        let c2 = T.getClass(protocol)
        if (c1 !== c2) throw new Error(`overriding ActionsProtocol instance with a different protocol (${c2}) is not allowed`)
        // if (c1 !== c2) return protocol          // `protocol` can be null
        assert(this.endpoint === protocol.endpoint, this.endpoint, protocol.endpoint)

        // check that the options are the same
        let opts1 = JSON.stringify(this.opts)
        let opts2 = JSON.stringify(protocol.opts)
        if (opts1 !== opts2)
            throw new Error(`cannot merge protocols that have different options: ${opts1} != ${opts2}`)

        // create a new protocol instance with `actions` combined; copy the endpoint
        let actions = {...this.actions, ...protocol.actions}
        let opts = {...this.opts, ...protocol.opts}
        let merged = new c1(actions, opts)
        merged.bindAt(this.endpoint)

        return merged
    }

    execute(agent, ctx, action, ...args) {
        let func = this.actions[action]
        if (!func) throw new NotFound(`unknown action: '${action}'`)
        return func.call(agent, ctx, ...args)
    }
}

/**********************************************************************************************************************/

export class API {
    /* Collection of web/network endpoints, each one operating a particular Protocol.
       Some endpoints may be used to define "actions" (i.e., internal RPC calls), but this is configured separately
       when creating a NetworkAgent.
     */

    endpoints = {}      // {METHOD/name: protocol_instance}, where METHOD is an access method (GET/POST/CALL)

    constructor(parents = [], endpoints = {}) {
        // this.environment = environment
        for (let [endpoint, protocol] of Object.entries(endpoints))
            protocol.bindAt(endpoint)
        if (parents && !T.isArray(parents))
            parents = [parents]

        for (let endpts of [...parents.reverse().map(p=>p.endpoints), endpoints])
            this.add(endpts)
    }

    add(endpoints) {
        /* Add `endpoints` dict to `this.endpoints`. If an endpoint already exists its protocol gets merged with the new
           protocol instance (e.g., actions of both protocols are combined), or replaced if a given protocol class
           doesn't implement merge(). If protocol==null in `endpoints`, the endpoint is removed from `this`.
         */
        for (let [endpoint, protocol] of Object.entries(endpoints))
            if (protocol == null) delete this.endpoints[endpoint]
            else {
                let previous = this.endpoints[endpoint]
                this.endpoints[endpoint] = previous ? previous.merge(protocol) : protocol
            }
    }

    resolve(endpoint) {
        /* `endpoint` must be a full endpoint string: method/name. Undefined is returned if not found. */
        return this.endpoints[endpoint]
    }
}

/* action protocols:
   ? how to detect a response was sent already ... response.writableEnded ? res.headersSent ?
*/

/**********************************************************************************************************************/

export class NetworkAgent {
    /* Helper object that performs network communication on behalf of another object (owner, `target`)
       and its remote counterpart. Typically, instantiated as a .net property of the owner, so that the entire
       network-related interface is accessible through a single property and doesn't clutter the owner's JS API.
     */

    static CLIENT = 'client'
    static SERVER = 'server'

    target      // owner (target) object; all the network operations are reflected in the `target` or its remote counterpart
    role        // current network role of the `target`; typically 'client' or 'server'
    api         // network API to be used for the `target`

    constructor(target, role, api) {
        this.target = target
        this.role = role
        this.api = api
    }

    createActions(actions_endpoints) {
        /* Map selected endpoints of the API to "action" functions for the target object, {action: func}.
           `actions_endpoints` is a dict of the form: {action: [endpoint, ...params]},
           where `endpoint` is a full endpoint identifier (incl. access method).
         */
        let actions = {}
        let target = this.target
        let serverSide = (this.role === NetworkAgent.SERVER)

        // create a trigger for each action and store in `this.action`
        for (let [name, spec] of Object.entries(actions_endpoints)) {
            if (name in actions) throw new Error(`duplicate action name: '${name}'`)
            // if (typeof spec === 'string') spec = [spec]
            let [endpoint, ...fixed] = spec             // `fixed` are arguments to the call, typically an action name
            let handler = this.resolve(endpoint)
            if (!handler) throw new Error(`undeclared API endpoint: '${endpoint}'`)

            actions[name] = serverSide
                ? (...args) => handler.execute(target, {}, ...fixed, ...args)     // may return a Promise
                : (...args) => handler.remote(target, ...fixed, ...args)          // may return a Promise
        }
        // print('this.action:', this.action)

        return actions
    }

    resolve(endpoint) {
        /* Resolve `endpoint` to a Protocol instance (a handler). Return undefined if `endpoint` not found. */
        return this.api.resolve(endpoint)
    }
}

// export class NetworkObject {   // RemoteObject NetObject Agent
//     /* Base class for objects ("agents") that expose an API for external and/or internal calls.
//
//        In an "internal call" scenario, the agent is instantiated client-side and server-side, providing the same
//        programming interface (action.*) in each of these environments, but always executing the actions on the server:
//        actions triggered on a client get redirected to the server, execute there, and the result is communicated
//        back to the client.
//
//        In an "external call" scenario, a request is initiated by a third party (typically, a user browser) and is
//        sent directly to the server. A client-side instance of the agent is not needed then.
//
//        The API of an agent may handle user requests (HTML) and machine requests (REST) alike.
//      */
//
//     static _api     // API instance that defines this agent's endpoints, actions, and protocols (for each endpoint)
//     _role           // 'client' or 'server'
//
//     constructor(role = 'client') {
//         this._role = role
//     }
//
//     /* Instantiate a client-side variant of this agent. Remote methods will make RPC calls to the server() object. */
//     static client(...args) { return new this('client', ...args) }
//     static server(...args) { return new this('server', ...args) }
//
//     _rpc(endpoint, ...args) {
//         let protocol = this.constructor._api.get(endpoint)
//         if (this._side === 'client')
//             return protocol.remote(this, ...args)
//         return protocol.execute(this, {}, ...args)
//     }
//
//     _getAgentRole() {
//         /* Override in subclasses to return the name of the current environment: "client" or "server". */
//         throw new Error("not implemented")
//     }
//     _getAgentParents() {
//         /* Override in subclasses to return a list of agents this one directly inherits from. */
//         throw new Error("not implemented")
//     }
//
//     // setAgentAPI(api) {
//     //     /* `api` can be an API instance, or a collection {...} of endpoints to be passed to the new API(). */
//     //     if (!(api instanceof API)) api = new API(api, this._getAgentEnvironment())
//     //     this.api = api
//     //     this.action = this.api.getTriggers(this)
//     // }
//
//     url(endpoint) {}
//
// }

// item = ItemClass.client()
// item = ItemClass.server()
