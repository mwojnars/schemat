import { print, assert, xiid } from './utils.js'
import { ItemsMap } from './data.js'
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
        let xid = xiid(...id)
        if (!this.records.has(xid)) this.keep(await this._from_ajax(xid))
        return this.records.get(xid)
    }

    async _from_ajax(xid) {
        /* Retrieve an item by its ID = (CID,IID) from a server-side DB. */
        print(`ajax download [${xid}]...`)
        return $.get(`${this.url}/${xid}@json`)
    }
    async *scan(xid) {
        assert(xid || xid === 0)
        print(`ajax category scan [${xid}]...`)
        let records = await $.get(`${this.url}/${xid}@scan`)
        for (const rec of records) {            // rec's shape: {id, data}
            if (rec.data) {
                rec.data = JSON.stringify(rec.data)
                this.keep(rec)
            }
            yield rec  //[rec.id, rec.data]
        }
    }
}

class ClientRegistry extends Registry {
    /* Client-side registry: getItem() pulls items from server. */

    onServer = false

    async bootData(data) {
        await super.boot(data.site_id)
        assert(this.site)

        this.session = Session.load(this, data.session)
        for (let rec of data.items)
            await this.getLoaded(rec.id)            // preload all boot items from copies passed in constructor()
    }

    directImportPath(path) { return this.remoteImportPath(path) }
    remoteImportPath(path) { return path + '@import' }      //'@import@file'

    async import(path, name) {
        /* High-level import of a module and (optionally) its element, `name`, from a SUN path. */
        let module = import(this.remoteImportPath(path))
        return name ? (await module)[name] : module
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
    let db       = new AjaxDB(data.system_url, data.items)
    let registry = await ClientRegistry.createGlobal(db)
    await registry.bootData(data)

    // print('root:', await registry.getItem([0,0], {load: true}))
    // print('[0,10]:', await registry.getItem([0,10], {load: true}))
    // print('[10,1]:', await registry.getItem([10,1], {load: true}))

    let root = document.querySelector("#react-root")
    let item = registry.session.item
    assert(item.isLoaded)
    // print('main item:', item)

    item.render(view, root)
    // check()
}
