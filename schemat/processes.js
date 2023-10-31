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

    equivalent(obj1, obj2) {
        /* True if `obj1` and `obj2` are equivalent in terms of ID; they still can be two different instances
           AND may contain different data (!), for example, if one them contains more recent updates than the other.
           Each of the arguments can be null or undefined - such values, or missing ID, are considered NOT equivalent.
         */
        return obj1?._id_ !== undefined && obj1?._id_ === obj2?._id_
    }
}


export class ClientProcess extends SchematProcess {

    async init() { return this._create_registry(ClientRegistry) }

    async start() {
        /* In-browser startup of Schemat rendering. Initial data is read from the page's HTML element #page-data. */

        let data = this._read_data('#page-data', 'json+base64')
        print('page data:', data)
        this.client_db = new ClientDB(data.items)

        await this.init()
        await this.registry.bootData(data)

        // print('root:', await registry.getItem([0,0], {load: true}))
        // print('[0,10]:', await registry.getItem([0,10], {load: true}))
        // print('[10,1]:', await registry.getItem([10,1], {load: true}))

        let root = document.querySelector("#page-component")
        let item = this.registry.session.item
        item.assertLoaded()
        // print('main item:', item)

        // return item.view[view].render(root)
        // return item.net.render(view, root)

        let endpoint = data.endpoint
        let page = item.net.api.services[endpoint]
        return page.render(item, root)
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
