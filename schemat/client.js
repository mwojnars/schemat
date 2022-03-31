import { print, assert } from './utils.js'
import { ItemsMap } from './data.js'
import { JSONx } from './serialize.js'
import { Registry, Session } from './registry.js'


/**********************************************************************************************************************/

function read_data(node, type = "json") {
    /* Extract text contents of an element pointed to by a given selector.
       If `type` is given, or the element has `type` attribute, and the type is "json",
       the extracted string is JSON-decoded to an object.
     */
    if (typeof node === "string")
        node = document.querySelector(node)

    let value = node.textContent
    if (!type) type = node.getAttribute('type')

    // decode `value` depending on the `type`
    if (type === "json") return JSON.parse(value)
    if (type === "json+base64") return JSON.parse(decodeURIComponent(atob(value)))

    return value
}

/**********************************************************************************************************************/

class AjaxDB {
    /* Remote abstract DB layer that's accessed by this web client over AJAX calls.
       In the future, this class may provide long-term caching based on Web Storage (local storage or session storage).
     */

    url     = null                  // base URL for AJAX calls, no trailing slash '/'; typically a "system URL" of the website
    records = new ItemsMap()        // cached `data` of the items received on initial or subsequent web requests;
                                    // each `data` is JSON-encoded for safety

    constructor(url, records = []) {
        this.url = url
        this.keep(...records)
        assert(!url.endsWith('/'))
    }

    keep(...records) {
        for (let rec of records) {
            if (!rec.data) continue                         // don't keep stubs
            if (typeof rec.data !== 'string')               // always keep data as a JSON-encoded string, not a flat object
                rec = {...rec, data: JSON.stringify(rec.data)}
            let id = rec.id || [rec.cid, rec.iid]
            this.records.set(id, rec.data)
        }
    }

    has(id)     { return this.records.has(id) }

    async get(id) {
        /* Look up this.records for a given `id` and return its `data` if found; otherwise pull it from the server-side DB. */
        let [cid, iid] = id
        if (!this.has(id)) this.keep(await this._from_ajax(cid, iid))
        return this.records.get(id)
    }
    async select(id) { return this.get(id) }

    async _from_ajax(cid, iid) {
        /* Retrieve an item by its ID = (CID,IID) from a server-side DB. */
        print(`ajax download [${cid},${iid}]...`)
        return $.get(`${this.url}/${cid}:${iid}@json`)
    }
    async *scan(cid = null) {
        assert(cid !== null)
        print(`ajax category scan [0,${cid}]...`)
        let records = await $.get(`${this.url}/0:${cid}@scan`)
        for (const rec of records) {            // rec's shape: {cid, iid, data}   (TODO: change to {id, data})
            if (rec.data) {
                rec.data = JSON.stringify(rec.data)
                this.keep(rec)
            }
            let id = rec.id || [rec.cid, rec.iid]
            yield [id, rec.data]
        }
    }
}

class ClientRegistry extends Registry {
    /* Client-side registry: getItem() pulls items from server. */

    onServer = false

    constructor(data) {
        super()
        this.db = new AjaxDB(data.system_url, data.items)
        // this.cache = new ClientCache()
    }
    async boot(data) {
        await super.boot(data.site_id)
        this.session = Session.load(this, data.session)
        for (let rec of data.items)
            await this.getLoaded(rec.id || [rec.cid, rec.iid])          // preload all boot items from copies passed in constructor()
    }
}

/**********************************************************************************************************************
 **
 **  STARTUP
 **
 */

// import {check} from "/site/widgets.js"

export async function boot(view) {

    let data     = read_data('#data-session', 'json+base64')
    let registry = globalThis.registry = new ClientRegistry(data)
    await registry.boot(data)

    // print('root:', await registry.getItem([0,0], {load: true}))
    // print('[0,10]:', await registry.getItem([0,10], {load: true}))
    // print('[10,1]:', await registry.getItem([10,1], {load: true}))

    let root = document.querySelector("#react-root")
    let item = registry.session.item
    assert(item.loaded)
    // print('main item:', item)

    item.render(view, root)
    // check()
}
