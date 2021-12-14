import { print, assert } from './utils.js'
import { ItemsMap } from './data.js'
import { JSONx } from './serialize.js'
import { Database, Registry } from './registry.js'


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
    if (type === "json+base64") return JSON.parse(atob(value))

    return value
}

/**********************************************************************************************************************/

class AjaxDB extends Database {
    /* Remote abstract DB layer that's accessed by this web client over AJAX calls.
       In the future, this class may provide long-term caching based on Web Storage (local storage or session storage).
     */

    ajax_url = null                 // base URL for AJAX calls, no trailing slash '/'
    records  = new ItemsMap()       // cached records received on initial or subsequent web requests;
                                    // each record is {cid,iid,data}, `data` is JSON-encoded for safety

    constructor(ajax_url, records = []) {
        super()
        this.ajax_url = ajax_url
        this.keep(...records)
        assert(!ajax_url.endsWith('/'))
    }

    keep(...records) {
        for (const rec of records) {
            if (typeof rec.data !== 'string') rec.data = JSON.stringify(rec.data)
            this.records.set([rec.cid, rec.iid], rec)
        }
    }

    async select(id) {
        /* Look up this.records for a given `id` and return if found; otherwise pull it from the server-side DB. */
        let [cid, iid] = id
        return this.records.get(id) || this._from_ajax(cid, iid)
    }
    async _from_ajax(cid, iid) {
        /* Retrieve an item by its ID = (CID,IID) from a server-side DB. */
        print(`ajax download [${cid},${iid}]...`)
        return await $.get(`${this.ajax_url}/${cid}:${iid}`)
    }
    async *scanCategory(cid) {
        print(`ajax category scan [0,${cid}]...`)
        let items = await $.get(`${this.ajax_url}/0:${cid}@scan`)
        for (const item of items) yield item
    }
}

class ClientRegistry extends Registry {
    /* Client-side registry: getItem() pulls items from server and caches in browser's web storage. */

    // get _specializedItemJS() { return "./client/item-c.js" }

    constructor(boot_items, ajax_url) {
        super()
        this.db = new AjaxDB(ajax_url, boot_items)
        // this.cache = new ClientCache()
    }
    async boot(request) {
        await super.boot()
        this.current_request = JSONx.decode(request)
        // this.current_request.item.load()
    }
}

/**********************************************************************************************************************
 **
 **  STARTUP
 **
 */

export async function boot() {

    let items  = read_data('#data-items') //, 'json+base64')
    let data   = read_data('#data-data') //, 'json+base64')
    print('data-items: ', items)
    print('data-data:', data)

    let registry = globalThis.registry = new ClientRegistry(items, data.ajax_url)
    await registry.initClasspath()
    await registry.boot(data.request)

    // print('root:', await registry.getItem([0,0], {load: true}))
    // print('[0,10]:', await registry.getItem([0,10], {load: true}))
    // print('[10,1]:', await registry.getItem([10,1], {load: true}))

    let react_root = document.querySelector("#react-root")
    // let item = await (await registry.getItem(config.id)).load()
    // print('main item:', item)

    await registry.current_request.item.display(react_root)
}
