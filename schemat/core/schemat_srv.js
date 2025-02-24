// import { Mutex } from 'async-mutex'

import fs from 'node:fs'
import {AsyncLocalStorage} from 'node:async_hooks'

import {assert, print, T} from '../common/utils.js'
import {Schemat} from './schemat.js'
import {RequestContext} from "../web/request.js";
import {DataRequest} from "../db/data_request.js";


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

    process         // Process instance that runs the main Schemat loop of the current master/worker process

    _db             // bootstrap DB; regular server-side DB is taken from site.database
    _transaction    // AsyncLocalStorage that holds a Transaction describing the currently executed DB action

    get db()     { return this.site?.database || this._db }
    get tx()     { return this._transaction.getStore() }
    get node()   { return this.process.node }       // host Node (web object) of the current process; initialized and periodically reloaded in Server
    get agents() { return this.process.contexts }   // execution contexts of currently running agents


    constructor(config) {
        super(config)

        this.ROOT_DIRECTORY = process.cwd()                 // initialize ROOT_DIRECTORY from the current working dir
        // this.SCHEMAT_DIRECTORY = this.ROOT_DIRECTORY + '/schemat'

        // check that it points to the installation's root folder and contains `schemat` subfolder with `config.yaml` file in it
        assert(fs.existsSync(this.ROOT_DIRECTORY + '/schemat/config.yaml'), 'The current working directory does not contain ./schemat/config.yaml file')

        this._transaction = new AsyncLocalStorage()
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
        return `import {Client} from "/$/local/schemat/web/client.js"; await new Client("#${id_context}").boot();`
    }

    _select(id) {
        let req = new DataRequest(null, 'load', {id})
        return this.db.select(req)
    }


    /***  Indexes  ***/

    async *scan_category(category_or_id = null, {load=false, ...opts} = {}) {
        /* Generate a stream of objects found in a given category, or all objects if no first argument is given.
           `category_or_id` should be a Category object (not necessarily loaded), or an ID.
         */
        let full_scan = (category_or_id === null)
        let target = (typeof category_or_id === 'number') ? category_or_id : category_or_id?.__id       // ID of the target category, or undefined (all categories)
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