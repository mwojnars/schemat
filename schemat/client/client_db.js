import {NotImplemented} from "../common/errors.js"
import {assert, print} from "../common/utils.js"


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

