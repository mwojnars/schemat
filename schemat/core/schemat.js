import {T, print, assert, DependenciesStack, normalize_path} from '../common/utils.js'
import {Item, Category, ROOT_ID} from './item.js'
import {set_global} from "../common/globals.js";
import {Registry} from "./registry.js";

// import {LitElement, html, css} from "https://unpkg.com/lit-element/lit-element.js?module";


/**********************************************************************************************************************
 **
 **  CLASSPATH
 **
 */

class Classpath {
    /* A cache of built-in Schemat classes that are prefetched from their modules upon startup and made available
       to *synchronous* class-path resolution during serialization and deserialization in JSONx.
       Provides two-way mapping between objects and their paths. The objects (classes) are mapped to regular paths
       of the form: `<js-module-path>:<symbol>`, for example, "schemat/db/block.js:Block".
     */

    cache = new Map()
    inverse = new Map()

    async fetch(module_url, {path: target_path, symbols, accept, exclude_variables = true} = {}) {
        /* Import symbols from a module and add them to the cache. */
        let module = await import(module_url)
        let prefixed_url = `schemat/core/${module_url}`
        let normalized_url = target_path || normalize_path(prefixed_url)

        if (typeof symbols === "string")    symbols = symbols.split(' ')
        else if (!symbols)                  symbols = Object.keys(module)
        if (exclude_variables)              symbols = symbols.filter(s => typeof module[s] === "function")

        for (let name of symbols) {
            let obj = module[name]
            if (accept && !accept(name, obj)) continue
            let path = `${normalized_url}:${name}`
            this.set(path, obj)
        }
    }

    set(path, obj) {
        if (this.cache.has(path)) throw new Error(`the path already exists: ${path}`)
        this.cache.set(path, obj)

        if (typeof obj === "function") {
            if (this.inverse.has(obj)) throw new Error(`a path for the object already exists (${this.inverse.get(obj)}), cannot add another one (${path})`)
            this.inverse.set(obj, path)
        }
    }

    get_object(path) {
        /* Return object pointed to by a given path. */
        let obj = this.cache.get(path)
        if (obj === undefined) throw new Error(`Unknown prefetched path: ${path}`)
        return obj
    }

    get_path(obj) {
        /* Return canonical path of a given class or function, `obj`. If `obj` was added multiple times
           under different names (paths), the most recently assigned path is returned.
        */
        let path = this.inverse.get(obj)
        if (path === undefined) throw new Error(`Not in prefetched: ${obj.name || obj}`)
        return path
    }
}

/**********************************************************************************************************************
 **
 **  SCHEMAT
 **
 */

export class Schemat {
    /* Global (or thread-local) object that exposes Schemat internal API for use by the application code:
       loading and caching of web objects, dynamic module import, classpath management, session management etc.
     */

    _db                             // client-side or bootstrap DB; regular server-side DB is taken from site.database
    site_id                         // ID of the active Site object

    registry = new Registry()       // cache of web objects, records and indexes loaded from DB
    builtin                         // a Classpath containing built-in classes and their paths

    is_closing = false              // true if the Schemat node is in the process of shutting down
    server_side = true              // the current environment: client / server

    get client_side() { return !this.server_side }

    get db() {
        /* The site's database instance, either a Database (on server) or a ClientDB (on client) */
        return (this.server_side && this.site?.database) || this._db
    }

    get root_category() {
        /* The RootCategory object. Always present in cache, always fully loaded. */
        let root = this.registry.get(ROOT_ID)
        assert(root, `RootCategory not found in cache`)
        assert(root.is_loaded(), `RootCategory not loaded`)
        return root
    }

    get site()      { return this.registry.get(this.site_id) }


    // web objects currently being loaded/initialized with a call to .load()
    _loading_stack = new class extends DependenciesStack {
        debug = false

        _head(obj) {
            let id   = `[${obj.__id}]`.padEnd(6)
            let name = this._name(obj).padEnd(15)
            return `${id} ${name}`
        }
        _tail() {
            // IDs and names of all objects currently being loaded
            let ids = this.map(obj => obj.__id)
            let names = this.map(obj => this._name(obj) || obj.__id)
            return `[${ids}]  --  [${names.join(', ')}]`
        }
        _name(obj) {
            if (typeof obj.__self.name === 'string') return obj.__self.name     // watch out for ItemProxy.UNDEFINED
            return obj.__data?.get('name') || ''                                //(obj.is_loaded ? obj.name : obj.__self.name)
        }
    }

    // _load_running -- IDs of objects whose .load() is currently being executed (at most one per ID)
    // _load_awaited -- IDs of objects whose .load() is being awaited, with the number of awaiters


    /***  Initialization  ***/

    constructor() {
        /* Create a new Schemat instance as a global object. */
        assert(!globalThis.schemat, `global Schemat instance already exists`)
        set_global({schemat: this})
        this.Item = Item                    // schemat.Item is globally available for application code
        this.Category = Category            // schemat.Category is globally available for application code
    }

    async boot(site_id, bootstrap_db, open_bootstrap_db = null) {
        /* Initialize built-in objects, site_id, site, bootstrap DB. */

        await this._init_classpath()

        this._db = bootstrap_db             // on server, the ultimate DB is opened later: on the first access to this.db
        await open_bootstrap_db?.()

        // if (cluster_id) {
        //     print(`Loading cluster ${cluster_id}...`)
        //     let cluster = await this.get_loaded(cluster_id)
        //     site_id = cluster.site.__id
        //     print(`Cluster ${cluster_id} loaded, site ID: ${site_id}`)
        // }

        assert(T.isNumber(site_id), `Invalid site ID: ${site_id}`)
        this.site_id = site_id
        await this._init_site()
        // await this._reset_class()
        assert(this.site)
    }

    async _init_classpath() {
        let builtin = this.builtin = new Classpath()

        builtin.set(":Map", Map)                                    // standard JS classes have an empty file part of the path

        await builtin.fetch("../index.js", {path: 'schemat'})       // Schemat core classes, e.g., "schemat:Item"
        await builtin.fetch("../std/files.js")
        await builtin.fetch("../std/site.js")
        await builtin.fetch("../std/containers.js")
        await builtin.fetch("../db/records.js")
        await builtin.fetch("../db/block.js")
        await builtin.fetch("../db/sequence.js")
        await builtin.fetch("../db/indexes.js")
        await builtin.fetch("../db/db.js")

        let accept = (name) => name.toUpperCase() === name
        await builtin.fetch("../types/type.js", {accept})
        await builtin.fetch("../types/catalog.js", {accept})
    }

    async _reset_class() { /* on server only */ }

    async _init_site() {
        /* Load the `site` object and reload the existing (system) objects to make sure that they are fully activated:
           URLs are awaited, classes are imported dynamically from SUN instead of a static classpath.
         */
        await this.reload(this.site_id)
        for (let obj of this.registry)
            if (obj.__data) await this.reload(obj)
            // if (obj.__data && !obj.__url)
            //     await obj.__meta.pending_url
    }


    /***  Access to web objects  ***/

    get_object(id, {version = null} = {}) {
        /* Create a stub of an object with a given ID, or return an existing instance (a stub or loaded), if present in the cache.
           If a stub is created anew, it is saved in cache for reuse by other callers.
         */
        // this.session?.countRequested(id)
        let obj = this.registry.get(id) || this.registry.set(Item.create_stub(id))          // a stub has immediate expiry date (i.e., on next cache purge) unless its data is loaded and TLS updated
        assert(!obj.__meta.mutable)
        return obj
    }

    async get_loaded(id)     { return this.get_object(id).load() }

    async reload(obj_or_id) {
        /* Create a new instance of the object, load its data from DB, and when it is fully initialized
           replace the existing instance in the registry. Return the new object.
         */
        let id  = T.isNumber(obj_or_id) ? obj_or_id : obj_or_id.__id
        let obj = Item.create_stub(id)
        return obj.load().then(() => this.registry.set(obj))
    }


    /***  Indexes  ***/

    async *scan_category(category_or_id = null, {loaded=false, ...opts} = {}) {
        /* Generate a stream of objects found in a given category, or all objects if no first argument is given.
           `category_or_id` should be a Category object (not necessarily loaded), or an ID.
         */
        let full_scan = (category_or_id === null)
        let target = (typeof category_or_id === 'number') ? category_or_id : category_or_id?.__id       // ID of the target category, or undefined (all categories)
        let start = !full_scan && [target]                                              // [target] is a 1-element record compatible with the index schema
        let stop  = !full_scan && [target + 1]
        let records = this.db.scan_index('idx_category_item', {start, stop, ...opts})   // stream of plain Records

        for await (const record of records) {
            let {cid, id} = record.object_key
            assert(full_scan || target === cid)
            yield loaded ? this.get_loaded(id) : this.get_object(id)
        }
    }

    async list_category(category = null, opts = {}) {
        /* Return an array of objects found in a given category, or all objects if no `category` is given.
           `category` should be a Category object (not necessarily loaded), or an ID. `opts` are the same as for `scan_category`
           and may include, among others: `loaded`, `limit`, `offset`, `reverse`.
         */
        let objects = []
        for await (const obj of this.scan_category(category, opts))
            objects.push(obj)
        return objects
    }

    // async *_scan_all({limit} = {}) {
    //     /* Scan the main data sequence in DB. Yield items, loaded and registered in the cache for future use. */
    //     let count = 0
    //     for await (const record of this.db.scan_all()) {                            // stream of ItemRecords
    //         if (limit !== undefined && count++ >= limit) break
    //         let item = await Item.from_record(record)
    //         yield this.registry.set(item)
    //     }
    // }


    /***  Object <> classpath mapping (for de/serialization)  ***/

    get_classpath(cls) {
        /* Return a dotted module path of a given class or function as stored in a global Classpath.
           `cls` should be either a constructor function, or a prototype with .constructor property.
         */
        if (typeof cls === "object")            // if `cls` is a class prototype, take its constructor instead
            cls = cls.constructor
        if (!cls) throw `Argument is empty or not a class: ${cls}`

        return this.builtin.get_path(cls)
    }

    get_builtin(path) {
        /* Retrieve a built-in class by its path of the form: <module-path>:<class-name>. */
        return this.builtin.get_object(path)
    }

    import(path) {
        /* May return a Promise. */
        if (path.startsWith('schemat:') || !this.site?.is_loaded)
            return this.get_builtin(path)
        return this.site.import_dynamic(path)
    }

    /***  Dynamic import from SUN  ***/

    // async import(path, name) {
    //     /* Import a module and (optionally) its element, `name`, from a SUN path, or from a regular JS path.
    //        Uses the site's routing mechanism to locate the `path` anywhere across the SUN namespace.
    //        Can be called client-side and server-side alike.
    //        IMPORTANT: a new global context is created every time a module is imported using this method,
    //                   so this method should be called only ONCE when the process is starting.
    //      */
    //     let module = this.client_side ? import(this._js_import_url(path)) : this.loader.import(path)
    //     return name ? (await module)[name] : module
    // }
    //
    // _js_import_url(path) {
    //     /* Schemat's client-side import path converted to a standard JS import URL for importing remote code from SUN namespace. */
    //     return path + '::import'
    // }


    /***  Events & Debugging  ***/

    before_data_loading(obj, MAX_LOADING = 10) {
        /* Called at the beginning of data loading in an object, obj._load(). */
        this._loading_stack.push(obj)
        // if (count > MAX_LOADING) throw new Error(`Too many objects loading at once: ${count}`)
    }

    after_data_loading(obj) {
        /* Called at the end of data loading in an object, obj._load(). */
        this._loading_stack.pop(obj)
    }
}

