import {WebObject} from "../core/object.js"


/**********************************************************************************************************************/

export class Page extends WebObject {
    /* Class for the [Page] category of objects that represents standalone web pages. */

    // properties...
    view_endpoint
    admin_endpoint

    async __init__() {
        if (this.view_endpoint)
            this.__self['GET.view'] = await this._create_handler(this.view_endpoint)
        if (this.admin_endpoint)
            this.__self['GET.admin'] = await this._create_handler(this.admin_endpoint)
    }

    async _create_handler(path) {
        let handler = await schemat.import(path)
        if (typeof handler !== 'function') throw new Error(`the endpoint handler is not a function (${path})`)
        return handler.bind(this)
    }
}
