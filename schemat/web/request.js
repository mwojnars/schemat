import {UrlPathNotFound} from "../common/errors.js";
import {assert, splitLast} from "../common/utils.js";


export class Request {   // Connection ?
    /* Schemat's own representation of a web request, OR internal request;
       together with context information that may evolve during the routing procedure.
     */

    static SEP_ENDPOINT = '::'          // separator of an endpoint name within a URL path

    throwNotFound(msg, args)  { throw new UrlPathNotFound(msg, args || {path: this.path}) }

    req             // instance of node.js express' Request
    res             // instance of node.js express' Response

    protocol        // endpoint type: CALL, GET, POST, (SOCK in the future)
    path            // URL path with trailing ::endpoint name removed

    args            // dict of arguments for the handler function; taken from req.query (if a web request) or passed directly (internal request)
    methods = []    // names of access methods to be tried for a target item; the 1st method that's present on the item will be used, or 'default' if `methods` is empty

    target          // target object responsible for handling of the request; found by the routing procedure starting at the site object
    endpoint        // endpoint of the target item, as found by the routing procedure


    constructor({path, method, req, res}) {
        this.req = req
        this.res = res

        this.protocol =
            !this.req                   ? "CALL" :          // CALL = internal call through Site.route_internal()
            this.req.method === 'GET'   ? "GET"  :          // GET  = read access through HTTP GET
                                          "POST"            // POST = write access through HTTP POST

        path ??= this.req.path
        let endp, sep = Request.SEP_ENDPOINT;
        [this.path, endp] = path.includes(sep) ? splitLast(path, sep) : [path, '']

        // in Express, the web path always starts with at least on character, '/', even if the URL contains a domain alone;
        // this leading-trailing slash has to be truncated for correct segmentation and detection of an empty path
        if (this.path === '/') this.path = ''
        this._push(method, sep + endp)
    }

    _prepare(endpoint) {
        if (!endpoint) return endpoint
        let sep = Request.SEP_ENDPOINT
        assert(endpoint.startsWith(sep), `endpoint must start with '${sep}' (${endpoint})`)
        return endpoint.slice(sep.length)
    }

    _push(...methods) {
        /* Append names to this.methods. Each name must start with '::' for easier detection of method names
           in a source code - this prefix is truncated when appended to this.methods.
         */
        for (const method of methods) {
            let m = this._prepare(method)
            if (m && !this.methods.includes(m)) this.methods.push(m)
        }
    }
}


export class ObjectSet {
    /* A Set of objects that deduplicates by object.id and keeps the most recent object (by __meta.loaded_at). */
}


export class RequestContext {
    /* Seed web objects and request-related context information to be embedded in HTML response and then unpacked on the client
       to enable boot up of a client-side Schemat. The objects are flattened (state-encoded), but not yet stringified.
     */
    site_id
    target_id
    items
    endpoint

    static from_request(request) {
        /* For use on the server. */
        let ctx = new RequestContext()
        let site = schemat.site
        let target = request.target

        let items = new Set()
        let queue = [target, site].filter(Boolean)
        
        // extend the `items` set with all objects that are referenced from the `target` and `site` via __category or __extend
        // TODO: deduplicate IDs when repeated by different object instances (e.g., this happens for the root category)
        while (queue.length) {
            let obj = queue.pop()
            if (!obj || items.has(obj)) continue
            obj.assert_loaded()
            items.add(obj)

            queue.push(obj.__category)
            queue.push(...obj.__extends$)
        }
        items = [...items]

        // // build the set of unique IDs to check against duplicates
        // let ids = new Set(objs.map(obj => obj.id))
        // assert(ids.size === objs.length, `duplicate item IDs: ${objs.map(o => o.id).join(', ')}`)

        // let items = [target, target.__category, schemat.root_category, site, ...site.__category.__ancestors]
        // items = [...new Set(items)].filter(Boolean)             // remove duplicates and nulls

        ctx.items = items.map(obj => obj.__record.encoded())
        ctx.site_id = site.__id
        ctx.target_id = target.__id
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

