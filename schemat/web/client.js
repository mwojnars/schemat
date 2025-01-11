import "../common/globals.js"           // global flags: CLIENT, SERVER

import {assert, print} from "../common/utils.js";
import {Schemat} from "../core/schemat.js";
import {RequestContext} from "./request.js"


/**********************************************************************************************************************/

export class Client extends Schemat {
    /* Client-side global Schemat object. Used in .init_client() and .client_block() of the server-side Schemat. */

    // attributes of the web request that invoked generation of this page by the server
    web = {
        object: null,           // target web object that was addressed by the request, already loaded
        endpoint: null,         // target's endpoint that was called
    }

    constructor(context_path) {
        let ctx = RequestContext.from_element(context_path)
        print('request context:', ctx)
        super(ctx)
    }

    async boot() {
        let ctx = this.config

        ctx.objects.map(rec => schemat.register_record(rec))    // register {id,data} records of bootstrap objects

        await super.boot()

        for (let rec of ctx.objects)                            // preload bootstrap objects
            await this.get_loaded(rec.id)

        delete ctx.objects                                      // save memory (`ctx` is remembered in `schemat` as a global)
        let object = this.get_object(ctx.target)
        object.assert_loaded()

        this.web = {object, endpoint: ctx.endpoint}
        // check()
    }

    async _select(id) {
        /* Load an object from the server via AJAX call. */
        let url = schemat.site.default_path_of(id) + '::json'
        let {data} = await fetch(url).then(response => response.json())     // {id, data} encoded
        return JSON.stringify(data)
    }
}

// import {check} from "/site/widgets.js"
