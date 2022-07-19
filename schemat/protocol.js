import {fetchJson} from "./react-utils.js";
import {print, assert, ServerError} from "./utils.js";


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
            throw new Error(`inconsistent protocol declared for '${name}' and another action on the same endpoint`)
        this.actions[name] = method
    }

    client(agent, action, ...args)  { throw new Error(`internal client-side call not allowed for this protocol`) }
}

export class GenericProtocol extends Protocol {
    /* General-purpose HTTP protocol. Does not interpret input/output data in any way. The action function is free to use
       `req` and `res` objects as it sees fit. This protocol only accepts one action per endpoint.
     */
}

export class HtmlProtocol extends GenericProtocol {
    /* A protocol that sends web pages in response to browser-invoked web requests. No client() for internal calls. */
}

export class JsonProtocol extends Protocol {
    /* JSON communication over HTTP POST. The server interprets req.body as a JSON string of the form {action, args}
       and calls the action indicated by the `action` name parameter. If the function completes correctly, its `result` is sent
       as a JSON-serialized object of the form {result}; otherwise, if an exception (`error`) was caught,
       it's sent as a JSON-serialized object of the form: {error}.
     */
    static multipleActions = true

    async client(agent, action, ...args) {
        /* Client-side remote call (RPC) that sends a request to the server to execute an action server-side. */
        assert(this.access === 'POST')
        let url = agent.url(this.endpoint)
        let res = await fetchJson(url, {action, args})
        if (!res.ok) throw new ServerError(res)             // res = Response object
        return res.json()
        // let txt = await res.text()
        // return txt ? JSON.parse(txt) : undefined
        // throw new Error(`server error: ${res.status} ${res.statusText}, response ${msg}`)
    }

    async server(agent, ctx) {
        /* Server-side request handler for execution of an RPC call.
           The request JSON body should be an object {action, args}; `args` is an array (of arguments),
           or an object, or a primitive value (the single argument); `args` can be an empty array/object, or be missing.
         */
        let {req, res} = ctx                    // RequestContext
        let {action, args} = req.body
        if (!action) res.error("Missing 'action'")
        if (args === undefined) args = []
        if (!(args instanceof Array)) args = [args]
        print(req.body)

        let method = this.actions[action]
        if (!method) throw new Error(`Unknown action: '${action}'`)
        let out = method.call(agent, ctx, ...args)
        if (out instanceof Promise) out = await out
        return res.json(out || {})
    }
}


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
    if (endpoint) {
        method.endpoint = endpoint
        if (!method.name) method.name = endpoint.replace('/', '_')
    }
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
        print('this.endpoints:', this.endpoints)
    }
    addAction(action, method) {
        let endpoint = method.endpoint || this.defaultEndpoint
        let protocol = method.protocol || (endpoint.endsWith('/GET') && HtmlProtocol) || JsonProtocol
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