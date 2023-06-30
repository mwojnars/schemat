import {BaseError, NotImplemented} from "../errors.js"
import {assert, print} from "../utils.js"


/**********************************************************************************************************************/

export class Database {
    /* Common interface for server-side and client-side database layers alike. */

    static Error = class extends BaseError {}

    async select(id)    { throw new NotImplemented() }
    async *scan(cid)    { throw new NotImplemented() }
}


/**********************************************************************************************************************/

export class ClientDB extends Database {
    /* Client-side DB layer that that connects to the server via AJAX calls.
       In the future, this class may provide long-term caching based on Web Storage (local storage or session storage).
     */

    // url     = null              // base URL for AJAX calls, no trailing slash '/'; typically a "system URL" of the website
    records = new Map()         // cached `data` of the items received on initial or subsequent web requests;
                                // each `data` is JSON-encoded for safety

    get url() { return globalThis.registry.site.systemURL() }

    constructor(records = []) {
        super()
        this._cache(...records)
        // this.url = url
        // assert(!url.endsWith('/'))
    }

    _cache(...records) {
        /* Save `records` in internal cache for future reference. */
        for (let rec of records) {
            if (!rec.data) continue                         // don't keep stubs
            if (typeof rec.data !== 'string')               // always keep data as a JSON-encoded string, not a flat object
                rec = {...rec, data: JSON.stringify(rec.data)}
            this.records.set(rec.id, rec.data)
        }
    }

    async select(id) {
        /* Look up this.records for a given `id` and return its `data` if found; otherwise pull it from the server-side DB. */
        if (!this.records.has(id)) this._cache(await this._from_ajax(id))
        return this.records.get(id)
    }

    async _from_ajax(id) {
        /* Retrieve an item by its ID = (CID,IID) from a server-side DB. */
        print(`ajax download [${id}]...`)
        return $.get(`${this.url}/${id}@json`)
    }
    async *scan(cid) {
        assert(cid || cid === 0)
        print(`ajax category scan [${cid}]...`)
        let records = await $.get(`${this.url}/${cid}@scan`)
        for (const rec of records) {            // rec's shape: {id, data}
            if (rec.data) {
                rec.data = JSON.stringify(rec.data)
                this._cache(rec)
            }
            yield rec
        }
    }
}

