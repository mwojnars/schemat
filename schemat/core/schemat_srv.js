// import { Mutex } from 'async-mutex'

import fs from 'node:fs'
import {AsyncLocalStorage} from 'node:async_hooks'

import {assert, print} from '../common/utils.js'
import {Schemat} from './schemat.js'
import {RequestContext} from "../web/request.js";
import {ServerTransaction} from "./transact.js";


/**********************************************************************************************************************
 **
 **  Server-side REGISTRY
 **
 */

export class ServerSchemat extends Schemat {

    // sessionMutex = new Mutex()  // a mutex to lock cache for only one concurrent session (https://github.com/DirtyHairy/async-mutex);
    //                             // new requests wait until the current session completes, see Session.start()

    GENERIC_ROLE = "$agent"     // special role name for RPC calls to agent objects

    kernel          // Kernel that runs the main Schemat loop of the current master/worker process
    parent          // parent ServerSchemat that created this one via .fork() below
    cluster_id      // ID of the active Cluster object

    _boot_db        // boot Database: its presence indicates the boot phase is still going on
    _db             // ultimate Database: loaded from _boot_db, then reloaded periodically

    _cluster        // Cluster object of the previous generation, remembered here to keep the .cluster() getter operational during complete cache erasure
    _transaction    // AsyncLocalStorage that holds a Transaction describing the currently executed DB action

    get db()        { return this._boot_db || this._db }
    get tx()        { return this._transaction.getStore() }
    get node()      { return this.kernel?.node }        // host Node (web object) of the current process; initialized and periodically reloaded in Server
    get cluster()   { return this.get_if_loaded(this._cluster?.id, obj => {this._cluster = obj}) || this._cluster }
    get std()       { return this.root_category.std }   // standard categories and objects from ring-kernel

    kernel_context          // db.id of the kernel database, initialized in the kernel's ServerSchemat and inherited by child contexts
    get current_context()   { return this._db.id }
    in_kernel_context()     { return !this.app_id }

    // below, empty `app_id` (undefined or null) indicates a request for the kernel context
    static get_context(app_id)   { return globalThis._contexts.get(app_id || null) }
    static set_context(_schemat) { globalThis._contexts.set(_schemat.app_id || null, _schemat) }

    _print(...args) { print(`${this.node?.id}/#${this.kernel?.worker_id}`, ...args) }


    /***  Initialization  ***/

    static global_init() {
        /* Operations below are done once per node process, even if multiple Schemat instances (contexts) are created later. */
        if (globalThis._schemat) return

        // global `schemat` is a getter that reads the current Schemat object from the async store `_schemat`
        Object.defineProperty(globalThis, 'schemat', {
            get() { return this._schemat.getStore() },
            enumerable: true
        })
        globalThis._schemat = new AsyncLocalStorage()
        globalThis._contexts = new Map()        // app_id -> schemat_instance; kernel context stored under `null` key
    }

    constructor(config, parent = null, boot_db = null) {
        super(config)
        if (parent) this._clone(parent)

        this._boot_db = boot_db || this.parent?.db      // can be missing
        this._db = boot_db                              // can be missing

        assert(ServerSchemat.get_context(this.app_id) === undefined, `ServerSchemat context for app_id=${this.app_id} is already registered`)
        ServerSchemat.set_context(this)

        this.PATH_WORKING = process.cwd()               // initialize PATH_WORKING from the current working dir
        this.PATH_CLUSTER = this.PATH_WORKING + '/cluster'
        // this.PATH_SCHEMAT = this.PATH_WORKING + '/schemat'

        // check that PATH_WORKING points to the Schemat root folder
        assert(fs.existsSync(this.PATH_WORKING + '/schemat/core/schemat.js'), 'working directory does not contain the Schemat installation with ./schemat source tree')

        this._transaction = new AsyncLocalStorage()
        // this.loader = new Loader(import.meta.url)
    }

    _clone(parent) {
        this.parent = parent
        this.kernel = parent.kernel
        this.builtin = parent.builtin
        this.kernel_context = parent.kernel_context
    }

    async boot(create_boot_db = null, auto = true) {
        /* Initialize built-in objects, app, bootstrap DB. */
        if (!this.builtin) await this._init_classpath()

        // bootstrap DB: provided by the caller in constructor(), taken from parent, or created anew; the ultimate DB is opened later: on the first access to this.db
        this._boot_db ??= await create_boot_db?.()
        assert(this._boot_db.is_loaded())

        let cluster_id = this.cluster_id = this.config.cluster
        if (cluster_id && !this.app_id) {
            print(`loading cluster ${cluster_id} ...`)
            this._essential.push(cluster_id)
            this._cluster = await this.get_loaded(cluster_id)
        }
        else await super._load_app()

        // only the very first _boot_db (when loading the cluster) is a newborn object; later, when child contexts are created,
        // their _boot_db is already the final db, so this._db is initialized in constructor()
        this._db ??= await this._cluster.database.load()
        assert(this._db.is_loaded())

        if (!this.parent) { assert(!this.app_id); this.kernel_context = this._db.id }
        // print(`kernel_context created:`, this.kernel_context)

        await this._purge_registry()        // purge the cache of bootstrap objects and schedule periodical re-run
        await this.app?.reload()            // repeated app reload is needed for app.global initialization which fails on the first attempt during bootstrap
        // if (this.app) await this.reload(this.app_id, true)

        if (auto) this._boot_done()         // remove _boot_db so the target DB is being used from now on

        // print(`boot() this.db:`, this.db.__label)
        return this
    }

    async _boot_done() {
        delete this._boot_db        // mark the end of the boot phase; allow garbage collection of _boot_db
        await super._boot_done()
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

    _reload_db_timer_id     // used by _reload_db() below

    async _reload_db() {
        /* Dedicated method to reload this._db, which is a special object and needs special handling.
           Normally, this method schedules its next execution automatically, but it is also possible and correct to invoke it manually.
         */
        clearTimeout(this._reload_db_timer_id)      // in case of a manual invocation, the previous timer should be cleared
        this._db = await this._db.reload()
        let timeout = (this._db.__ttl || 60.0) * 1000 + 0.01
        this._reload_db_timer_id = setTimeout(() => this._reload_db(), timeout)
    }

    async _purge_registry(generation = 0, ERASE_TIMEOUT = 20) {
        /* Purge the object cache in the registry. Schedule periodical re-run: the interval is configured
           in app.cache_purge_interval and may change over time.
         */
        // print(`Schemat._purge_registry() generation ${generation}`)
        if (this.terminating) return

        try {
            // this._report_memory()
            if (generation >= ERASE_TIMEOUT) {
                generation = 0
                return this._erase_registry()
            }
            return this.registry.purge()
        }
        finally {
            let interval = (this.app?.cache_purge_interval || 10) * 1000        // [ms]  ... TODO: move cache_purge_interval to cluster/node/config
            setTimeout(() => this._purge_registry(generation + 1), interval)
        }
    }

    async _erase_registry() {
        /* Once in a while, clear the object cache entirely to cut links between subsequent generations of instances
           and allow efficient garbage-collection in the presence of cyclic links between different web objects.
         */
        this.node._print(`Schemat._erase_registry() app=${this.app}, ${this.registry.objects.size} objects ...`)

        this._cluster = this.cluster
        this._app = this.app
        assert((!this._cluster || this._cluster.is_loaded()) && (!this._app || this._app.is_loaded()))

        this.registry.erase()
        this._db = await this._db.reload()
    }


    /***  Context management  ***/

    with_context(handler) {
        /* Wrap up the `handler` function in async context that sets global schemat = this (via _schemat async store).
           This should be applied to all event handlers when registering them on TCP/HTTP sockets, IPC channels etc.,
           because Node.js does NOT recreate async context from the point of registration when calling these handlers.
         */
        return (...args) => _schemat.run(this, () => handler(...args))
    }

    async in_context(db_id, callback) {
        /* Run callback() in the Schemat async context (`_schemat`) built around a specific database & app.
           If not yet created, this context (ServerSchemat instance) is created now and saved in
           globalThis._contexts for reuse by other requests. If `app_id` is missing, `this` is used as the context.
           If the current `schemat` is already the target context, the callback is executed directly without
           starting a new async context.

           This method is used to set a custom request-specific context for RPC calls to agent methods.
         */
        if (!db_id && this.in_kernel_context()) return callback()
        if (db_id === this.current_context) return callback()

        // this._print(`in_context() current_context=${this.current_context} db_id=${db_id}`)
        let app_id, db
        if (db_id) {
            db = (typeof db_id === 'object') ? db_id : this.get_object(db_id)
            if (!db.is_loaded()) await db.load()
            app_id = db?.application?.id
            // this._print(`in_context() this.app_id=${this.app_id} app_id=${app_id}`)
        }

        let context = ServerSchemat.get_context(app_id)
        // this._print(`in_context() found existing context: ${!!context}`)

        if (!context) {
            context = new ServerSchemat({...this.config, app: app_id}, this, db)
            await _schemat.run(context, () => context.boot())

            // let promise = _schemat.run(context, () => context.boot())
            // globalThis._contexts.set(app_id, promise)          // to avoid race condition
            // globalThis._contexts.set(app_id, await promise)
        }
        // else if (context.booting) await context.booting
        // else if (context instanceof Promise) context = await context

        // this._print(`in_context() context.app_id=${context.app_id} .db=${context._db.id}`)
        // this._print(`globalThis._contexts:\n`, globalThis._contexts)
        return _schemat.run(context, callback)

        // return schemat === context ? callback() : await _schemat.run(context, callback)
    }

    /***  Agents  ***/

    get_frame(id_or_obj, role = null) {
        /* Find and return the current execution frame of an agent. */
        let id = (typeof id_or_obj === 'object') ? id_or_obj.id : id_or_obj
        role ??= schemat.GENERIC_ROLE

        // search for any role when the requested role is "$agent" or missing
        if (role === schemat.GENERIC_ROLE) return this.kernel.frames.get_any_role(id)

        return this.kernel.frames.get([id, role])
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
        let records = this.db.scan('idx-category', {start, stop, ...opts})   // stream of plain Records

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

    async execute_action(obj, action, args, _return_tx = true) {
        /* Server-side execution of an action. No network communication, no encoding/decoding of args & result.
           Returns a pair: [result, tx].
         */
        if (!obj.is_loaded()) await obj.load()
        let tx = this.tx || new ServerTransaction()     // use the current transaction, if present, or create a new one

        obj._print(`execute_action(${action}) ...`)

        let result = await this.in_transaction(tx, async () => {
            let res = await obj._execute_action(action, args)
            await tx.commit()
            return res
        })

        obj._print(`execute_action(${action}) done: result=${result} tx=${JSON.stringify(tx)}`)
        return _return_tx ? [result, tx] : result
    }

    get_transaction() {
        /* Return the current Transaction object or create a new one. */
        return this.tx || new ServerTransaction()
    }

    load_transaction(dump) { return ServerTransaction.load(dump) }

    in_transaction(tx, action) {
        /* Execute action() in the context of a Transaction object: this.tx === tx.
           After that, the transaction object contains info about the execution, like a list of objects modified.
         */
        return (!tx || tx === this.tx) ? action() : this._transaction.run(tx, action)
    }

    in_tx_context(ctx, tx, callback) {
        /* Run callback() inside a double async context created by first setting the global `schemat`
           to the context built around `ctx`, and then setting schemat.tx to `tx`. Both arguments are optional.
         */
        return this.in_context(ctx, tx ? () => schemat.in_transaction(tx, callback) : callback)
    }


    // async _reset_class(ServerSchemat) {
    //     /* Re-import the class of this Schemat object using dynamic imports from the SUN path; in this way,
    //        all other imports in the dependant modules will be interpreted as SUN imports, as well.
    //        Reinitialize `classpath` so that builtin classes are also imported from the SUN namespace.
    //      */
    //     // let {ServerSchemat} = await this.import('/$/local/schemat/core/schemat_srv.js')
    //     T.setClass(this, ServerSchemat)
    //     await this._init_classpath()
    //     // await this.reload(this.app_id)
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

    /***  RPC/RMI  ***/

    async rpc(...args) { return this.node.rpc_send(...args) }    // alias for node.rpc_send(), for direct in-app usage when fine-grained targeting of RPC is needed

}