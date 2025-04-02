// import { Mutex } from 'async-mutex'

import fs from 'node:fs'
import {AsyncLocalStorage} from 'node:async_hooks'

import {assert, print, T} from '../common/utils.js'
import {Schemat} from './schemat.js'
import {RequestContext} from "../web/request.js";


/**********************************************************************************************************************/

export class Transaction {
    /* Metadata about an action being executed against multiple objects in the database.
       IMPORTANT: at the moment, actions (transactions) are NOT atomic!
     */

    records = []        // array of {id, data} records of modified objects

    register_modification(rec) {
        this.records.push(rec)
        // TODO: detect duplicates, restrict the size of `records`
    }
}


/**********************************************************************************************************************
 **
 **  Server-side REGISTRY
 **
 */

export class ServerSchemat extends Schemat {

    // sessionMutex = new Mutex()  // a mutex to lock cache for only one concurrent session (https://github.com/DirtyHairy/async-mutex);
    //                             // new requests wait until the current session completes, see Session.start()

    kernel          // KernelProcess that runs the main Schemat loop of the current master/worker process
    parent          // parent ServerSchemat that created this one via .fork() below

    _db             // bootstrap DB; regular server-side DB is taken from site.database
    _cluster        // Cluster object of the previous generation, always present but not always the most recent one (Registry may hold a more recent version)
    _transaction    // AsyncLocalStorage that holds a Transaction describing the currently executed DB action


    get db()     { return this.system?.database || this._db }
    get tx()     { return this._transaction.getStore() }
    get node()   { return this.kernel?.node }       // host Node (web object) of the current process; initialized and periodically reloaded in Server
    get cluster(){ return this.get_if_loaded(this._cluster?.id) || this._cluster }


    /***  Initialization  ***/

    constructor(config, parent) {
        super(config)
        if (parent) this._clone(parent)

        this.ROOT_DIRECTORY = process.cwd()                 // initialize ROOT_DIRECTORY from the current working dir
        // this.SCHEMAT_DIRECTORY = this.ROOT_DIRECTORY + '/schemat'

        // check that it points to the installation's root folder and contains `schemat` subfolder with `config.yaml` file in it
        assert(fs.existsSync(this.ROOT_DIRECTORY + '/schemat/config.yaml'), 'The current working directory does not contain ./schemat/config.yaml file')

        this._transaction = new AsyncLocalStorage()
        // this.loader = new Loader(import.meta.url)
    }

    _clone(parent) {
        this.parent = parent
        this.kernel = parent.kernel
    }

    async boot(boot_db) {
        /* Initialize built-in objects, site_id, site, bootstrap DB. */
        await this._init_classpath()
        this._db = await boot_db?.() || this.parent.db      // bootstrap DB, created anew or taken from parent; the ultimate DB is opened later: on the first access to this.db

        let cluster_id = this.config.cluster
        if (cluster_id) {
            print(`loading cluster ${cluster_id} ...`)
            this._essential.push(cluster_id)
            this._cluster = await this.get_loaded(cluster_id)
        }

        await super._load_site()
        await this._purge_registry()        // purge the cache of bootstrap objects and schedule periodical re-run

        await this.site?.reload()           // repeated site reload is needed for site.global initialization which fails on first attempt during bootstrap
        // if (this.site) await this.reload(this.site_id, true)

        delete this._db                     // allow garbage collection

        // print(`boot() system:`, this.system.__label)
        // print(`boot() this.db:`, this.db.__label)
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
        return `import {Client} from "/$/local/schemat/web/client.js"; globalThis.schemat = new Client("#${id_context}"); await schemat.boot();`
    }

    set_kernel(kernel) { this.kernel = kernel }


    /***  Registry  ***/

    async _purge_registry(generation = 0, ERASE_TIMEOUT = 20) {
        /* Purge the objects cache in the registry. Schedule periodical re-run: the interval is configured
           in site.cache_purge_interval and may change over time.
         */
        // print(`Schemat._purge_registry() generation ${generation}`)
        if (this.is_closing) return

        try {
            // this._report_memory()
            if (generation >= ERASE_TIMEOUT) {
                generation = 0
                return this._erase_registry()
            }
            return this.registry.purge()
        }
        finally {
            let interval = (this.site?.cache_purge_interval || 10) * 1000        // [ms]  ... TODO: move cache_purge_interval to cluster
            setTimeout(() => this._purge_registry(generation + 1), interval)
        }
    }

    async _erase_registry() {
        /* Once in a while, clear the object cache entirely (except `site` and `root category`!) to cut links between subsequent
           generations of instances and allow efficient garbage-collection in presence of cyclic links between different web objects.
         */
        print(`Schemat._erase_registry(), ${this.registry.objects.size} objects ...`)
        this._cluster = this.cluster
        this._site = this.site

        assert(this._cluster.is_loaded() && (!this._site || this._site.is_loaded()))

        this.registry.erase()

        if (this._cluster) await this.reload(this._cluster.id, true)
        if (this._site) await this.reload(this._site.id, true)

        // print(`_erase_registry() site:`, this.site?.__label, this.site?.__hash)
        // print(`_erase_registry() this.db:`, this.db.__label, this.db.__hash)
    }


    /***  Life cycle  ***/

    with_context(handler) {
        /* Wrap up the `handler` function in async context that sets global schemat = this (via _schemat async store).
           This should be applied to all event handlers when registering them on TCP/HTTP sockets, IPC channels etc.,
           because Node.js does NOT recreate async context from the point of registration when calling these handlers.
         */
        return (...args) => _schemat.run(this, () => handler(...args))
    }

    async fork(site, callback) {
        /* Run `callback` function inside a new async context (_schemat) cloned from this one but having a different schemat.site. */
        let new_schemat = new ServerSchemat({...this.config, site: site.id}, this)
        let result = await _schemat.run(new_schemat, async () => {
            print(`ServerSchemat.fork() ...`)
            await new_schemat.boot()
            return callback()
        })
        return [result, new_schemat]
    }

    /***  Agents  ***/

    get_frame(id_or_obj) {
        /* Find and return the current execution frame of an agent. */
        let id = (typeof id_or_obj === 'object') ? id_or_obj.id : id_or_obj
        return this.kernel.frames.get(id)
    }

    get_state(id_or_obj) {
        /* Find and return the current execution state of an agent. */
        return this.get_frame(id_or_obj)?.state
    }


    /***  Database  ***/

    _db_select(id, opts) { return this.db.select(id, opts) }

    async *scan_category(category_or_id = null, {load=false, ...opts} = {}) {
        /* Generate a stream of objects found in a given category, or all objects if no first argument is given.
           `category_or_id` should be a Category object (not necessarily loaded), or an ID.
         */
        let full_scan = (category_or_id === null)
        let target = (typeof category_or_id === 'number') ? category_or_id : category_or_id?.id     // ID of the target category, or undefined (all categories)
        let start = !full_scan && [target]                                              // [target] is a 1-element record compatible with the index schema
        let stop  = !full_scan && [target + 1]
        let records = this.db.scan('idx_category', {start, stop, ...opts})   // stream of plain Records

        for await (const record of records) {
            let {__cid, id} = record.object_key
            assert(full_scan || target === __cid)
            yield load ? this.get_loaded(id) : this.get_object(id)
        }
    }

    async list_category(category_or_id = null, opts = {}) {
        /* Return an array of objects found in a given category, or all objects if no category is specified.
           `category_or_id` should be a Category object (not necessarily loaded), or an ID. `opts` are the same as for
           `scan_category` and may include, among others: `load`, `limit`, `offset`, `reverse`.
           NOT ISOMORPHIC. This method loads each object one by one. For this reason, it should only be used on server.
         */
        let _opts = {...opts, load: false}              // it is better to load objects *after* scan, concurrently
        let objects = []
        for await (const obj of this.scan_category(category_or_id, _opts))
            objects.push(obj)
        return opts.load ? Promise.all(objects.map(obj => obj.load())) : objects
    }

    // async *_scan_all({limit} = {}) {
    //     /* Scan the main data sequence in DB. Yield items, loaded and registered in the cache for future use. */
    //     let count = 0
    //     for await (const record of this.db.scan_all()) {                            // stream of ItemRecords
    //         if (limit !== undefined && count++ >= limit) break
    //         let item = await WebObject.from_record(record)
    //         yield this.registry.set_object(item)
    //     }
    // }


    /***  Actions / Transactions  ***/

    tx_run(action) {
        /* Execute the action() function in the context of a Transaction object: this.tx (if present) or a newly-created one.
           Return a pair: [transaction-object, result-of-action], where the latter can be a Promise if action() is async.
           After the action() is executed (awaited), the transaction object contains info about the execution, like a list of objects modified.
         */
        let tx = this.tx
        if (tx) return [tx, action()]

        tx = new Transaction()
        return [tx, this._transaction.run(tx, action)]
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