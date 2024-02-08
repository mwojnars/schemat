import { Mutex } from 'async-mutex'

import { assert, print, T } from './common/utils.js'
import { Registry } from './schemat.js'
import {ROOT_ID} from "./item.js";


/**********************************************************************************************************************
 **
 **  Server-side REGISTRY
 **
 */

export class ServerRegistry extends Registry {

    // sessionMutex = new Mutex()  // a mutex to lock Registry for only one concurrent session (https://github.com/DirtyHairy/async-mutex);
    //                             // new requests wait until the current session completes, see Session.start()

    PATH_LOCAL_SUN = "/system/local"    // SUN folder that maps to the local filesystem folder, PATH_LOCAL_FS;
    PATH_LOCAL_FS                       // scripts from PATH_LOCAL_* can be imported by system items during startup

    constructor(path) {
        super()
        this.PATH_LOCAL_FS = path       // no trailing '/' (!)
    }

    directImportPath(path) {
        /* Convert a /system/local/... import path from SUN to a local filesystem representation. */
        let local = this.PATH_LOCAL_SUN
        if (!path.startsWith(local + '/')) throw new Error(`can use direct import from "${local}" path only, not "${path}"`)
        return this.PATH_LOCAL_FS + path.slice(local.length)
    }

    async import(path, name) {
        assert(this.site, 'the site must be loaded before a high-level import from the SUN is called')
        let module = this.site.importModule(path)
        return name ? (await module)[name] : module
    }

    // async startSession(session) {
    //     let release = await this.sessionMutex.acquire()
    //     assert(!this.session, 'trying to process a new web request when another one is still open')
    //     this.session = session
    //     return release
    // }
    // async stopSession(releaseMutex) {
    //     assert(this.session, 'trying to stop a web session when none was started')
    //     delete this.session
    //     await this.evict_cache()
    //     releaseMutex()
    // }

    async evict_cache() {
        /* Evict expired objects in _cache. */
        await this._cache.evict()
        if (!this._cache.has(ROOT_ID))              // if root category is no longer present in _cache, call _init_root() once again
            await this._init_root()                 // WARN: between evict() and _init_root() there's no root_category defined! problem if a request comes in
    }
}
