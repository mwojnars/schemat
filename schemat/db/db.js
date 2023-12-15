import {NotImplemented} from "../common/errors.js"
import {assert, print} from "../common/utils.js"


/**********************************************************************************************************************/

// export class Database {
//     /* Common interface for server-side and client-side database layers alike. */
//
//     async select(id)    { throw new NotImplemented() }
//     async *scan(cid)    { throw new NotImplemented() }
// }


/**********************************************************************************************************************/

export class ClientDB {
    /* Client-side DB that communicates with the server via AJAX calls.
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
        let base = registry.site.system_url
        let url = `${base}/${id}@json`

        // load JSON data from the server; same as $.get(url) but without jQuery
        // return await fetch(url).then(response => response.json())
        // let response = await fetch(url)

        return $.get(url)
    }
    // async *scan(cid) {
    //     assert(cid || cid === 0)
    //     print(`ajax category scan [${cid}]...`)
    //     let records = await $.get(`${this._url}/${cid}@scan`)
    //     for (const rec of records) {            // rec's shape: {id, data}
    //         if (rec.data) {
    //             rec.data = JSON.stringify(rec.data)
    //             this.cache(rec)
    //         }
    //         yield rec
    //     }
    // }
}

