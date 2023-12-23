import {print} from "../common/utils.js";
import {ClientDB} from "./client_db.js";
import {ClientRegistry} from "../registry.js";
import {SchematProcess} from "../processes.js";


/**********************************************************************************************************************/


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
