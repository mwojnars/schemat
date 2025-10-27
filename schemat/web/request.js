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

class _Request {
    /* Shared attributes and methods of a request (WebRequest or ShadowRequest), accessible on server and client alike. */

    target
    endpoint
    params
    extra

    get props() { return {...this.params, ...this.extra} }
}


export class WebRequest extends _Request {   // WebConnection (conn)
    /* Schemat's own representation of a web request (or internal request), plus context information
       that may evolve during the routing procedure, plus response generation methods.
     */
    static SEP_ENDPOINT = '::'          // separator of endpoint name within a URL path

    request         // instance of standard Request (Fetch API)
    req             // Express's request (req) object
    res             // Express's response (res) object

    target          // target web object (recipient of the request)
    endpoint        // target's network endpoint that should handle the request, as a full name, e.g., "GET.json"
    protocol        // endpoint type: LOCAL, GET, POST, ... (SOCK in the future)
    http_method     // GET, POST, PUT ...

    url             // complete URL, with protocol, domain name and ?x=y query string
    path            // URL path with trailing ::endpoint removed
    query           // plain object containing a property for each query string parameter (?x=y) of the original URL
    endpoints = []  // candidate endpoints that should be tried if `endpoint` is not yet decided; the first one that's present in the `target` is used, or 'default' if empty

    params = {}     // object, {name: value}, containing parameters decoded from the URL in Svelte/Next.js style
    extra = {}      // any extra data beyond `params` to be passed together as `props` to component rendering functions, here and on client

    _objects = []               // any web objects (loaded), other than `target` and `app`, that should be included as bootstrap objects in rich response
    _client_init = new Set()    // any client-side initialization code (JS string) to be executed after Schemat boot up

    // TODO add after Svelte's RequestEvent:
    // cookies: {get, set, delete, serialize}
    // locals: App.Locals   (auth/session info)
    // fetch    (function to fetch other endpoints (respects hooks, credentials)

    // TODO response generation:
    // send()
    // send_status()
    // send_header(), send_redirect(), send_download(), send_location(), send_cookie(), send_clear_cookie() ...
    // send_response() --

    constructor({path, req, res}) {
        super()
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


    /***  Internal use during route discovery  ***/

    set_target(target)      { this.target = target }
    set_endpoint(endpoint)  { this.endpoint = endpoint }
    set_params(params)      { this.params = params || {} }
    set_props(extra = {})   { this.extra = {...this.extra, ...extra} }

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

    send(body) { return this.res.send(body) }

    send_mimetype(type) {
        /* Modifies response header, no sending yet. */
        if (!type) return
        type = type.toLowerCase()

        const substitutions = {
            'pcss': 'css',          // PostCSS
            'postcss': 'css',       // PostCSS
        }
        if (type in substitutions) type = substitutions[type]

        return this.res.type(type)
    }

    async send_file(path) { return promisify(this.res.sendFile).call(this.res, path) }

    async send_json(data) {
        this.res.json(data)
        return _sending_done(this.res)
    }


    // rich response ...

    send_objects(...objs)   { this._objects.push(...objs) }         // these web objects will be sent as bootstrap objects
    send_init(code)         { this._client_init.add(code) }         // this JS code snippet will be executed on client after Schemat boot up
    send_function(func)     { this.send_init(`(${func.toString()})();`) }       // this no-arg function will be sent to client and executed during bootstrap


    /***  Response finalization (rich response)  ***/

    _generate_shadow() {
        /* Creates a ShadowRequest with initialization data for client-side Schemat.
           Optional `objects` are included as seed objects together with this.target, `app`, `app.global`.
         */
        let ctx = new ShadowRequest()
        let app = schemat.app
        let target = this.target

        // assert(schemat.app.is_loaded(), schemat.app)     // FIXME: these asserts fail when opening http://127.0.0.1:3000/$/id/2 (Application page)
        // assert(schemat._app.is_loaded(), schemat._app)

        let items = new RecentObjects()     // TODO: `target` must be preserved in its exact form for hydration, even if a newer version was found
        let queue = [app, target, ...app.global?.values() || [], ...this._objects].filter(Boolean)

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
        ctx.app_id = app.id
        ctx.target_id = target?.id
        ctx.endpoint = this.endpoint
        ctx.params = this.params
        ctx.extra = this.extra

        return ctx
    }

    _embed_shadow() {       //client_runtime
        /* HTML block to be put in <body> of a page to load `schemat` runtime and its shadow request on client.
           The output string must be inserted unescaped (!), e.g., in EJS with <%- %> tag instead of <%= %>.
         */
        let request = schemat.request
        if (!request) throw new Error(`no web request, cannot generate client-side initialization block`)

        let shadow = this._generate_shadow()
        let dump = "`\n" + shadow.encode() + "`"
        let after = [...this._client_init].join('\n')

        return `
            <script type="importmap"> {
                "imports": {
                    "#app/": "/$/local/",
                    "#schemat/": "/$/schemat/"
                }
            } </script>

            <script async type="module">
                import {Client} from "#schemat/web/client.js";
                globalThis.schemat = new Client(${dump});
                await schemat.boot();
                ${after}
            </script>
        `
    }
}


/**********************************************************************************************************************/

export class ShadowRequest extends _Request {    // WebContext BackRequest AfterRequest MirrorRequest PseudoRequest
    /* Metadata and seed objects related to a particular web request, sent back from server to client (embedded in HTML)
       to enable boot up of client-side Schemat and re-rendering/re-hydration (CSR) of the page.
       After client-side finalize(), some attributes reflect the values from original server-side WebRequest
       and become accessible via schemat.request.* on server and client alike: target, endpoint, params, props.
     */
    app_id          // ID of application object
    target_id       // ID of requested (target) web object, can be missing
    target          // requested web object, loaded
    endpoint        // full name of the target's endpoint that was requested, like "GET.admin"
    objects         // bootstrap objects to be recreated on client; their inclusion in response reduces network communication
    params          // endpoint's dynamic parameters that were requested by client
    extra           // any request-specific data added by init_client()

    encode(line_length = 1000) {
        /* Encodes this object into a JSON+base64 string, possibly with line breaks after every `line_length` chars. */
        let encoded = btoa(encodeURIComponent(JSON.stringify(this)))    // no JSONx because `schemat` is not yet ready while decoding, so REFs couldn't be properly decoded anyway
        if (line_length) {
            let re = new RegExp(`(.{${line_length}})`, 'g')
            encoded = encoded.replace(re, '$1\n')               // insert a new line every `line_length` chars
        }
        return encoded
    }

    static decode(text) {
        /* `text` may contain whitespace characters, they will be removed before decoding. */
        let state = JSON.parse(decodeURIComponent(atob(text.replace(/\s+/g, ''))))
        return Object.assign(new ShadowRequest(), state)
    }

    async finalize() {
        /* After decode() on client, preload bootstrap objects and initialize `target` from `target_id`. */
        for (let rec of this.objects)
            await schemat.get_loaded(rec.id)

        delete this.objects         // save memory: `this` is remembered in `schemat` as a global

        if (this.target_id) {
            this.target = schemat.get_object(this.target_id)
            assert(this.target.is_loaded())
        }
        return this.target
    }
}


