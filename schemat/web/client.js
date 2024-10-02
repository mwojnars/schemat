import "../common/globals.js"           // global flags: CLIENT, SERVER

import {assert, print} from "../common/utils.js";
import {Schemat} from "../core/schemat.js";
import {RequestContext} from "./request.js"
import {JSONx} from "../core/jsonx.js";


/**********************************************************************************************************************/

export class ClientDB {
    /* Client-side thin DB interface that communicates with the server via AJAX calls, used as a drop-in replacement for Database.
       In the future, this class may provide long-term caching based on Web Storage (local storage or session storage).
     */

    _cache = new Map()      // {id: data_json}, cache of item data received on initial or subsequent web requests;
                            // each data is JSON-encoded for safety, to avoid accidental modification

    constructor(records = []) {
        this.cache(...records)
    }

    cache(...records) {
        /* Save `records` in internal cache for future reference. */
        for (let rec of records) {
            if (!rec.data) continue                         // don't keep stubs
            if (typeof rec.data !== 'string')               // always keep data as a JSON-encoded string, not a flat object
                rec = {...rec, data: JSON.stringify(rec.data)}
            this._cache.set(rec.id, rec.data)
        }
    }

    async select(req /*DataRequest*/) {
        /* Look up this._cache for a given `id` and return its `data` if found; otherwise pull it from the server-side DB. */
        let id = req.args.id
        if (!this._cache.has(id)) this.cache(await this._from_ajax(id))
        return this._cache.get(id)
    }

    async _from_ajax(id) {
        /* Retrieve an object by its ID from a server-side DB. */
        print(`ajax download [${id}]...`)
        let url = schemat.site.default_path_of(id) + '::json'
        return fetch(url).then(response => response.json())         // load object's JSON data from the server
    }
}


/**********************************************************************************************************************/

export class ClientSchemat extends Schemat {
    /* Client-side global Schemat object. */

    // attributes of the web request that invoked generation of this page by the server
    requested = {
        target: null,           // target web object that was addressed by the request, already loaded
        endpoint: null,         // target's endpoint that was called
        service: null,          // service (if any) that is exposed at the target's `endpoint`
    }

    /***  startup  ***/

    async boot(context_path) {
        let ctx = RequestContext.from_element(context_path)
        print('request context:', ctx)

        let db = new ClientDB(ctx.items)
        await super.boot(ctx.site_id, db)

        for (let rec of ctx.items)                      // preload all boot objects
            await this.get_loaded(rec.id)

        let target = this.get_object(ctx.target_id)
        target.assert_loaded()

        let endpoint = ctx.endpoint
        let service = target.__services[endpoint]

        this.requested = {target, endpoint, service}
        // check()
    }

    // static _read_data(node, format = "json") {
    //     /* Extract text contents of an element pointed to by a given selector.
    //        If `format` is given, or the element has `format` attribute, and the format is "json",
    //        the extracted string is JSON-decoded to an object.
    //      */
    //     if (typeof node === "string")
    //         node = document.querySelector(node)
    //
    //     let value = node.textContent
    //     if (!format) format = node.getAttribute('format')
    //
    //     // decode `value` depending on the `format`
    //     if (format === "json") return JSON.parse(value)
    //     if (format === "json+base64") return JSON.parse(decodeURIComponent(atob(value)))
    //
    //     return value
    // }


    /***  DB  ***/

    async client_insert(category, data_encoded) {
        /* `data` is a flat (encoded) object, possibly the result of Data.__getstate__() but not necessarily. */
        assert(category, 'cannot insert an item without a category')    // TODO: allow creation of no-category items
        let record = await schemat.site.service.create_item(data_encoded)
        if (!record) throw new Error(`failed to insert a new object`)
        schemat.db.cache(record)                         // record == {id: id, data: data-encoded}
        return this.get_object(record.id)
    }
}

// import {check} from "/site/widgets.js"
