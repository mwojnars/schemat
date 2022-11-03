import { print, assert, T, NotFound, RequestFailed } from "./utils.js"


// export class Agent {
//     /* Base class for objects that implement client-server communication (API) for external and internal calls.
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
//     api         // API instance that defines this agent's endpoints, actions, and protocols (for each endpoint)
//     action      // action triggers, {name: trigger()}, created from the `api` for this agent instance
//
//     constructor(api = null) {
//         if (api) this.setAgentAPI(api)
//     }
//
//     _getAgentEnvironment() {
//         /* Override in subclasses to return the name of the current environment: "client" or "server". */
//         throw new Error("not implemented")
//     }
//     _getAgentParents() {
//         /* Override in subclasses to return a list of agents this one directly inherits from. */
//         throw new Error("not implemented")
//     }
//
//     setAgentAPI(api) {
//         /* `api` can be an API instance, or a collection {...} of endpoints to be passed to the new API(). */
//         if (!(api instanceof API)) api = new API(api, this._getAgentEnvironment())
//         this.api = api
//         this.action = this.api.getTriggers(this)
//     }
//
//     url(endpoint) {}
// }


export class Protocol {
    /* Client/server communication protocol for a web client or an RPC_Agent object.
       A protocol is linked to every web endpoint and performs one of the predefined 1+ actions
       through the server() method when a web request arrives. The protocol may also consist
       of a client() implemention that performs internal RPC calls to the remote server() method.
       Each action function is executed in the context of an agent (`this` is set to the agent object).
     */

    static multipleActions = false      // true if multiple actions per endpoint are allowed

    address                             // protocol-specific string that identifies the connection; typically,
                                        // a URL endpoint for HTTP protocols, or topic name for Kafka protocols

    endpoint                            // name of the endpoint, access mode excluded
    access                              // access mode of the endpoint: GET/POST/CALL

    actions                             // {name: method}, specification of actions handled by this protocol instance

    get action() {
        /* Check there's exactly one action and return its function. */
        let methods = Object.values(this.actions)
        assert(methods.length === 1)
        return methods[0]
    }

    constructor(action = null) {
        this.actions = action ? {'': action} : {}
    }

    merge(protocol) {
        /* Create a protocol that combines this one and `protocol`. By default, `protocol` is returned unchanged. */
        return protocol
    }

    setEndpoint(endpoint) {
        assert(endpoint)
        let parts = endpoint.split('/')
        if (parts.length !== 2) throw new Error(`incorrect endpoint: ${endpoint}`)
        this.endpoint = parts[0]
        this.access   = parts[1]
    }

    // _singleActionCall(agent, ctx) {
    //     /* Check there's exactly one action and return its function. */
    //     let methods = Object.values(this.actions)
    //     assert(methods.length === 1)
    //     return methods[0].call(agent, ctx)
    // }

    // the methods below may return a Promise or be declared as async in subclasses
    client(agent, action, ...args)  { throw new Error(`client-side internal call not allowed for this protocol`) }
    server(agent, ctx)              { throw new Error(`missing server-side implementation for the protocol`) }
    execute(agent, ctx, ...args)    { throw new Error(`missing server-side execute() implementation for the protocol`) }
        /* The actual execution of an action, without pre- & post-processing of web requests/responses.
           Here, `ctx` can be empty {}, so execute() can be called directly *outside* of web request context,
           if only the corresponding action method supports this.
         */

}

export class InternalProtocol extends Protocol {
    /* Protocol for CALL endpoints that handle URL-requests defined as SUN routing paths,
       but executed server-side (exclusively).
     */
    async server(agent, ctx)    { return this.action.call(agent, ctx) }
}

export class HttpProtocol extends Protocol {
    /* General-purpose HTTP protocol. Does not interpret input/output data in any way; the action function
       uses `req` and `res` objects directly, and it is also responsible for error handling.
       The client() returns response body as a raw string. This protocol only accepts one action per endpoint.
     */
    _decodeError(res)   { throw new RequestFailed({code: res.status, message: res.statusText}) }

    async client(agent, action, ...args) {
        let url = agent.url(this.endpoint)
        let res = await fetch(url)                  // client-side JS Response object
        if (!res.ok) return this._decodeError(res)
        return res.text()
    }
    async server(agent, ctx)    { return this.action.call(agent, ctx) }
}


/**********************************************************************************************************************/

// export class HtmlPage extends HttpProtocol {
//     /* Sends an HTML page in response to a browser-invoked web request. No internal calls via client().
//        The page can be built out of separate strings/functions for: title, assets, meta, body, component (React) etc...
//      */
// }
//
// export class ReactPage extends HtmlPage {
//     /* Sends a React-based HTML page whose main content is implemented as a React component. Allows server-side rendering (SSR). */
// }

/*************************************************************************************************/

export class ActionsProtocol extends HttpProtocol {
    /* JSON-based communication over HTTP POST that handles multiple actions.
       The server interprets req.body as a JSON string of the form {action, args}
       and calls the action indicated by the `action` name. If the function completes correctly, its `result` is sent
       as a JSON-serialized object ; otherwise, if an exception (`error`) was caught,
       it's sent as a JSON-serialized object of the form: {error}.
     */
    static multipleActions = true           // TODO: remove multipleActions

    constructor(actions = {}) {
        super()
        // if (typeof actions === 'function') actions = {'': actions}
        // if (!this.constructor.multipleActions && Object.keys(actions).length >= 2)
        //     throw new Error(`multiple actions not allowed for this protocol`)
        this.actions = actions
    }

    merge(protocol) {
        /* If `protocol` is of the exact same class as self, merge actions of both protocols, otherwise return `protocol`. */

        let c1 = T.getClass(this)
        let c2 = T.getClass(protocol)
        if (c1 !== c2) return protocol          // `protocol` can be null

        // create a new protocol instance with `actions` combined
        let actions = {...this.actions, ...protocol.actions}
        let proto = new c1(actions)

        proto.endpoint = this.endpoint
        proto.access = this.access
        return proto
    }

    _encodeRequest(action, args)    { return {action, args} }
    _decodeRequest(body)            { return typeof body === 'string' ? JSON.parse(body) : body }

    async _fetch(url, data, method = 'POST') {
        /* Fetch the `url` while including the `data` (if any) in the request body, json-encoded.
           For GET requests, `data` must be missing (undefined), as we don't allow body in GET.
         */
        let params = {method, headers: {}}
        if (data !== undefined) {
            if (method === 'GET') throw new Error(`HTTP GET not allowed with non-empty body, url=${url}`)
            params.body = JSON.stringify(data)
        }
        return fetch(url, params)
    }

    _sendResponse({res}, output, error, defaultCode = 500) {
        /* JSON-encode and send the {output} result of action execution, or an {error} details with a proper
           HTTP status code if an exception was caught. */
        res.type('json')
        if (error) {
            res.status(error.code || defaultCode)
            res.send({error})
            throw error
        }
        if (output === undefined) res.end()             // missing output --> empty response body
        res.json(output)
    }
    async _decodeError(res) {
        let error = await res.json()
        throw new RequestFailed({...error, code: res.status})
    }

    async client(agent, action, ...args) {
        /* Client-side remote call (RPC) that sends a request to the server to execute an action server-side. */
        let url  = agent.url(this.endpoint)
        let data = this._encodeRequest(action, args)            // json string
        let res  = await this._fetch(url, data, this.access)    // client-side JS Response object
        if (!res.ok) return this._decodeError(res)
        let out  = await res.text()                             // json string or empty
        if (out) return JSON.parse(out)
    }

    async server(agent, ctx) {
        /* Server-side request handler for execution of an RPC call.
           The request JSON body should be an object {action, args}; `args` is an array (of arguments),
           or an object, or a primitive value (the single argument); `args` can be an empty array/object, or be missing.
         */
        let out, ex
        try {
            let {req} = ctx     // RequestContext
            let body  = req.body ? JSON.parse(req.body) : undefined
            let {action, args} = this._decodeRequest(body)
            if (!action)
                throw new NotFound("missing action name")

            if (args === undefined) args = []
            if (!(args instanceof Array)) args = [args]
            print(req.body)

            out = this.execute(agent, ctx, action, ...args)
            if (out instanceof Promise) out = await out
        }
        catch (e) {ex = e}
        return this._sendResponse(ctx, out, ex)
    }

    execute(agent, ctx, action, ...args) {
        /* The actual execution of an action, without pre- & post-processing of web requests/responses.
           Here, `ctx` can be empty {}, so execute() can be called directly *outside* of web request context,
           if only the corresponding action method supports this.
         */
        let method = this.actions[action]
        if (!method) throw new NotFound(`unknown action: '${action}'`)
        return method.call(agent, ctx, ...args)
    }
}

export class JsonProtocol extends ActionsProtocol {
    /* JSON-based communication over HTTP POST. A single action is linked to the endpoint. */

    _singleActionName() {
        /* Check there's exactly one action and return its name. */
        let actions = Object.keys(this.actions)
        assert(actions.length === 1)
        return actions[0]
    }

    _encodeRequest(action, args)    { return args[0] }
    _decodeRequest(body)            { return {action: this._singleActionName(), args: body !== undefined ? [body] : []} }
}

/**********************************************************************************************************************/

// export function action(...args) {
//     /* Takes an RPC action function (method) and decorates it (in place) with parameters:
//        - method.endpoint -- endpoint name with access mode, as a string of the form "name/MODE" (MODE is GET/POST/CALL)
//        - method.protocol -- subclass of Protocol whose instance will perform the actual client/server communication.
//        The `args` may contain (in any order):
//        - a string, interpreted as an endpoint in the form "name/MODE", where MODE is GET, POST, or CALL;
//        - a protocol class;
//        - an access function.
//        Only the function is obligatory.
//      */
//     let endpoint, protocol, method
//     for (let arg of args)
//         if (typeof arg === 'string')                        endpoint = arg
//         else if (arg.prototype instanceof Protocol)         protocol = arg
//         else if (typeof arg === 'function')                 method   = arg
//         else throw new Error(`incorrect argument: ${arg}`)
//
//     if (!method) throw new Error(`missing action function`)
//
//     if (protocol) method.protocol = protocol
//     if (endpoint) method.endpoint = endpoint
//     // if (!method.name) method.name = endpoint.replace('/', '_')
//     return method
// }

/**********************************************************************************************************************/

export class API {
    /* Collection of remote actions exposed on particular web/RPC/API endpoints, each endpoint operating a particular protocol. */

    // environment      // 'client' or 'server'
    endpoints = {}      // {name/MODE: protocol_instance}, where MODE is an access method (GET/POST/CALL)

    constructor(parents = [], endpoints = {}) {                 // environment = null) {
        // this.environment = environment
        for (let [endpoint, protocol] of Object.entries(endpoints))
            protocol.setEndpoint(endpoint)
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

    get(endpoint) {
        /* `endpoint` is a full endpoint string: mode/name. */
        return this.endpoints[endpoint]
    }

    findHandler(endpoint, httpMethod) {
        return this.endpoints[`${endpoint}/${httpMethod}`]
    }
}

/* action protocols:
   ? how to detect a response was sent already ... response.writableEnded ? res.headersSent ?
*/
