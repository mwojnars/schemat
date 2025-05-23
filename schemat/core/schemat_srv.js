// import { Mutex } from 'async-mutex'

import fs from 'node:fs'
import {AsyncLocalStorage} from 'node:async_hooks'

import {assert, print, randint} from '../common/utils.js'
import {Schemat} from './schemat.js'
import {RequestContext} from "../web/request.js";
import {Catalog} from "./catalog.js";


/**********************************************************************************************************************/

export class Transaction {
    /* Metadata about an action being executed against multiple objects in the database.
       IMPORTANT: at the moment, actions (transactions) are NOT atomic!
     */

    tid = randint(10000)
    debug               // if true, debug info should be printed/collected while executing this transaction
    records = []        // array of {id, data} records of objects that were created/modified during this transaction

    register_changes(...records) {
        for (let rec of records)
            this.records.push(rec)
        // TODO: detect duplicates, restrict the size of `records`
    }

    dump_records() {
        return this.records.map(({id, data}) => ({id, data:
                (typeof data === 'string') ? JSON.parse(data) :
                (data instanceof Catalog) ? data.encode() : data
        }))
    }

    dump() {
        return {...this, records: this.dump_records()}
    }

    static load({tid, records, debug}) {
        let tx = new Transaction()
        tx.tid = tid
        tx.debug = debug
        tx.records = records
        return tx
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

    kernel          // Kernel that runs the main Schemat loop of the current master/worker process
    parent          // parent ServerSchemat that created this one via .fork() below

    _boot_db        // boot Database, its presence indicates the boot phase is still going on; regular server-side DB is taken from app.database or cluster.database
    _cluster        // Cluster object of the previous generation, always present but not always the most recent one (Registry may hold a more recent version)
    _transaction    // AsyncLocalStorage that holds a Transaction describing the currently executed DB action

    // get db()     { return this.system?.database || this._boot_db }
    get db()     { return this._boot_db || this.system?.database }
    get tx()     { return this._transaction.getStore() }
    get node()   { return this.kernel?.node }       // host Node (web object) of the current process; initialized and periodically reloaded in Server
    get cluster(){ return this.get_if_loaded(this._cluster?.id) || this._cluster }


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
        globalThis._contexts = new Map()
    }

    constructor(config, parent) {
        super(config)
        if (parent) this._clone(parent)

        assert(globalThis._contexts.get(this.app_id) === undefined, `ServerSchemat context for app_id=${this.app_id} is already registered`)
        globalThis._contexts.set(this.app_id, this)

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

    async boot(boot_db, auto = true) {
        /* Initialize built-in objects, app_id, app, bootstrap DB. */
        await this._init_classpath()
        this._boot_db = await boot_db?.() || this.parent.db     // bootstrap DB, created anew or taken from parent; the ultimate DB is opened later: on the first access to this.db

        let cluster_id = this.config.cluster
        if (cluster_id) {
            print(`loading cluster ${cluster_id} ...`)
            this._essential.push(cluster_id)
            this._cluster = await this.get_loaded(cluster_id)
        }

        await super._load_app()
        await this._purge_registry()        // purge the cache of bootstrap objects and schedule periodical re-run

        await this.app?.reload()            // repeated app reload is needed for app.global initialization which fails on first attempt during bootstrap
        // if (this.app) await this.reload(this.app_id, true)

        if (auto) this._boot_done()

        // print(`boot() system:`, this.system.__label)
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

    async _purge_registry(generation = 0, ERASE_TIMEOUT = 20) {
        /* Purge the objects cache in the registry. Schedule periodical re-run: the interval is configured
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
        /* Once in a while, clear the object cache entirely (except `app` and `root category`!) to cut links between subsequent
           generations of instances and allow efficient garbage-collection in presence of cyclic links between different web objects.
         */
        print(`Schemat._erase_registry(), ${this.registry.objects.size} objects ...`)
        this._cluster = this.cluster
        this._app = this.app

        assert(this._cluster.is_loaded() && (!this._app || this._app.is_loaded()))

        this.registry.erase()

        if (this._cluster) await this.reload(this._cluster.id, true)
        if (this._app) await this.reload(this._app.id, true)

        // print(`_erase_registry() app:`, this.app?.__label, this.app?.__hash)
        // print(`_erase_registry() this.db:`, this.db.__label, this.db.__hash)
    }


    /***  Context management  ***/

    with_context(handler) {
        /* Wrap up the `handler` function in async context that sets global schemat = this (via _schemat async store).
           This should be applied to all event handlers when registering them on TCP/HTTP sockets, IPC channels etc.,
           because Node.js does NOT recreate async context from the point of registration when calling these handlers.
         */
        return (...args) => _schemat.run(this, () => handler(...args))
    }

    async in_context(app_id, callback) {
        /* Run callback() in the Schemat async context (`_schemat`) built around a specific app.
           If not yet created, this context (ServerSchemat instance) is created now and saved in
           globalThis._contexts for reuse by other requests. If `app_id` is missing, `this` is used as the context.
           If current `schemat` is already the target context, the callback is executed directly without
           starting a new async context.

           This method is used to set a custom request-specific context for RPC calls to agent methods.
         */
        app_id ??= undefined
        if (typeof app_id === 'object') app_id = app_id.id
        if (app_id === schemat.app_id) return callback()

        // this.kernel._print(`ServerSchemat.in_context() this.app_id = ${this.app_id} ...`)
        let context = app_id ? globalThis._contexts.get(app_id) : this

        if (!context) {
            this.kernel._print(`ServerSchemat.in_context() creating context for [${app_id}]`)
            context = new ServerSchemat({...this.config, app: app_id}, this)

            // globalThis._contexts.set(app_id, context)
            await _schemat.run(context, () => context.boot())

            // let promise = _schemat.run(context, () => context.boot())
            // globalThis._contexts.set(app_id, promise)          // to avoid race condition
            // globalThis._contexts.set(app_id, await promise)
        }
        // else if (context.booting) await context.booting
        // else if (context instanceof Promise) context = await context

        // this.kernel._print(`ServerSchemat.in_context() executing callback`)
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

    get_transaction() {
        /* Return the current Transaction object or create a new one. */
        return this.tx || new Transaction()
    }

    load_transaction(dump) { return Transaction.load(dump) }

    in_transaction(tx, action) {
        /* Execute action() in the context of a Transaction object: this.tx === tx.
           After that, the transaction object contains info about the execution, like a list of objects modified.
         */
        return (tx === this.tx) ? action() : this._transaction.run(tx, action)
    }

    in_tx_context(app_id, tx, callback) {
        /* Run callback() inside a double async context created by first setting the global `schemat`
           to the context built around `app_id`, and then setting schemat.tx to `tx`.
           Both arguments (app_id, tx) are optional.
         */
        return this.in_context(app_id, tx ? () => schemat.in_transaction(tx, callback) : callback)
    }

    // with_transaction(action, tx = null) {
    //     /* Execute the action() function in the context of a Transaction object: tx, or this.tx, or a newly-created one.
    //        Return a pair: [transaction-object, result-of-action], where the latter can be a Promise if action() is async.
    //        After the action() is executed (awaited), the transaction object contains info about the execution, like a list of objects modified.
    //      */
    //     tx ??= this.tx
    //     if (tx && tx === this.tx) return [action(), tx]
    //
    //     tx = new Transaction()
    //     return [this._transaction.run(tx, action), tx]
    // }


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