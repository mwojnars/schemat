import "../common/globals.js"           // global flags: CLIENT, SERVER

import {assert, print} from "../common/utils.js";
import {Schemat} from "../core/schemat.js";
import {ClientSession} from "../core/session.js"
import {ShadowRequest} from "./request.js"


/**********************************************************************************************************************/

export class Client extends Schemat {
    /* Client-side global Schemat object. Used in .init_client() of the server-side Schemat. */

    target          // target web object that was addressed by the request, loaded; can be undefined
    object          // ... alias

    constructor(dump) {
        let shadow = ShadowRequest.decode(dump)
        print('shadow request:', shadow)
        super(shadow)
        this.request = shadow
    }

    async boot() {
        let shadow = this.request
        shadow.objects.map(rec => schemat.register_record(rec))    // register {id,data} records of bootstrap objects

        await this._init_classpath()
        await super._load_app()
        await this._boot_done()
        // setInterval(() => this._report_memory(), 10000)

        this.object = this.target = await shadow.finalize()
        this.session = new ClientSession()
        // check()
    }

    // a mockup object that provides the same core interface as server-side Database, but forwards all requests to the server
    db = {
        async select(id, opts) {
            /* Load an object from server via AJAX call. */
            let {data} = await schemat.fetch_system(`json/${id}`, {json: true})     // {id, data} encoded
            return JSON.stringify(data)
        },
        async execute(...args) { return schemat.app.act.db_execute(...args) },
    }
}

// import {check} from "/app/widgets.js"
