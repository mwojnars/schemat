import {print, assert} from './utils.js'
import {Registry, Session} from './registry.js'
import {ClientDB} from "./db/db.js"


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

    async insert(item) {
        let data = item.data.__getstate__()
        delete data['__category__']

        let category = item.category
        assert(category, 'cannot insert an item without a category')    // TODO: allow creation of no-category items

        let record = await category.action.create_item(data)
        if (record) {
            this.db._cache(record)                      // record == {id: id, data: data-encoded}
            return this.getItem(record.id)
        }
        throw new Error(`cannot create item ${item}`)
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
    let db       = new ClientDB(/*data.system_url,*/ data.items)
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
