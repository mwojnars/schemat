// import { Mutex } from 'async-mutex'

import fs from 'node:fs'

import {assert, print, T} from '../common/utils.js'
import {Schemat} from './schemat.js'
import {RequestContext} from "../web/request.js";


/**********************************************************************************************************************
 **
 **  Server-side REGISTRY
 **
 */

export class ServerSchemat extends Schemat {

    // sessionMutex = new Mutex()  // a mutex to lock cache for only one concurrent session (https://github.com/DirtyHairy/async-mutex);
    //                             // new requests wait until the current session completes, see Session.start()

    constructor() {
        super()

        this.ROOT_DIRECTORY = process.cwd()                 // initialize ROOT_DIRECTORY from the current working dir
        // this.SCHEMAT_DIRECTORY = this.ROOT_DIRECTORY + '/schemat'

        // check that it points to the installation's root folder and contains `schemat` subfolder with `config.yaml` file in it
        assert(fs.existsSync(this.ROOT_DIRECTORY + '/schemat/config.yaml'), 'The current working directory does not contain ./schemat/config.yaml file')

        // this.loader = new Loader(import.meta.url)
    }

    client_block(request, id_context, ...objects) {
        /* HTML code to be placed in an HTML page by the server, to load `schemat` on the client side upon page load.
           If used inside an EJS template, the output string must be inserted unescaped (!), typically with <%- tag instead of <%=
                <%- schemat.client_block(request, '#context-path') %>
           `id_context` must be an ID of the HTML element of the result page where RequestContext for the client-side Schemat is to be written.
         */
        if (!id_context) throw new Error(`id_context is missing: ID of the HTML element containing request context must be provided`)
        assert(!id_context.includes('"'))
        assert(!id_context.includes('#'))

        let ctx = RequestContext.from_request(request, ...objects)
        let script = `<script async type="module">${this.init_client(id_context)}</script>`
        let context = `<p id="${id_context}" style="display:none">${ctx.encode()}</p>`

        return context + '\n' + script
    }

    init_client(id_context) {
        return `import {Client} from "/$/local/schemat/web/client.js"; await new Client().boot_from("#${id_context}");`
    }


    // async _reset_class(ServerSchemat) {
    //     /* Re-import the class of this Schemat object using dynamic imports from the SUN path; in this way,
    //        all other imports in the dependant modules will be interpreted as SUN imports, as well.
    //        Reinitialize `classpath` so that builtin classes are also imported from the SUN namespace.
    //      */
    //     // let {ServerSchemat} = await this.import('/$/local/schemat/core/schemat_srv.js')
    //     T.setClass(this, ServerSchemat)
    //     await this._init_classpath()
    //     // await this.reload(this.site_id)
    //     print('ServerSchemat class reloaded')
    // }

    /***  Events  ***/

    // async before_request(session) {
    //     let release = await this.sessionMutex.acquire()
    //     assert(!this.session, 'trying to process a new web request when another one is still open')
    //     this.session = session
    //     return release
    // }
    // async after_request(releaseMutex) {
    //     assert(this.session, 'trying to stop a web session when none was started')
    //     delete this.session
    //     await this.evict_cache()
    //     releaseMutex()
    // }
}