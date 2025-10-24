import {URLNotFound} from "../common/errors.js";
import {print, assert, splitLast} from "../common/utils.js";
import {RecentObjects} from "../common/structs.js";

const stream = SERVER && await import('node:stream')
const {promisify} = SERVER && await import('node:util') || {}

function _sending_done(res) {
    /* Promise that resolves when an Express's response object, `res`, is closed or finished.
       For some send calls on `res`, res.*(), this is the only way to await the actual completion.
     */
    return new Promise(resolve => {
        let done = () => resolve()
        res.once('finish', done)
        res.once('close', done)
    })
}


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
    http_method     // GET, POST, PUT ...

    url             // complete URL, with protocol, domain name and ?x=y query string
    path            // URL path with trailing ::endpoint removed
    query           // plain object containing a property for each query string parameter (?x=y) of the original URL
    endpoints = []  // candidate endpoints that should be tried if `endpoint` is not yet decided; the first one that's present in the `target` is used, or 'default' if empty

    params          // object, {name: value}, containing parameters decoded from the URL in Svelte/Next.js style

    // TODO add after Svelte's RequestEvent:
    // params: Record<string, string>
    // cookies: {get, set, delete, serialize}
    // locals: App.Locals   (auth/session info)
    // fetch    (function to fetch other endpoints (respects hooks, credentials)

    // TODO response generation:
    // send()
    // send_status()
    // send_json()
    // send_header(), send_redirect(), send_file(), send_download(), send_location(), send_cookie(), send_clear_cookie() ...
    // send_response() --

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
        this.http_method = this.req.method

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

    not_found() {
        throw new URLNotFound({path: this.path})
    }

    /***  Access methods  ***/

    async text() {
        /* Like Request.text() API. */
        return this.req && (typeof this.req.body === 'string') ? this.req.body : this.request.text()
    }

    async json() {
        /* Like Request.json() API. */
        return this.text().then(text => JSON.parse(text))
    }

    /***  Response generation  ***/

    send_mimetype(type) { return this.res.type(type) }      // modifies response header, no sending yet

    async send_file(path) {
        return promisify(this.res.sendFile).call(this.res, path)
    }

    async send_json(data) {
        this.res.json(data)
        return _sending_done(this.res)
    }

    send(body) { return this.res.send(body) }
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
    extra           // any request-specific data added by init_client()

    static from_request(request, ...objects) {
        /* For use on the server. Optional `objects` are included in the context as seed objects together
           with `target`, `app` and `app.global` objects.
         */
        let ctx = new WebContext()
        let app = schemat.app
        let target = request.target

        // assert(schemat.app.is_loaded(), schemat.app)     // FIXME: these asserts fail when opening http://127.0.0.1:3000/$/id/2 (Application page)
        // assert(schemat._app.is_loaded(), schemat._app)

        let items = new RecentObjects()
        let queue = [app, target, ...app.global?.values() || [], ...objects].filter(Boolean)
        
        // extend the `items` set with all objects that are referenced from the `target` and `app` via __category, __extend or __container
        // TODO: deduplicate IDs when repeated by different object instances (e.g., this happens for the root category)
        while (queue.length) {
            let obj = queue.pop()
            if (!obj || items.hasNewer(obj)) continue
            // assert(obj.is_loaded(), obj)

            items.add(obj)
            queue.push(...obj.__category$)
            queue.push(...obj.__prototype$)
            queue.push(obj.__container)
        }
        items = [...items]

        ctx.objects = items.map(obj => obj.__record)
        ctx.app = app.id
        ctx.target = target?.id
        ctx.endpoint = request.endpoint
        return ctx
    }

    encode() {
        /* Encoding into JSON+base64 string. */
        return btoa(encodeURIComponent(JSON.stringify(this)))
    }

    static decode(text) {
        /* `text` may contain whitespace characters, they will be removed before decoding. */
        let state = JSON.parse(decodeURIComponent(atob(text.replace(/\s+/g, ''))))
        return Object.assign(new WebContext(), state)
    }
}


