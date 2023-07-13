import {print, assert} from "./utils.js"
import {ClientRegistry} from "./registry.js"
import {ClientDB} from "./db/db.js"


/**********************************************************************************************************************/

export class SchematProcess {
    /* The main Schemat process, on a worker node or in a user browser. */

    registry
    cluster         // the cluster this process belongs to; only defined in backend processes
    client_db       // the client DB of the cluster; only defined in client-side processes (in a browser)

    get db() {
        return this.cluster?.prop('db') || this.client_db
    }

    constructor() {
        globalThis.schemat = this
    }

    async init() { return this }         // creating the registry; override in subclasses

    async _create_registry(registry_class, ...args) {
        let registry = new registry_class(this, ...args)
        this.registry = registry
        globalThis.registry = registry
        await registry.init_classpath()
        await registry.boot()
        return this
    }
}


export class ClientProcess extends SchematProcess {

    async init() { return this._create_registry(ClientRegistry) }

    async start(view) {
        /* In-browser startup of Schemat rendering. Initial data is read from the page's HTML element. */

        let data = this._read_data('#page-data', 'json+base64')
        this.client_db = new ClientDB(data.items)

        await this.init()
        await this.registry.bootData(data)

        // print('root:', await registry.getItem([0,0], {load: true}))
        // print('[0,10]:', await registry.getItem([0,10], {load: true}))
        // print('[10,1]:', await registry.getItem([10,1], {load: true}))

        let root = document.querySelector("#page-component")
        let item = this.registry.session.item
        assert(item.isLoaded)
        // print('main item:', item)

        // return item.view[view].render(root)
        // return item.net.render(view, root)

        let page = item.net.api.services[view]
        print('page:', page)
        if (page) return page.render_client(item, root)

        return item.render(view, root)          // render() could be async to perform any necessary data loading
        // check()
    }

    _read_data(node, type = "json") {
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
}

// import {check} from "/site/widgets.js"
