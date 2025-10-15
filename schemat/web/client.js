import "../common/globals.js"           // global flags: CLIENT, SERVER

import {assert, print} from "../common/utils.js";
import {Schemat} from "../core/schemat.js";
import {ClientSession} from "../core/session.js"
import {WebContext} from "./request.js"


/**********************************************************************************************************************/

export class Client extends Schemat {
    /* Client-side global Schemat object. Used in .init_client() and .client_block() of the server-side Schemat. */

    target          // target web object that was addressed by the request, already loaded
    object          // ... alias

    constructor(context_path) {
        let ctx = WebContext.from_element(context_path)
        print('request context:', ctx)
        super(ctx)
    }

    async boot() {
        let ctx = this.config

        ctx.objects.map(rec => schemat.register_record(rec))    // register {id,data} records of bootstrap objects

        await this._init_classpath()
        await super._load_app()
        // setInterval(() => this._report_memory(), 10000)

        await this._boot_done()

        for (let rec of ctx.objects)                            // preload bootstrap objects
            await this.get_loaded(rec.id)

        delete ctx.objects                                      // save memory (`ctx` is remembered in `schemat` as a global)
        this.object = this.target = this.get_object(ctx.target)
        this.object.assert_loaded()

        this.session = new ClientSession()
        // check()
    }

    // a mockup object that provides the same core interface as server-side Database, but forwards all requests to the server
    db = {
        async select(id, opts) {
            /* Load an object from the server via AJAX call. */
            let url = schemat.app.default_path_of(id) + '::json'
            let {data} = await fetch(url).then(response => response.json())     // {id, data} encoded
            return JSON.stringify(data)
        },
        async execute(...args) { return schemat.app.act.db_execute(...args) },
    }
}

// import {check} from "/app/widgets.js"
