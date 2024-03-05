import {assert, print} from "../common/utils.js";
import {ClientDB} from "./client_db.js";
import {Schemat} from "../schemat.js";


/**********************************************************************************************************************/

export class ClientSchemat extends Schemat {
    /* Client-side global Schemat object. */

    server_side = false


    /***  startup  ***/

    static async start_client() {
        /* In-browser startup of Schemat rendering. Initial data is read from the page's HTML element #page-data. */

        let data = this._read_data('#page-data', 'json+base64')
        print('page data:', data)

        await ClientSchemat.create_global()
        schemat.set_db(new ClientDB(data.items))

        let item = await schemat.client_boot(data)
        item.assert_loaded()

        let root = document.querySelector("#page-component")

        // return item.view[view].render(root)
        // return item.net.render(view, root)

        let endpoint = data.endpoint
        let page = item._net_.get_service(endpoint)
        return page.render_client(item, root)
        // check()
    }

    static _read_data(node, format = "json") {
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

    async client_boot(data) {
        /* Load response data from state-encoded `data.session` as produced by Request.dump(). */

        await this.boot(data.site_id)
        assert(this.site)

        for (let rec of data.items)
            await this.get_loaded(rec.id)               // preload all boot items from copies passed in constructor()

        return this.get_item(data.target_id)
    }


    /***  import & DB  ***/

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

        let record = await category._triggers_.create_item(data)
        if (record) {
            schemat.db.cache(record)                         // record == {id: id, data: data-encoded}
            return this.get_item(record.id)
        }
        throw new Error(`cannot create item ${item}`)
    }
}

// import {check} from "/site/widgets.js"
