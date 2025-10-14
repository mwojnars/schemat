import {print, assert, splitLast} from "../common/utils.js";
import {RecentObjects} from "../common/structs.js";

const stream = await server_import('node:stream')

/**********************************************************************************************************************/

export class WebRequest {   // WebConnection (conn)
    /* Schemat's own representation of a web request (or internal request), plus context information
       that may evolve during the routing procedure.
     */
    static SEP_ENDPOINT = '::'          // separator of endpoint name within a URL path

    request         // instance of standard Request (Fetch API)
    req             // Express's request (req) object
    res             // Express's response (res) object

    target          // target web object (recipient of the request)
    endpoint        // full name of the network endpoint that should handle the request (e.g., "GET.json")
    protocol        // endpoint type: LOCAL, GET, POST, ... (SOCK in the future)

    url             // complete URL, with protocol, domain name and ?x=y query string
    path            // URL path with trailing ::endpoint removed
    query           // plain object containing a property for each query string parameter (?x=y) of the original URL
    endpoints = []  // candidate endpoints that should be tried if `endpoint` is not yet decided; the first one that's present in the `target` is used, or 'default' if empty

    // TODO add after Svelte's RequestEvent:
    // params: Record<string, string>
    // cookies: {get, set, delete, serialize}
    // locals: App.Locals   (auth/session info)
    // fetch    (function to fetch other endpoints (respects hooks, credentials)

    // TODO add after Express API:
    // send()
    // status()

    constructor({path, req, res}) {
        if (req) this._from_express(req, res)
        if (path) this.path = path      // this is used by LOCAL calls (import_global(), app.route_local())
        this._set_path(this.path)
    }

    _from_express(req, res) {
        this.req = req
        this.res = res

        this.url = `${req.protocol}://${req.get('host')}${req.originalUrl}`  // req.url does NOT contain protocol & domain
        this.path = req.path
        this.query = req.query

        this.protocol =
            !this.req                   ? "LOCAL" :     // LOCAL = internal call through Application.route_local()
            this.req.method === 'GET'   ? "GET"  :      // GET  = read access through HTTP GET
                                          "POST"        // POST = write access through HTTP POST

        // create a standard Request object (this.request) from `req`
        if (SERVER)
            this.request = new Request(this.url, {
                method: req.method,
                headers: req.headers,
                duplex: 'half',
                body: ['GET', 'HEAD'].includes(req.method)
                    ? undefined
                    : typeof req.body === 'string' ? req.body
                    : stream.Readable.toWeb(req)        // convert Node stream to Web ReadableStream
            })
    }

    _from_request(request) {
        /* Initialization based on standard Request object (Fetch API). */
        this.request = request
        this.url = request.url
        let _url = new URL(request.url)
        this.query = Object.fromEntries(_url.searchParams.entries())
    }

    _set_path(path) {
        /* Set this.path by removing ::endpoint from `path`; this.endpoints may get extended. */
        let endp, sep = WebRequest.SEP_ENDPOINT;
        [this.path, endp] = path.includes(sep) ? splitLast(path, sep) : [path, '']

        // in Express, the web path always starts with at least one character, '/', even if the URL contains a domain alone;
        // this leading-trailing slash has to be truncated for correct segmentation and detection of empty path
        if (this.path === '/') this.path = ''
        this._push(sep + endp)
    }

    _push(...endpoints) {
        /* Append names to this.endpoints. Each name must start with '::' for easier detection of endpoint names
           in a source code - this prefix is truncated when appended to this.endpoints.
         */
        for (let endpoint of endpoints) {
            let m = this._prepare(endpoint)
            if (m && !this.endpoints.includes(m)) this.endpoints.push(m)
        }
    }

    _prepare(endpoint) {
        if (!endpoint) return endpoint
        let sep = WebRequest.SEP_ENDPOINT
        assert(endpoint.startsWith(sep), `endpoint must start with '${sep}' (${endpoint})`)
        return endpoint.slice(sep.length)
    }

    set_target(target) { this.target = target }
    set_endpoint(endpoint) { this.endpoint = endpoint }
}


/**********************************************************************************************************************/

export class WebContext {
    /* Context information and seed web objects related to a particular web request; embedded in HTML response
       and sent back implicitly to the client to enable boot up of a client-side Schemat.
       The objects are flattened (state-encoded), but not yet stringified.
     */
    app             // ID of the application object
    target          // ID of the requested object (target of the web request)
    objects         // client-side bootstrap objects: included in HTML, preloaded before the page rendering begins (no extra communication to load each object separately)
    endpoint        // full name of the target's endpoint that was requested, like "GET.admin"

    static from_request(request, ...objects) {
        /* For use on the server. Optional `objects` are included in the context as seed objects together
           with `target`, `app` and `app.global` objects.
         */
        let ctx = new WebContext()
        let app = schemat.app
        let target = request.target

        let items = new RecentObjects()
        let queue = [target, app, ...app.global?.values() || [], ...objects].filter(Boolean)
        
        // extend the `items` set with all objects that are referenced from the `target` and `app` via __category, __extend or __container
        // TODO: deduplicate IDs when repeated by different object instances (e.g., this happens for the root category)
        while (queue.length) {
            let obj = queue.pop()
            if (!obj || items.hasNewer(obj)) continue
            obj.assert_loaded()

            items.add(obj)
            queue.push(...obj.__category$)
            queue.push(...obj.__prototype$)
            queue.push(obj.__container)
        }
        items = [...items]

        ctx.objects = items.map(obj => obj.__record)
        ctx.app = app.id
        ctx.target = target.id
        ctx.endpoint = request.endpoint
        return ctx
    }

    static from_element(selector) {
        /* For use on the client. Extract text contents of the DOM element pointed to by a CSS `selector` and decode back into WebContext. */
        let node = document.querySelector(selector)
        return this.decode(node.textContent)
    }

    encode() {
        /* Encoding into JSON+base64 string. */
        return btoa(encodeURIComponent(JSON.stringify(this)))
    }

    static decode(text) {
        let state = JSON.parse(decodeURIComponent(atob(text)))
        return Object.assign(new WebContext(), state)
    }
}


