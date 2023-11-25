import {print, assert, T} from "./common/utils.js"
import { NotFound, RequestFailed } from './common/errors.js'
import { JSONx } from './serialize.js'


/**********************************************************************************************************************/

export class Service {
    /*
       A Service is any server-side functionality that's exposed on a particular (fixed) `endpoint` of a group
       of objects and can be invoked in a context of a `target` object: directly on the server (with execute()),
       remotely through a web request (that triggers server()), or through an RPC call from a client (client()).

       The service's functionality - represented by a `service` function by default - is called in a context
       of a `target` object (this = target), so the function behaves like a method of this object.
       Typically, two copies of the target object are present: one on the server and another one on the client,
       and they communicate with each other through their corresponding instances of the Service.
       Instead of exposing a single function, `service`, subclasses may implement a more complex protocol and,
       for instance, accept multiple different commands (actions) on the same endpoint.

       The target object is typically an Item (although this is not a strict requirement), and it may change between
       invocations of the Service's methods. Multiple services are usually combined into an API (see the API class)
       that can be linked through Network adapters to a number of different target objects.

       In some cases, during building an API, 2+ services (usually of the same type) may be merged together (merge())
       to create a new service that combines the functionality of the original services.
     */

    endpoint        // the target object's endpoint where this service is exposed; typically, a string of the form
                    // "METHOD/name", where METHOD is one of GET/POST/CALL/KAFKA..., and the name is a command name,
                    // a Kafka topic name, etc.

    target_service  // a function, f(request, ...args), to be called on the server when the protocol is invoked;
                    // inside the call, `this` is bound to a supplied "target" object, so the function behaves
                    // like a method of the "target"; `request` is a RequestContext, or {} in the case when an action
                    // is called directly on the server through item.action.XXX() which invokes execute() instead of server()

    opts = {}           // configuration options
    static opts = {}    // default values of configuration options


    get endpoint_method() { return this._splitEndpoint()[0] }       // access method of the endpoint: GET/POST/CALL/...
    get endpoint_name()   { return this._splitEndpoint()[1] }       // name of the endpoint (function/action to execute)

    constructor(target_service = null, opts = {}) {
        this.target_service = target_service
        this.opts = {...this.constructor.opts, ...opts}
    }

    bindAt(endpoint) { this.endpoint = endpoint }

    _splitEndpoint() {
        assert(this.endpoint, this.endpoint)
        let parts = this.endpoint.split('/')
        if (parts.length !== 2) throw new Error(`incorrect endpoint format: ${this.endpoint}`)
        return parts
    }

    merge(service) {
        /* Create a Service that combines this one and `service`. By default, the new `service` is returned,
           so redefining a service in an API means *overriding* the previous one with a new one (no merging).
         */
        return service
    }

    // the methods below may return a Promise or be declared as async in subclasses...

    client(target, ...args) {
        /* Client-side remote invocation (RPC) of the service through a network request
           to be handled on the server by the server() method (see below).
           Subclasses should override this method to encode arguments in a service-specific way.
         */
        throw new Error(`client-side invocation not allowed for this service`)
    }

    server(target, request) {
        /* Server-side request handler for the execution of an RPC call (from client()) or a regular web request
           (from a browser). Subclasses should override this method to decode arguments in a service-specific way. 
         */
        throw new Error(`no server-side request handler for the service`)
    }

    execute(target, request, ...args) {
        /* The actual execution of the service, server-side, without pre- & post-processing of web requests/responses.
           Here, `request` can be null, so execute() can be called directly *outside* of a web request,
           if only the service supports this.
         */
        return this.target_service.call(target, request, ...args)
    }
}

export class InternalService extends Service {
    /* A service that can only be used on CALL endpoints, i.e., on internal endpoints that handle local URL-requests
       defined as SUN routing paths but executed server-side exclusively.
     */
    server(target, request)  { return this.execute(target, request) }
}

export class HttpService extends Service {
    /* Base class for HTTP-based services. Does not interpret input/output data in any way; the service function
       should use `req` and `res` objects directly, and it is also responsible for error handling.
       client() returns response body as a raw string.
     */
    _decodeError(ret)   { throw new RequestFailed({code: ret.status, message: ret.statusText}) }

    async client(target, ...args) {
        let url = target.url(this.endpoint_name)        // it's assumed the `target` is an Item instance with .url()
        let ret = await fetch(url)                      // client-side JS Response object
        if (!ret.ok) return this._decodeError(ret)
        return ret.text()
    }
    server(target, request)  { return this.execute(target, request) }
}


/*************************************************************************************************/

export class JsonService extends HttpService {
    /* JSON-based communication over HTTP POST: the service function accepts a series of arguments, `args`, that are
       encoded as a JSON array and sent to the server as a POST request body; the result is also encoded as JSON.
       The standard JSON object is used here, *not* JSONx, so if you want to transfer more complex Schemat-native
       objects as arguments or results, you should perform JSONx.encode/decode() before and after the call.
     */

    static opts = {
        encodeArgs:   true,         // if true, the arguments of RPC calls are auto-encoded via JSONx before sending
        encodeResult: false,        // if true, the results of RPC calls are auto-encoded via JSONx before sending
    }

    async client(target, ...args) {
        let url = target.url(this.endpoint_name)
        let ret = await this._fetch(url, args, this.endpoint_method)        // client-side JS Response object
        if (!ret.ok) return this._decodeError(ret)

        let result = await ret.text()                           // json string or empty
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

    async _decodeError(ret) {
        let error = await ret.json()
        throw new RequestFailed({...error, code: ret.status})
    }

    async server(target, request) {
        /* The request body should be empty or contain a JSON array of arguments: [...args]. */
        let {req, res} = request        // Express's request and response objects
        let out, ex
        try {
            let body = req.body
            // let {req: {body}}  = request
            // print(body)

            // the arguments may have already been JSON-parsed by middleware if mimetype=json was set in the request; it can also be {}
            let args = (typeof body === 'string' ? JSON.parse(body) : T.notEmpty(body) ? body : [])
            if (!T.isArray(args)) throw new Error("incorrect format of web request")
            if (this.opts.encodeArgs) args = JSONx.decode(args)

            out = this.execute(target, request, ...args)
            if (T.isPromise(out)) out = await out
        }
        catch (e) {ex = e}
        return this._sendResponse(res, out, ex)
    }

    _sendResponse(res, output, error, defaultCode = 500) {
        /* JSON-encode and send the {output} result of the service execution, or an {error} details with a proper
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

export class Task {
    /* A single task supported by a TaskService, as a collection of three functions that comprise the task.
       Every function below (if present) is called with `this` bound to the target object (an owner of the task).
       The functions can be sync or async.
     */
    // prepare      // client-side function args=prepare(...args) to be called before sending the arguments to the server
    process         // server-side function process(request, ...args) to be called with the arguments received from the client
    finalize        // client-side function finalize(result, ...args) to be called with the result received from the server

    constructor({process, finalize} = {}) {
        // this.prepare = prepare
        this.process = process
        this.finalize = finalize
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

    merge(service) {
        /* If `service` is of the exact same class as self, merge tasks of both services, otherwise return `service`.
           The `opts` in both services must be exactly THE SAME, otherwise the tasks from one service could not
           work properly with the options from another one.
         */

        let c1 = T.getClass(this)
        let c2 = T.getClass(service)
        if (c1 !== c2) throw new Error(`overriding TaskService instance with a different service (${c2}) is not allowed`)
        // if (c1 !== c2) return service          // `service` can be null
        assert(this.endpoint === service.endpoint, this.endpoint, service.endpoint)

        // check that the options are the same
        let opts1 = JSON.stringify(this.opts)
        let opts2 = JSON.stringify(service.opts)
        if (opts1 !== opts2)
            throw new Error(`cannot merge services that have different options: ${opts1} != ${opts2}`)

        // create a new service instance with the tasks combined; copy the endpoint
        let tasks = {...this.tasks, ...service.tasks}
        let opts = {...this.opts, ...service.opts}
        let merged = new c1(tasks, opts)
        merged.bindAt(this.endpoint)

        return merged
    }

    async client(target, ...args) {
        /* Call super.client() with optional pre- and postprocessing of the arguments and the result. */

        let task_name = args[0]
        let task = this.tasks[task_name]
        let {finalize} = (task instanceof Task ? task : {})

        // if (prepare) args = await prepare.call(target, ...args)
        let result = await super.client(target, ...args)
        if (finalize) result = finalize.call(target, result, ...args)

        return result
    }

    execute(target, request, task_name, ...args) {
        let task = this.tasks[task_name]
        if (!task) throw new NotFound(`unknown task name: '${task_name}'`)
        if (task instanceof Task) task = task.process
        return task.call(target, request, ...args)
    }

    // ? how to detect a response was sent already ... response.writableEnded ? res.headersSent ?
}

/**********************************************************************************************************************/

export class API {
    /* A set of Services exposed on particular endpoints. API can be linked to target objects via the Network adapter. */

    services = {}               // {endpoint_string: service_object}

    constructor(parents = [], services = {}) {
        // this.environment = environment
        for (let [endpoint, service] of Object.entries(services))
            service.bindAt(endpoint)
        if (parents && !T.isArray(parents))
            parents = [parents]

        for (let _services of [...parents.reverse().map(p => p.services), services])
            this.add(_services)
    }

    add(services) {
        /* Add `services` dict to `this.services`. If an endpoint already exists its service gets merged with the new
           service instance (e.g., functionality of both services is combined), or replaced if a given service class
           doesn't implement merge(). If service==null in `services`, the endpoint is removed from the API.
         */
        for (let [endpoint, service] of Object.entries(services))
            if (service == null) delete this.services[endpoint]
            else {
                let previous = this.services[endpoint]
                this.services[endpoint] = previous ? previous.merge(service) : service
            }
    }

    resolve(endpoint) {
        /* Return the Service instance that's exposed on a given `endpoint`, or undefined if `endpoint` not found. */
        return this.services[endpoint]
    }
}

/**********************************************************************************************************************/

export class Network {
    /*
       Network interface of a `target` object. Handles incoming communication through resolve(), and outgoing
       communication through action calls: action.*(). The API exposed on the interface is defined by `api`.
       Typically, this class is instantiated as a .net property of the target, so the entire network-related
       functionality is accessible through a single property and doesn't clutter the target's own interface.
       Typically, a Network adapter is created for an Item object, but it may also be used for other JS objects.

       Certain endpoints of the `api` may be used to define "actions", i.e., internal RPC calls, local or remote, that
       can be invoked on a server or client alike using the exact same syntax: net.action.X() - the caller does NOT
       have to check every time whether it plays a role of a client or a server in a given moment, because the action
       automatically chooses the right way to execute itself (locally or remotely), and is properly performed in both cases.
       As such, an action can be viewed as a "network method" of the target object: while a regular method always executes
       locally, a "network method" is smart enough to execute itself remotely if needed, depending on the current
       `role` of the target object. ("Network polimorphism", similar to the "method polimorphism" of regular methods.)

       Note that, while actions are the only way to perform an outgoing (local or remote) communication through the Network
       adapter, incoming communication may originate NOT ONLY from actions (of a Network adapter of this or another node),
       but also from regular web requests initiated by the user's browser, so it still makes sense to have endpoints
       in the API that are not used by any action.

       In the future, multiple APIs may be supported in a single Network adapter, with the target object playing
       different roles (of a client/server) in different APIs, all at the same time. Actions will be defined jointly for all APIs.
     */

    static CLIENT = 'client'
    static SERVER = 'server'

    target      // target (owner) object; all the network operations are reflected in the `target` or its remote counterpart
    role        // current network role of the `target` for the `api`; typically, 'client' or 'server'
    api         // API to be exposed on this network interface

    constructor(target, role, api) {
        this.target = target
        this.role = role
        this.api = api
    }

    createActionTriggers(actions) {
        /* Map selected endpoints of the API to action triggers for the target object and return as {action: trigger}.
           `actions` is a specification of the form: {action-name: [endpoint, ...fixed-args]},
           where `fixed-args` is a list (possibly empty or partial) of the arguments that will be passed
           to the endpoint on each action call; dynamic arguments, if any, will be appended later, during the call.
           Multiple actions may share the same endpoint, typically with different `fixed-args`.
         */
        let triggers = {}
        let target = this.target
        let serverSide = (this.role === Network.SERVER)

        // create a trigger for each action and store in `this.action`
        for (let [name, spec] of Object.entries(actions)) {
            if (name in triggers) throw new Error(`duplicate action name: '${name}'`)
            // if (typeof spec === 'string') spec = [spec]
            let [endpoint, ...fixed] = spec             // `fixed` are arguments to the call, typically an action name
            let service = this.resolve(endpoint)
            if (!service) throw new Error(`undeclared API service: '${endpoint}'`)

            triggers[name] = serverSide
                ? (...args) => service.execute(target, null, ...fixed, ...args)     // may return a Promise
                : (...args) => service.client(target, ...fixed, ...args)            // may return a Promise
        }

        return triggers
    }

    resolve(endpoint) {
        /* Resolve `endpoint` to a Service instance (a handler). Return undefined if `endpoint` not found. */
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
//             return protocol.client(this, ...args)
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
// }
