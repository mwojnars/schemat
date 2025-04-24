import {print, assert, splitLast} from "../common/utils.js";
import {Objects} from "../common/structs.js";


export class Request {
    /* Base class for network requests submitted over different protocols: HTTP(S) GET, POST, Kafka, ... */

    target          // target web object (recipient of the request)
    endpoint        // full name of the network endpoint that should handle the request (e.g., "GET.json")
    protocol        // endpoint type: LOCAL, GET, POST, ... (SOCK in the future)

    set_target(target) { this.target = target }
    set_endpoint(endpoint) { this.endpoint = endpoint }
}


export class WebRequest extends Request {
    /* Schemat's own representation of a web request, OR internal request;
       together with context information that may evolve during the routing procedure.
     */
    static SEP_ENDPOINT = '::'          // separator of endpoint name within a URL path

    req             // instance of node.js express' Request
    res             // instance of node.js express' Response

    path            // URL path with trailing ::endpoint removed
    endpoints = []  // candidate endpoints that should be tried if `endpoint` is not yet decided; the first one that's present in the `target` is used, or 'default' if empty


    constructor({path, req, res}) {
        super()

        this.req = req
        this.res = res

        this.protocol =
            !this.req                   ? "LOCAL" :         // LOCAL = internal call through Application.route_local()
            this.req.method === 'GET'   ? "GET"  :          // GET  = read access through HTTP GET
                                          "POST"            // POST = write access through HTTP POST

        path ??= this.req.path
        let endp, sep = WebRequest.SEP_ENDPOINT;
        [this.path, endp] = path.includes(sep) ? splitLast(path, sep) : [path, '']

        // in Express, the web path always starts with at least on character, '/', even if the URL contains a domain alone;
        // this leading-trailing slash has to be truncated for correct segmentation and detection of an empty path
        if (this.path === '/') this.path = ''
        this._push(sep + endp)
    }

    _prepare(endpoint) {
        if (!endpoint) return endpoint
        let sep = WebRequest.SEP_ENDPOINT
        assert(endpoint.startsWith(sep), `endpoint must start with '${sep}' (${endpoint})`)
        return endpoint.slice(sep.length)
    }

    _push(...endpoints) {
        /* Append names to this.endpoints. Each name must start with '::' for easier detection of endpoint names
           in a source code - this prefix is truncated when appended to this.endpoints.
         */
        for (const endpoint of endpoints) {
            let m = this._prepare(endpoint)
            if (m && !this.endpoints.includes(m)) this.endpoints.push(m)
        }
    }
}


/**********************************************************************************************************************/

export class RequestContext {
    /* Seed web objects and request-related context information to be embedded in HTML response and then unpacked on the client
       to enable boot up of a client-side Schemat. The objects are flattened (state-encoded), but not yet stringified.
     */
    site            // ID of the application object
    target          // ID of the requested object (target of the web request)
    objects         // client-side bootstrap objects: included in HTML, preloaded before the page rendering begins (no extra communication to load each object separately)
    endpoint        // full name of the target's endpoint that was requested, like "GET.admin"

    static from_request(request, ...objects) {
        /* For use on the server. Optional `objects` are included in the context as seed objects together
           with `target`, `site` and `site.global` objects.
         */
        let ctx = new RequestContext()
        let site = schemat.site
        let target = request.target

        let items = new Objects()
        let queue = [target, site, ...site.global?.values() || [], ...objects].filter(Boolean)
        
        // extend the `items` set with all objects that are referenced from the `target` and `site` via __category, __extend or __container
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
        ctx.site = site.id
        ctx.target = target.id
        ctx.endpoint = request.endpoint
        return ctx
    }

    static from_element(selector) {
        /* For use on the client. Extract text contents of the DOM element pointed to by a CSS `selector` and decode back into RequestContext. */
        let node = document.querySelector(selector)
        return this.decode(node.textContent)
    }

    encode() {
        /* Encoding into JSON+base64 string. */
        return btoa(encodeURIComponent(JSON.stringify(this)))
    }

    static decode(text) {
        let state = JSON.parse(decodeURIComponent(atob(text)))
        return Object.assign(new RequestContext(), state)
    }
}


