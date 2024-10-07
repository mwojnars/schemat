import "../common/globals.js"           // global flags: CLIENT, SERVER

import {assert, print} from "../common/utils.js";
import {Schemat} from "../core/schemat.js";
import {RequestContext} from "./request.js"


/**********************************************************************************************************************/

export class Client extends Schemat {
    /* Client-side global Schemat object. Used in .init_client() and .client_block() of the server-side Schemat. */

    // attributes of the web request that invoked generation of this page by the server
    requested = {
        target: null,           // target web object that was addressed by the request, already loaded
        endpoint: null,         // target's endpoint that was called
        service: null,          // service (if any) that is exposed at the target's `endpoint`
    }

    /***  startup  ***/

    async boot_from(context_path) {
        let ctx = RequestContext.from_element(context_path)
        print('request context:', ctx)

        ctx.items.map(rec => schemat.register_record(rec))      // register {id,data} records of bootstrap objects

        await super.boot(ctx.site_id)

        for (let rec of ctx.items)                              // preload bootstrap objects
            await this.get_loaded(rec.id)

        let target = this.get_object(ctx.target_id)
        target.assert_loaded()

        let endpoint = ctx.endpoint
        let service = target.__services[endpoint]

        this.requested = {target, endpoint, service}
        // check()
    }


    /***  DB  ***/

    async _select(id) {
        /* Load an object from the server via AJAX call. */
        let url = schemat.site.default_path_of(id) + '::json'
        let {data} = await fetch(url).then(response => response.json())     // {id, data} encoded
        return JSON.stringify(data)
    }

    async client_insert(category, data_state) {
        /* `data` is a flat (encoded) object, possibly the result of Data.__getstate__() but not necessarily. */
        assert(category, 'cannot insert an item without a category')    // TODO: allow creation of no-category items
        let record = await schemat.site.service.create_object(data_state)
        if (!record) throw new Error(`failed to insert a new object`)
        return this.get_object(record.id)
    }
}

// import {check} from "/site/widgets.js"
