// import { Mutex } from 'async-mutex'

import {assert, print, T} from '../common/utils.js'
import {set_global} from "../common/globals.js";
import {Schemat} from './schemat.js'
import {ROOT_ID} from "../item.js"
import {Loader} from "../server/loader.js"


/**********************************************************************************************************************
 **
 **  Server-side REGISTRY
 **
 */

export class ServerSchemat extends Schemat {

    // sessionMutex = new Mutex()  // a mutex to lock cache for only one concurrent session (https://github.com/DirtyHairy/async-mutex);
    //                             // new requests wait until the current session completes, see Session.start()

    PATH_LOCAL_SUN = "/system/local"    // SUN folder that maps to the local filesystem folder, PATH_LOCAL_FS;
    PATH_LOCAL_FS                       // scripts from PATH_LOCAL_* can be imported by system items during startup

    loader = null                       // Loader for dynamically loading JS modules from the SUN namespace

    constructor(path) {
        super()
        this.PATH_LOCAL_FS = path       // no trailing '/' (!)

        this.loader = new Loader()

        // schedule periodical cache eviction; the interval is taken from site.cache_purge_interval and may change over time
        setTimeout(() => this._purge_registry(), 1000)
    }

    async _reset_class(ServerSchemat) {
        /* Re-import the class of this Schemat object using dynamic imports from the SUN path; in this way,
           all other imports in the dependant modules will be interpreted as SUN imports, as well.
           Reinitialize `classpath` so that builtin classes are also imported from the SUN namespace.
         */
        // let {ServerSchemat} = await this.import('/system/local/core/schemat_srv.js')
        T.setClass(this, ServerSchemat)
        await this._init_classpath()
        // await this.reload(this.site_id)
        print('ServerSchemat class reloaded')
    }


    async _purge_registry() {
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
