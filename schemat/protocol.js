import { print, assert, NotFound, RequestFailed } from "./utils.js"


export class Agent {
    /* An item or any another object that exposes an API through endpoints, actions & protocols. */

    static api          // instance of the API class

    url(endpoint) {}
    execute(action, ctx, ...args) {}
}


export class Protocol {
    /* Client/server communication protocol for a web client or an RPC_Agent object.
       A protocol is linked to every web endpoint and performs one of the predefined 1+ actions
       through the server() method when a web request arrives. The protocol may also consist
       of a client() implemention that performs internal RPC calls to the remote server() method.
     */

    static multipleActions = false      // true if multiple actions per endpoint are allowed

    endpoint                            // name of the endpoint, access mode excluded
    access                              // access mode of the endpoint: GET/POST/CALL

    actions = {}                        // {name: method}, collection of all actions handled by this protocol instance

    constructor(endpoint) {
        assert(endpoint)
        let parts = endpoint.split('/')
        if (parts.length !== 2) throw new Error(`incorrect endpoint: ${endpoint}`)
        this.endpoint = parts[0]
        this.access   = parts[1]
    }

    addAction(name, method, protocolClass) {
        if (name in this.actions)
            throw new Error(`duplicate action definition ('${name}') for a protocol`)
        if (!this.constructor.multipleActions && Object.keys(this.actions).length)
            throw new Error(`cannot add '${name}' action, multiple actions not allowed for this protocol`)
        if (protocolClass !== this.constructor)
            throw new Error(`inconsistent protocol declared for '${name}' and another action on the same endpoint ('${this.endpoint}')`)
        this.actions[name] = method
    }

    _singleActionName() {
        /* Check there's exactly one action and return its name. */
        let actions = Object.keys(this.actions)
        assert(actions.length === 1)
        return actions[0]
    }
    _singleActionMethod() {
        /* Check there's exactly one action and return its function. */
        let methods = Object.values(this.actions)
        assert(methods.length === 1)
        return methods[0]
    }

    // the methods below may return a Promise or be declared as async in subclasses
    client(agent, action, ...args)  { throw new Error(`internal client-side call not allowed for this protocol`) }
    server(agent, ctx)              { throw new Error(`missing server implementation`) }
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
    async server(agent, ctx) {
        let method = this._singleActionMethod()
        return method.call(agent, ctx)
    }
}


/*************************************************************************************************/

export class JsonProtocol extends HttpProtocol {
    /* JSON communication over HTTP POST. The server interprets req.body as a JSON string of the form {action, args}
       and calls the action indicated by the `action` name. If the function completes correctly, its `result` is sent
       as a JSON-serialized object ; otherwise, if an exception (`error`) was caught,
       it's sent as a JSON-serialized object of the form: {error}.
     */
    static multipleActions = true

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
            if (!action) throw new NotFound("missing action name")

            if (args === undefined) args = []
            if (!(args instanceof Array)) args = [args]
            print(req.body)

            let method = this.actions[action]
            if (!method) throw new NotFound(`unknown action: '${action}'`)

            out = method.call(agent, ctx, ...args)
            if (out instanceof Promise) out = await out
        }
        catch (e) {ex = e}
        return this._sendResponse(ctx, out, ex)
    }
}

export class JsonSimpleProtocol extends JsonProtocol {
    /* Single action accepting one argument, or none. */

    _encodeRequest(action, args)    { return args[0] }
    _decodeRequest(body)            { return {action: this._singleActionName(), args: body !== undefined ? [body] : []} }
}

/**********************************************************************************************************************/

export class HtmlPage extends Protocol {
    /* Sends an HTML page in response to a browser-invoked web request. Internal calls not allowed. */
}

export class ReactPage extends HtmlPage {
    /* Generates a React-based HTML page. */
}

/**********************************************************************************************************************/

export function action(...args) {
    /* Takes an RPC action function (method) and decorates it (in place) with parameters:
       - method.endpoint -- endpoint name with access mode, as a string of the form "name/MODE" (MODE is GET/POST/CALL)
       - method.protocol -- subclass of Protocol whose instance will perform the actual client/server communication.
       The `args` may contain (in any order):
       - a string, interpreted as an endpoint in the form "name/MODE", where MODE is GET, POST, or CALL;
       - a protocol class;
       - an access function.
       Only the function is obligatory.
     */
    let endpoint, protocol, method
    for (let arg of args)
        if (typeof arg === 'string')                        endpoint = arg
        else if (arg.prototype instanceof Protocol)         protocol = arg
        else if (typeof arg === 'function')                 method   = arg
        else throw new Error(`incorrect argument: ${arg}`)

    if (!method) throw new Error(`missing action function`)

    if (protocol) method.protocol = protocol
    if (endpoint) method.endpoint = endpoint
    // if (!method.name) method.name = endpoint.replace('/', '_')
    return method
}

/**********************************************************************************************************************/

export class API {
    /* Collection of remote actions exposed on particular web/RPC/API endpoints, each endpoint operating a particular protocol. */

    endpoints = {}      // {name/MODE: protocol_instance}, where MODE is an access method (GET/POST/CALL)

    constructor(actions = {}, {defaultEndpoint = 'action/POST'} = {}) {
        this.defaultEndpoint = defaultEndpoint
        for (let [action, method] of Object.entries(actions))
            this.addAction(action, method)
    }
    addAction(action, method) {
        let endpoint = method.endpoint || this.defaultEndpoint
        let protocol = method.protocol || (endpoint.endsWith('/GET') && HtmlPage) || JsonProtocol
        let handler  = this.endpoints[endpoint] = this.endpoints[endpoint] || new protocol(endpoint)
        handler.addAction(action, method, protocol)
    }

    getTriggers(agent, onServer) {
        /* Convert the endpoints and their actions to internal action triggers (trigger.XYZ()),
           in a way compatible with the current environment (cli/srv).
         */
        let triggers = {}

        for (let handler of Object.values(this.endpoints))
            for (let [action, method] of Object.entries(handler.actions)) {
                if (action in triggers) throw new Error(`duplicate action name: '${action}`)
                triggers[action] = onServer
                    ? (...args) => method.call(agent, {}, ...args)              // may return a Promise
                    : (...args) => handler.client(agent, action, ...args)       // may return a Promise
            }

        return triggers
    }
}