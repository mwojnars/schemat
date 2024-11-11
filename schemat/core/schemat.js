import {T, print, assert, normalizePath} from '../common/utils.js'
import {DependenciesStack} from '../common/structs.js'
import {WebObject} from './object.js'
import {Category} from './category.js'
import {Registry} from "./registry.js";
import {DataRequest} from "../db/data_request.js";
import {DataRecord} from "../db/records.js";
// import Resources from "../web/resources.js";

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
        let normalized_url = target_path || normalizePath(prefixed_url)

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

    site_id                     // ID of the active Site object
    registry                    // cache of web objects, records and indexes loaded from DB
    builtin                     // a Classpath containing built-in classes and their paths
    is_closing = false          // true if the Schemat node is in the process of shutting down


    get site()      { return this.registry.get_object(this.site_id) }


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
            if (typeof obj.__self.name === 'string') return obj.__self.name     // watch out for Intercept.UNDEFINED
            return obj.__data?.get('name') || ''                                //(obj.is_loaded ? obj.name : obj.__self.name)
        }
    }

    // _load_running -- IDs of objects whose .load() is currently being executed (at most one per ID)
    // _load_awaited -- IDs of objects whose .load() is being awaited, with the number of awaiters


    /***  Initialization  ***/

    constructor() {
        /* Create a new Schemat instance as a global object. */
        assert(!globalThis.schemat, `global Schemat instance already exists`)
        globalThis.schemat = this
        this.WebObject = WebObject          // schemat.WebObject is globally available for application code
        this.Category = Category            // schemat.Category is globally available for application code
        this.registry = new Registry(this._on_evict.bind(this))
    }

    async boot(site_id, boot_db = null) {
        /* Initialize built-in objects, site_id, site, bootstrap DB. */

        await this._init_classpath()

        this._db = await boot_db?.()        // bootstrap DB; the ultimate DB is opened later: on the first access to this.db

        // if (cluster_id) {
        //     print(`Loading cluster ${cluster_id}...`)
        //     let cluster = await this.get_loaded(cluster_id)
        //     site_id = cluster.site.__id
        //     print(`Cluster ${cluster_id} loaded, site ID: ${site_id}`)
        // }

        assert(T.isNumber(site_id), `Invalid site ID: ${site_id}`)
        this.site_id = site_id

        await this.reload(this.site_id)
        assert(this.site)

        await this.site.load_globals()

        // schedule periodical cache eviction; the interval is taken from site.cache_purge_interval and may change over time
        if (SERVER) setTimeout(() => this._purge_registry(), 1000)

        // await this._reset_class()
    }

    async _init_classpath() {
        let builtin = this.builtin = new Classpath()

        builtin.set(":Map", Map)                                    // standard JS classes have an empty file part of the path

        await builtin.fetch("../index.js", {path: 'schemat'})       // Schemat core classes, e.g., "schemat:WebObject"
        await builtin.fetch("../std/files.js")
        await builtin.fetch("../std/site.js")
        await builtin.fetch("../std/containers.js")
        await builtin.fetch("../db/records.js")
        await builtin.fetch("../db/block.js")
        await builtin.fetch("../db/sequence.js")
        await builtin.fetch("../db/indexes.js")
        await builtin.fetch("../db/db.js")
        // await builtin.fetch("../common/errors.js")       // needed if mJsonxError is used for transmitting service errors back to client

        let accept = (name) => name.toUpperCase() === name
        await builtin.fetch("../types/type.js", {accept})
        await builtin.fetch("../types/catalog_type.js", {accept})
    }


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
        if (path.startsWith('schemat:') || !this.site)
            return this.get_builtin(path)
        if (path[0] === '/') return this.site.import_global(path)
        return this.site.import_local(path)
    }


    /***  Access to web objects  ***/

    get_object(id, {version = null} = {}) {
        /* Create a stub of an object with a given ID, or return an existing instance (a stub or loaded), if present in the cache.
           If a stub is created anew, it is saved in cache for reuse by other callers.
         */
        // this.session?.countRequested(id)
        // a stub has immediate expiry date (i.e., on next cache purge) unless its data is loaded and TLS updated;
        // this prevents keeping a large number of unused stubs indefinitely
        let obj = this.registry.get_object(id) || this.registry.set_object(WebObject.stub(id))
        assert(CLIENT || !obj.__meta.mutable)
        return obj
    }

    async get_mutable(...objects_or_ids) {
        /* Create fully-loaded, but mutable, instances of given object(s). Return an array (if multiple args), or a single result object. */
        let objs = objects_or_ids.map(obj => {
            if (!obj) return obj
            let id = typeof obj === 'number' ? obj : obj.__id
            return WebObject.stub(id, {mutable: true}).load()
        })
        return objs.length > 1 ? Promise.all(objs) : objs[0]
    }

    async get_loaded(id)    { return this.get_object(id).load() }
    async load(id)          { return this.get_loaded(id) }      // alias

    async reload(id) {
        /* Create a new instance of the object using the most recent data for this ID as available in the record registry,
           or download it from DB; when the object is fully initialized replace the existing instance in the registry. Return the object.
         */
        let obj = WebObject.stub(id)
        return obj.load().then(() => this.registry.set_object(obj))
    }

    async load_record(id, fast = true) {
        /* Read object's raw data (JSON string) from DB, or from the registry (if present there and fast=true).
           In the former case, the newly retrieved data is saved in the registry for future use.
         */
        assert(id !== undefined)
        // this.session?.countLoaded(id)

        let data = this.registry.get_record(id)
        if (data) return data

        data = await this._select(id)

        this.register_record({id, data}, false)
        return data
    }

    _select(id)     { throw new Error(`not implemented`) }

    async get_version(id, ver) {
        /* Restore a previous version, `ver`, of a given object, or take it from the registry if present. The object returned is fully loaded. */
        let obj = this.registry.get_version(id, ver)
        if (obj) return obj

        obj = await this.get_loaded(id)
        while (obj?.__ver && obj.__ver > ver) {         // start with the most recent version and move back through previous revisions...
            let rev = obj.__prev
            if (!rev) break
            if (!rev.is_loaded()) await rev.load()
            obj = await rev.restore()
            this.register_version(obj)
        }

        if (obj?.__ver === ver) return obj
        throw new Error(`version ${ver} not found for object [${id}]`)
    }


    /***  Registry management  ***/

    register_record(record /*DataRecord or {id,data}*/, invalidate = true) {
        /* Keep `record` as the most up-to-date (raw) representation of the corresponding object that will be used on the next object (re)load.
           `data` is either a JSON string, or an encoded (plain) representation of a Catalog instance.
         */
        let id, data
        if (record instanceof DataRecord) ({id, data_json: data} = record)
        else ({id, data} = record)

        this.registry.set_record(id, data)
        if (invalidate) this.invalidate_object(id)
        return record
    }

    invalidate_object(id) {
        /* Remove an (outdated) object from the registry. If a stub (no __data yet), the object is kept. */
        let obj = this.registry.get_object(id)
        if (obj?.__data) this._on_evict(obj) || this.registry.delete_object(id)
    }

    register_version(obj) {
        /* Cache the specific version (__ver) of a loaded web object for reuse. */
    }

    async _purge_registry() {
        if (this.is_closing) return
        try {
            return this.registry.purge()
        }
        finally {
            const interval = (this.site?.cache_purge_interval || 1) * 1000      // [ms]
            setTimeout(() => this._purge_registry(), interval)
        }
    }

    _on_evict(obj) {
        /* Special handling for system objects during registry purge. */
        if (obj.__id === this.site_id) {
            this.reload(this.site_id)           // scheduling an async reload *instead* of eviction so that the site object is *always* present in registry
            return true
        }
    }


    /***  Object modifications (CRUD)  ***/

    async insert(objects, opts = {}) {

    }

    async save(objects, opts_ = {}) {
        /* Save changes in multiple objects all at once (concurrently). */
        let {reload, ...opts} = opts_
        return Promise.all(objects.map(obj => {
            let save = obj?.save(opts)
            return reload ? save?.then(() => obj.reload()) : save
        }))
    }


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


    /***  Dynamic import from SUN  ***/

    // async import(path, name) {
    //     /* Import a module and (optionally) its element, `name`, from a SUN path, or from a regular JS path.
    //        Uses the site's routing mechanism to locate the `path` anywhere across the SUN namespace.
    //        Can be called client-side and server-side alike.
    //        IMPORTANT: a new global context is created every time a module is imported using this method,
    //                   so this method should be called only ONCE when the process is starting.
    //      */
    //     let module = CLIENT ? import(this._js_import_url(path)) : this.loader.import(path)
    //     return name ? (await module)[name] : module
    // }
    //
    // _js_import_url(path) {
    //     /* Schemat's client-side import path converted to a standard JS import URL for importing remote code from SUN namespace. */
    //     return path + '::import'
    // }
}

