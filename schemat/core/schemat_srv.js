// import { Mutex } from 'async-mutex'

import fs from 'node:fs'

import {assert, print, T} from '../common/utils.js'
import {Schemat} from './schemat.js'
import {ROOT_ID} from "./item.js"


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
        this.ROOT_DIRECTORY = process.cwd()             // initialize ROOT_DIRECTORY from the current working dir...

        // check that it points to the installation's root folder and contains `schemat` subfolder with `config.yaml` file in it
        assert(fs.existsSync(this.ROOT_DIRECTORY + '/schemat/config.yaml'), 'The current working directory does not contain ./schemat/config.yaml file')

        // this.loader = new Loader(import.meta.url)
    }

    async _init_site() {
        await super._init_site()

        // schedule periodical cache eviction; the interval is taken from site.cache_purge_interval and may change over time
        setTimeout(() => this._purge_registry(), 1000)
    }

    async _reset_class(ServerSchemat) {
        /* Re-import the class of this Schemat object using dynamic imports from the SUN path; in this way,
           all other imports in the dependant modules will be interpreted as SUN imports, as well.
           Reinitialize `classpath` so that builtin classes are also imported from the SUN namespace.
         */
        // let {ServerSchemat} = await this.import('/system/local/schemat/core/schemat_srv.js')
        T.setClass(this, ServerSchemat)
        await this._init_classpath()
        // await this.reload(this.site_id)
        print('ServerSchemat class reloaded')
    }


    async _purge_registry() {
        if (this.is_closing) return
        try {
            return this.registry.purge(this._on_evict.bind(this))
        }
        finally {
            const interval = (this.site?.cache_purge_interval || 1) * 1000      // [ms]
            setTimeout(() => this._purge_registry(), interval)
        }
    }

    _on_evict(obj) {
        /* Special handling for the root category and `site` object during registry purge. */
        if (obj._id_ === ROOT_ID) return this.reload(ROOT_ID)           // make sure that the root category object is present at all times and is (re)loaded, even after eviction
        if (obj._id_ === this.site._id_)
            return this.reload(this.site)                               // ...same for the `site` object
    }


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