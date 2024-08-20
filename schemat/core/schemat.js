"use strict";

import {T, print, assert, DependenciesStack, normalize_path} from '../common/utils.js'
import {Item, ROOT_ID} from '../item.js'
import {set_global} from "../common/globals.js";
import {Registry} from "./registry.js";

// import {LitElement, html, css} from "https://unpkg.com/lit-element/lit-element.js?module";


/**********************************************************************************************************************
 **
 **  CLASSPATH
 **
 */

// class Classpath {
//     forward = new Map()         // dict of objects indexed by paths: (path -> object)
//     inverse = new Map()         // dict of paths indexed by objects: (object -> path)
//
//     set(path, obj) {
//         /*
//         Assign `obj` to a given path. Create an inverse mapping if `obj` is a class or function.
//         Override an existing object if already present.
//         */
//         if (this.forward.has(path)) throw new Error(`the path already exists: ${path}`)
//         this.forward.set(path, obj)
//         // print(`Classpath: ${path}`)
//
//         if (typeof obj === "function") {
//             if (this.inverse.has(obj)) throw new Error(`a path for the object already exists (${this.inverse.get(obj)}), cannot add another one (${path})`)
//             this.inverse.set(obj, path)             // create inverse mapping for classes and functions
//         }
//     }
//     setMany(path, ...objects) {
//         /* Add multiple objects to a given `path`, under names taken from their `obj.name` properties. */
//         let prefix = path ? `${path}.` : ''
//         for (let obj of objects) {
//             let name = obj.name
//             if (!name) throw new Error(`Missing .name of an unnamed object being added to Classpath at path '${path}': ${obj}`)
//             this.set(`${prefix}${name}`, obj)
//         }
//     }
//
//     async setModule(path, module_url, {symbols, accept, exclude_variables = true} = {})
//         /*
//         Add symbols from `module` to a given package `path`.
//         If `symbols` is missing, all symbols found in the module are added, excluding:
//         1) variables (i.e., not classes, not functions), if exclude_variables=true;
//         2) symbols that point to objects whose accept(name, obj) is false, if `accept` function is defined.
//         */
//     {
//         let module = await import(module_url)
//         let prefix = path ? `${path}.` : ''
//
//         if (typeof symbols === "string")    symbols = symbols.split(' ')
//         else if (!symbols)                  symbols = Object.keys(module)
//         if (exclude_variables)              symbols = symbols.filter(s => typeof module[s] === "function")
//
//         for (let name of symbols) {
//             let obj = module[name]
//             if (accept && !accept(name, obj)) continue
//             this.set(`${prefix}${name}`, obj)
//         }
//     }
//
//     encode(obj) {
//         /*
//         Return canonical path of a given class or function, `obj`. If `obj` was added multiple times
//         under different names (paths), the most recently assigned path is returned.
//         */
//         let path = this.inverse.get(obj)
//         if (path === undefined) throw new Error(`Not in classpath: ${obj.name || obj}`)
//         return path
//     }
//     decode(path) {
//         /* Return object pointed to by a given path. */
//         let obj = this.forward.get(path)
//         if (obj === undefined) throw new Error(`Unknown class path: ${path}`)
//         print(`decoded with Classpath: ${path}`)
//         return obj
//     }
// }

/**********************************************************************************************************************
 **
 **  PREFETCHED
 **
 */

class Prefetched {
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
    prefetched                      // Prefetched instance containing built-in classes and their paths

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
            let id   = `[${obj._id_}]`.padEnd(6)
            let name = this._name(obj).padEnd(15)
            return `${id} ${name}`
        }
        _tail() {
            // IDs and names of all objects currently being loaded
            let ids = this.map(obj => obj._id_)
            let names = this.map(obj => this._name(obj) || obj._id_)
            return `[${ids}]  --  [${names.join(', ')}]`
        }
        _name(obj) {
            if (typeof obj._self_.name === 'string') return obj._self_.name     // watch out for ItemProxy.UNDEFINED
            return obj._data_?.get('name') || ''                                //(obj.is_loaded ? obj.name : obj._self_.name)
        }
    }

    // _load_running -- IDs of objects whose .load() is currently being executed (at most one per ID)
    // _load_awaited -- IDs of objects whose .load() is being awaited, with the number of awaiters


    /***  Initialization  ***/

    static async create_global(site_id, bootstrap_db, open_bootstrap_db = null) {
        /* Create a new Schemat instance as a global object and perform initialization of classpath, site_id, bootstrap db.
           This special method is defined instead of a constructor because async operations are performed.
         */
        let schemat = new this()
        set_global({schemat})

        // await schemat._init_classpath()
        await schemat._init_prefetched()

        schemat._db = bootstrap_db              // on server, the ultimate DB is opened later: on the first access to schemat.db
        await open_bootstrap_db?.()

        // if (cluster_id) {
        //     print(`Loading cluster ${cluster_id}...`)
        //     let cluster = await schemat.get_loaded(cluster_id)
        //     site_id = cluster.site._id_
        //     print(`Cluster ${cluster_id} loaded, site ID: ${site_id}`)
        // }

        assert(T.isNumber(site_id), `Invalid site ID: ${site_id}`)
        schemat.site_id = site_id
        await schemat._init_site()
        // await schemat._reset_class()
        assert(schemat.site)

        return schemat
    }

    // async _init_classpath() {
    //     // print('initClasspath() started...')
    //     let classpath = new Classpath()
    //
    //     // add standard classes to the classpath
    //     classpath.setMany("js", Map)
    //     classpath.setMany("base", Catalog, Data)
    //     await classpath.setModule("base", "../item.js")
    //     await classpath.setModule("std", "../std/files.js")
    //     await classpath.setModule("std", "../std/site.js")
    //     await classpath.setModule("std", "../std/containers.js")
    //
    //     // if (this.server_side) {
    //     await classpath.setModule("db", "../db/records.js")
    //     await classpath.setModule("db", "../db/block.js")
    //     await classpath.setModule("db", "../db/sequence.js")
    //     await classpath.setModule("db", "../db/index.js")
    //     await classpath.setModule("db", "../db/db.js")
    //
    //     let accept = (name) => name.toUpperCase() === name || name === 'TypeWrapper'
    //
    //     // add all Type subtypes (all-caps class names) + TypeWrapper
    //     await classpath.setModule("type", "../types/type.js", {accept})
    //     await classpath.setModule("type", "../types/catalog.js", {accept})
    //
    //     this.classpath = classpath
    //     // print('initClasspath() done')
    // }

    async _init_prefetched() {
        let prefetched = new Prefetched()

        prefetched.set(":Map", Map)                                     // built-in JS classes have empty file path

        await prefetched.fetch("../index.js", {path: 'schemat'})        // Schemat core classes, e.g., "schemat:Item"
        await prefetched.fetch("../std/files.js")
        await prefetched.fetch("../std/site.js")
        await prefetched.fetch("../std/containers.js")
        await prefetched.fetch("../db/records.js")
        await prefetched.fetch("../db/block.js")
        await prefetched.fetch("../db/sequence.js")
        await prefetched.fetch("../db/index.js")
        await prefetched.fetch("../db/db.js")

        let accept = (name) => name.toUpperCase() === name
        await prefetched.fetch("../types/type.js", {accept})
        await prefetched.fetch("../types/catalog.js", {accept})

        this.prefetched = prefetched
    }

    async _reset_class() { /* on server only */ }

    async _init_site() {
        /* Load the `site` object and reload the existing (system) objects to make sure that they are fully activated:
           URLs are awaited, classes are imported dynamically from SUN instead of a static classpath.
         */
        await this.reload(this.site_id)
        for (let obj of this.registry)
            if (obj._data_) await this.reload(obj)
            // if (obj._data_ && !obj._url_)
            //     await obj._meta_.pending_url
    }


    /***  Access to web objects  ***/

    get_object(id, {version = null} = {}) {
        /* Create a stub of an object with a given ID, or return an existing instance (a stub or loaded), if present in the cache.
           If a stub is created anew, it is saved in cache for reuse by other callers.
         */
        // this.session?.countRequested(id)
        let obj = this.registry.get(id) || this.registry.set(Item.create_stub(id))          // a stub has immediate expiry date (i.e., on next cache purge) unless its data is loaded and TLS updated
        assert(!obj._meta_.mutable)
        return obj
    }

    async get_loaded(id)     { return this.get_object(id).load() }

    async reload(obj_or_id) {
        /* Create a new instance of the object, load its data from DB, and when it is fully initialized
           replace the existing instance in the registry. Return the new object.
         */
        let id  = T.isNumber(obj_or_id) ? obj_or_id : obj_or_id._id_
        let obj = Item.create_stub(id)
        return obj.load().then(() => this.registry.set(obj))
    }


    /***  Indexes  ***/

    async *_scan_all({limit} = {}) {
        /* Scan the main data sequence in DB. Yield items, loaded and registered in the cache for future use. */
        let count = 0
        for await (const record of this.db.scan_all()) {                            // stream of ItemRecords
            if (limit !== undefined && count++ >= limit) break
            let item = await Item.from_record(record)
            yield this.registry.set(item)
        }
    }

    async *scan_category(category) {
        let target_cid = category?._id_
        let start = category ? [target_cid] : null
        let stop = category ? [target_cid + 1] : null
        let records = this.db.scan_index('idx_category_item', {start, stop})        // stream of plain Records

        for await (const record of records) {
            let {cid, id} = record.object_key
            assert(target_cid === undefined || target_cid === cid)
            yield this.get_loaded(id)
        }
    }


    /***  Object <> classpath mapping (for de/serialization)  ***/

    get_classpath(cls) {
        /* Return a dotted module path of a given class or function as stored in a global Classpath.
           `cls` should be either a constructor function, or a prototype with .constructor property.
         */
        if (typeof cls === "object")            // if `cls` is a class prototype, take its constructor instead
            cls = cls.constructor
        if (!cls) throw `Argument is empty or not a class: ${cls}`

        return this.prefetched.get_path(cls)
    }

    get_builtin(path) {
        /* Retrieve a built-in class or function from the Classpath. */
        return this.prefetched.get_object(path)
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

