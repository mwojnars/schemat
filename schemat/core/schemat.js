import {ROOT_ID} from "../common/globals.js";
import {T, print, assert, normalizePath} from '../common/utils.js'
import {DependenciesStack} from '../common/structs.js'
import {WebObject} from './object.js'
import {Category} from './category.js'
import {Registry} from "./registry.js";
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
    /* Global context for execution of web objects accessible via `globalThis.schemat`. Exposes Schemat's internal API:
       loading and caching of web objects, dynamic module import, classpath management, session management etc.
     */

    config          // boot configuration (on server) or RequestContext (on client)
    app_id          // ID of the active Application object
    _app            // `app` of the previous generation, remembered here to keep the .app() getter operational during complete cache erasure
    registry        // cache of web objects, records and indexes loaded from DB
    builtin         // a Classpath containing built-in classes and their paths
    booting         // a Promise that resolves when this Schemat is fully booted; false after that
    debug           // if true, some elements of Schemat and environment are tuned towards debugging

    _essential = [ROOT_ID]  // IDs of web objects that must be always present (fully loaded) in the Registry, so eviction must reload not delete them
    _loading = new Map()    // {id: promise} map of object (re)loading threads, to avoid parallel loading of the same object twice

    get root_category() { return this.get_object(ROOT_ID) }
    get app()           { return this.get_if_loaded(this.app_id, obj => {this._app = obj}) || this._app }
    get global()        { return this.app?._global }
    get terminating()   { return this.kernel?._closing }

    // defined on server only:
    kernel
    get cluster()   {}
    // get tx()        {}
    get node()      {}
    get_frame()     {}


    // web objects currently being loaded/initialized with a call to .load()
    _loading_stack = new class extends DependenciesStack {
        debug = false

        _head(obj) {
            let id   = `[${obj.id}]`.padEnd(6)
            let name = this._name(obj).padEnd(15)
            return `${id} ${name}`
        }
        _tail() {
            // IDs and names of all objects currently being loaded
            let ids = this.map(obj => obj.id)
            let names = this.map(obj => this._name(obj) || obj.id)
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

    constructor(config) {
        /* Create a new Schemat instance. `config` is either the contents of a config file (on server),
           or a RequestContext (on client) -- both should contain the `app` attribute.
         */
        this.booting = new Promise(resolve => this._booting_resolve = resolve)
        this.config = config
        this.app_id = config.app || undefined
        this.WebObject = WebObject          // schemat.WebObject is globally available for application code
        this.Category = Category            // schemat.Category is globally available for application code
        this.registry = new Registry(this._on_evict.bind(this))
        this.debug = config.debug
    }

    async _init_classpath() {
        let builtin = this.builtin = new Classpath()

        builtin.set(":Map", Map)                                    // standard JS classes have an empty file part of the path

        await builtin.fetch("../index.js", {path: 'schemat'})       // Schemat core classes, e.g., "schemat:WebObject"
        await builtin.fetch("./app.js")
        await builtin.fetch("../server/logger.js")
        await builtin.fetch("../server/agent.js")
        await builtin.fetch("../server/node.js")
        await builtin.fetch("../server/cluster.js")
        await builtin.fetch("../std/files.js")
        await builtin.fetch("../std/containers.js")
        await builtin.fetch("../db/data_request.js")
        await builtin.fetch("../db/records.js")
        await builtin.fetch("../db/block.js")
        await builtin.fetch("../db/sequence.js")
        await builtin.fetch("../db/indexes.js")
        await builtin.fetch("../db/db.js")
        await builtin.fetch("../common/structs.js")
        // await builtin.fetch("../common/errors.js")       // needed if mJsonxError is used for transmitting service errors back to client

        let accept = (name) => name.toUpperCase() === name
        await builtin.fetch("../types/type.js", {accept})
        await builtin.fetch("../types/catalog_type.js", {accept})
    }

    async _load_app() {
        /* Initialize this._app (this.app). */
        let id = this.app_id
        assert(T.isNumber(id), `Invalid application ID: ${id}`)

        this._essential.push(id)
        this._app = await this.reload(id, true)
        assert(this.app?.is_loaded())
    }

    async _boot_done() {
        this._booting_resolve()     // resolve this.booting Promise
        await this.booting          // await any other callbacks that were added with after_boot()
        this.booting = false
    }

    after_boot(callback) {
        /* Run `callback` function at the end of the boot phase, when the boot DB is already replaced by the regular DB. */
        if (!this.booting) return callback()
        this.booting = this.booting.then(callback)
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
        if (path.startsWith('schemat:') || !this.app?.is_loaded())
            return this.get_builtin(path)
        if (path[0] === '/') return this.app.import_global(path)
        // if (!this.app.import_local) {
        //     print(`Schemat.import(${path}): missing app.import_local(), app_id`)
        //     process.exit()
        // }
        return this.app.import_local(path)
    }


    /***  Access to web objects  ***/

    as_object(obj_or_id) {
        /* If the argument is an object ID, return an object/stub with this ID, otherwise return the argument unchanged. */
        return (typeof obj_or_id === 'object') ? obj_or_id : this.get_object(obj_or_id)
    }

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

    get_provisional(id) {
        /* Deserialize a newborn object as a stub with __provisional_id assigned. For transferring newborn objects to DB. */
        let obj = WebObject.stub()
        obj.__self.__provisional_id = id
        return obj
    }

    get_if_present(id) { return this.registry.get_object(id) }

    get_if_loaded(id, set_loaded = null) {
        /* Only return the object from registry if it is already loaded. Otherwise, if set_loaded callback is provided,
           load the object in the background and call set_loaded(obj) when done.
         */
        if (!id) return
        let obj = this.get_object(id)
        if (obj?.is_loaded()) {
            set_loaded?.(obj)
            return obj
        }
        if (set_loaded) obj.load().then(set_loaded)     // load content in the background for future access; intentionally not awaited
    }

    // async get_mutable(...objects_or_ids) {
    //     /* Return an array of mutable, fully loaded instances of given objects. Like WebObject.get_mutable(),
    //        but executed for multiple objects (IDs) at once, and preceded by object loading when needed.
    //        Some objects/IDs on the args list can be missing (null, undefined).
    //      */
    //     let objs = objects_or_ids.map(async obj => {
    //         if (!obj) return obj
    //         if (Number.isInteger(obj)) obj = await this.get_loaded(obj)
    //         return obj.mutate()
    //     })
    //     return Promise.all(objs)
    // }

    async get_loaded(...ids) {
        /* Load and return the web object identified by a given ID. If multiple `ids` are provided, an array of objects is returned. */
        if (ids.length >= 2) return Promise.all(ids.map(id => this.get_object(id).load()))
        return this.get_object(ids[0]).load()
    }

    async load(...args) {
        /* Alias for get_loaded(). */
        return this.get_loaded(...args)
    }

    async reload(id, strict = false) {
        /* Load contents into an existing stub, or create a new instance of the object using the most recent record from the registry
           (download from DB if missing). When the object is fully initialized replace the existing instance in the registry. Return the object.
           If strict=true, a new instance is always created.
         */
        assert(id)
        let loading = this._loading.get(id)
        if (loading && !strict) return loading

        let prev = this.get_if_present(id)

        if (strict || prev?.is_loaded()) {      // create a new instance, but don't replace the existing one in the cache until loading is finished
            let stub = WebObject.stub(id)
            loading = stub.load().then(() => {this.registry.set_object(stub); this._loading.delete(id); return stub})
            // loading = stub.load().then(() => {this.registry.set_object(stub); this._loading.delete(id); return stub}).catch(err => {
            //     console.warn(`failed to reload object [${id}]:`, err)
            // })
            this._loading.set(id, loading)
            return loading
        }

        let stub = prev || this.registry.set_object(WebObject.stub(id))
        return stub.load()      // here, this._loading gets updated
    }

    load_record(id, opts = {}) {
        /* Read object's raw data (JSON string) from DB, or from the registry (if present there).
           In the former case, the newly retrieved data is saved in the registry for future use. Return {json, loaded_at}.
         */
        assert(id !== undefined)
        // this.session?.countLoaded(id)

        let rec = this.get_record(id)
        if (rec) return rec

        return this._db_select(id, opts).then(json => {
            this.register_record({id, data: json})
            return {json, loaded_at: Date.now()}
        })
    }

    get_record(id) {
        let rec = this.registry.get_record(id)
        if (rec) return {json: rec, loaded_at: Date.now()}      // TODO: better to keep true `loaded_at` in Registry

        let obj = this.get_object(id)
        let ttl = obj.__ttl * 1000 || 0
        let {json, loaded_at} = obj?.__refresh || {}

        // at least 20% of this record's TTL (as measured by the existing object's TTL) must be still available
        if (json && loaded_at + ttl * 0.8 > Date.now()) return {json, loaded_at}
    }

    _db_select(id, opts)    { throw new Error(`not implemented`) }

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

    // refresh(id) {
    //     /* */
    //     // check for a newer record of this object in Registry and possibly schedule its re-instantiation
    //
    //     // if TTL is running out, request the download of the most up-to-date record and re-instantiation
    //
    //     let obj = this.get_object(id)
    //     return obj?.is_loaded() ? obj : undefined
    // }


    /***  Registry management  ***/

    register_changes(...records) {
        this.tx?.capture(...records)
        records.forEach(rec => this.register_record(rec))
    }

    register_record(record /*{id, data}*/) {
        /* Keep an {id, data} record as the most up-to-date (raw) representation of the corresponding object that will be used
           on the next object (re)load. Remove the existing object from cache, if loaded from a different JSON source.
           `data` is either a JSON string, or an encoded (plain) representation of a Catalog instance.
         */
        let {id, data} = record

        if (data.__status === 'DELETED') {
            this.registry.delete_record(id)
            this.registry.delete_object(id)
        }
        let json = this.registry.set_record(id, data)       // save `data` in the record registry

        // if a fully loaded instance of this object exists in the cache, keep `json` in obj.__refresh for easy recreation of an updated instance
        let obj = this.get_if_present(id)
        if (obj?.__json_source) obj.__self.__refresh = {json, loaded_at: Date.now()}

        // // remove the cached loaded instance of the object, if present, to allow its reload on the next .get_object().load()
        // let obj = this.get_if_present(id)
        // if (obj?.__data && (!json || json !== obj.__json_source))
        //     this._on_evict(obj) || this.registry.delete_object(id)

        return record
    }

    register_version(obj) {
        /* Cache the specific version (__ver) of a loaded web object for reuse. */
    }

    _report_memory() {
        let memory = SERVER ? process.memoryUsage().heapUsed : performance.memory?.usedJSHeapSize   // performance.memory only exists on Chrome
        if (memory) print(`memory used: ${(memory / 1024 / 1024).toFixed(2)} MB`)
    }

    _on_evict({id}) {
        /* Special handling for essential system objects during registry purge: they are reloaded rather than deleted. */
        if (this._essential.includes(id)) {
            this.reload(id)         // scheduling an async reload *instead* of eviction so that the object is *always* present in registry
            return true
        }
    }


    /* Proxy object that handles both direct calls (remote(code)) and property access (remote.XYZ).
       Direct calls execute code on the server via eval, while property access forwards to app.action.XYZ().
     */
    remote = new Proxy(
        async (code) => this.app.POST.eval(code),       // handle direct calls like remote(code)
        {
            get: (target, prop) => {                    // handle property access like remote.XYZ
                if (prop === 'then') return undefined   // prevent Promise-like behavior
                return (...args) => this.app.action[prop](...args)
            }
        }
    )
    async server(code) { return this.app.POST.eval(code) }


    /***  Events & Debugging  ***/

    before_data_loading(obj, MAX_LOADING = 10) {
        /* Called at the beginning of data loading in an object, obj._load(). */
        this._loading_stack?.push(obj)
        // if (count > MAX_LOADING) throw new Error(`Too many objects loading at once: ${count}`)
    }

    after_data_loading(obj) {
        /* Called at the end of data loading in an object, obj._load(). */
        this._loading_stack?.pop(obj)
    }


    /***  Dynamic import from SUN  ***/

    // async import(path, name) {
    //     /* Import a module and (optionally) its element, `name`, from a SUN path, or from a regular JS path.
    //        Uses the app's routing mechanism to locate the `path` anywhere across the SUN namespace.
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

