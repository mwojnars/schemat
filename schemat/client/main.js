import "../common/globals.js"           // global flags: CLIENT, SERVER

import {assert, print} from "../common/utils.js";
import {Schemat} from "../core/schemat.js";
import {SeedData} from "../web/request.js"


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


    /***  startup  ***/

    static async start_client() {
        /* In-browser startup of Schemat rendering. Initial data is read from the page's HTML element #page-data. */

        let data = SeedData.from_element('#page-data')
        print('seed data:', data)

        let db = new ClientDB(data.items)
        await new ClientSchemat().boot(data.site_id, db)

        let target = await schemat._preload_objects(data)
        target.assert_loaded()

        let page = target.__services[data.endpoint]
        return page.render_client(target)
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

    async _preload_objects(data) {
        /* Load response data from state-encoded `data.session` as produced by Request.dump(). */

        for (let rec of data.items)
            await this.get_loaded(rec.id)               // preload all boot items from copies passed in constructor()

        return this.get_object(data.target_id)
    }


    /***  DB  ***/

    async insert(item) {
        let data = item.__data.__getstate__()
        delete data['__category']

        let category = item.__category
        assert(category, 'cannot insert an item without a category')    // TODO: allow creation of no-category items

        let record = await category.create_item(data)
        if (record) {
            schemat.db.cache(record)                         // record == {id: id, data: data-encoded}
            return this.get_object(record.id)
        }
        throw new Error(`cannot create item ${item}`)
    }
}

// import {check} from "/site/widgets.js"
