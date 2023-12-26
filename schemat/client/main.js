import {assert, print} from "../common/utils.js";
import {ClientDB} from "./client_db.js";
import {Registry} from "../registry.js";
import {SchematProcess} from "../processes.js";


/**********************************************************************************************************************/

class ClientRegistry extends Registry {
    /* Client-side registry: getItem() pulls items from server. */

    server_side = false

    async client_boot(data) {
        /* Load response data from state-encoded `data.session` as produced by Request.dump(). */

        await this.boot(data.site_id)
        assert(this.site)

        for (let rec of data.items)
            await this.getLoaded(rec.id)            // preload all boot items from copies passed in constructor()

        return this.getItem(data.target_id)
    }

    directImportPath(path) { return this.remoteImportPath(path) }
    remoteImportPath(path) { return path + '::import' }

    async import(path, name) {
        /* High-level import of a module and (optionally) its element, `name`, from a SUN path. */
        let module = import(this.remoteImportPath(path))
        return name ? (await module)[name] : module
    }

    async insert(item) {
        let data = item._data_.__getstate__()
        delete data['_category_']

        let category = item._category_
        assert(category, 'cannot insert an item without a category')    // TODO: allow creation of no-category items

        let record = await category.action.create_item(data)
        if (record) {
            this.db.cache(record)                       // record == {id: id, data: data-encoded}
            return this.getItem(record.id)
        }
        throw new Error(`cannot create item ${item}`)
    }
}


/**********************************************************************************************************************/

export class ClientProcess extends SchematProcess {

    // async init() { return this._create_registry(ClientRegistry) }

    async start() {
        /* In-browser startup of Schemat rendering. Initial data is read from the page's HTML element #page-data. */

        let data = this._read_data('#page-data', 'json+base64')
        print('page data:', data)
        this.client_db = new ClientDB(data.items)

        await this._create_registry(ClientRegistry)
        let item = await registry.client_boot(data)
        item.assert_loaded()

        // print('root:', await registry.getItem([0,0], {load: true}))
        // print('[0,10]:', await registry.getItem([0,10], {load: true}))
        // print('[10,1]:', await registry.getItem([10,1], {load: true}))

        let root = document.querySelector("#page-component")

        // return item.view[view].render(root)
        // return item.net.render(view, root)

        let endpoint = data.endpoint
        let page = item._net_.api.services[endpoint]
        return page.render_client(item, root)
        // check()
    }

    _read_data(node, format = "json") {
        /* Extract text contents of an element pointed to by a given selector.
           If `format` is given, or the element has `format` attribute, and the format is "json",
           the extracted string is JSON-decoded to an object.
         */
        if (typeof node === "string")
            node = document.querySelector(node)

        let value = node.textContent
        if (!format) format = node.getAttribute('format')

        // decode `value` depending on the `format`
        if (format === "json") return JSON.parse(value)
        if (format === "json+base64") return JSON.parse(decodeURIComponent(atob(value)))

        return value
    }
}

// import {check} from "/site/widgets.js"
