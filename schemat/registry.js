"use strict";

import { print, assert, Counter } from './common/utils.js'
import { ItemNotFound, NotImplemented } from './common/errors.js'
import { JSONx } from './serialize.js'
import { Catalog, Data, ItemsCache } from './data.js'
import { Item, RootCategory, ROOT_ID, SITE_CATEGORY_ID } from './item.js'
// import { root_data } from './boot/root.js'
// import {ItemRecord} from "./db/records.js";

// import * as mod_types from './type.js'
// import {LitElement, html, css} from "https://unpkg.com/lit-element/lit-element.js?module";

const SITE_ID = 1004        // fixed ID of the Site item to be loaded upon startup


export function isRoot(id) { return id === ROOT_ID }


/**********************************************************************************************************************
 **
 **  CLASSPATH
 **
 */

class Classpath {
    forward = new Map()         // dict of objects indexed by paths: (path -> object)
    inverse = new Map()         // dict of paths indexed by objects: (object -> path)

    set(path, obj) {
        /*
        Assign `obj` to a given path. Create an inverse mapping if `obj` is a class or function.
        Override an existing object if already present.
        */
        if (this.forward.has(path)) throw new Error(`the path already exists: ${path}`)
        this.forward.set(path, obj)
        // print(`Classpath: ${path}`)

        if (typeof obj === "function") {
            if (this.inverse.has(obj)) throw new Error(`a path for the object already exists (${this.inverse.get(obj)}), cannot add another one (${path})`)
            this.inverse.set(obj, path)             // create inverse mapping for classes and functions
        }
    }
    setMany(path, ...objects) {
        /* Add multiple objects to a given `path`, under names taken from their `obj.name` properties. */
        let prefix = path ? `${path}.` : ''
        for (let obj of objects) {
            let name = obj.name
            if (!name) throw new Error(`Missing .name of an unnamed object being added to Classpath at path '${path}': ${obj}`)
            this.set(`${prefix}${name}`, obj)
        }
    }

    async setModule(path, module_url, {symbols, accept, exclude_variables = true} = {})
        /*
        Add symbols from `module` to a given package `path`.
        If `symbols` is missing, all symbols found in the module are added, excluding:
        1) variables (i.e., not classes, not functions), if exclude_variables=true;
        2) symbols that point to objects whose accept(name, obj) is false, if `accept` function is defined.
        */
    {
        let module = await import(module_url)
        let prefix = path ? `${path}.` : ''

        if (typeof symbols === "string")    symbols = symbols.split(' ')
        else if (!symbols)                  symbols = Object.keys(module)
        if (exclude_variables)              symbols = symbols.filter(s => typeof module[s] === "function")

        for (let name of symbols) {
            let obj = module[name]
            if (accept && !accept(name, obj)) continue
            this.set(`${prefix}${name}`, obj)
        }
    }

    encode(obj) {
        /*
        Return canonical path of a given class or function, `obj`. If `obj` was added multiple times
        under different names (paths), the most recently assigned path is returned.
        */
        let path = this.inverse.get(obj)
        if (path === undefined) throw new Error(`Not in classpath: ${obj.name || obj}`)
        return path
    }
    decode(path) {
        /* Return object pointed to by a given path. */
        let obj = this.forward.get(path)
        if (obj === undefined) throw new Error(`Unknown class path: ${path}`)
        return obj
    }
}

/**********************************************************************************************************************
 **
 **  REGISTRY
 **
 */

export class Registry {

    // global flags server_side/client_side to indicate the environment where the code is executing
    server_side = true
    get client_side() { return !this.server_side }

    root                    // permanent reference to a singleton root Category object, kept here instead of cache
    site                    // fully loaded Site instance that will handle all web requests
    is_closing = false      // true if the Schemat node is in the process of shutting down

    _cache = new ItemsCache()


    /***  Initialization  ***/

    async init_classpath() {
        // print('initClasspath() started...')
        let classpath = new Classpath

        classpath.setMany("", Map, Catalog, Data)               // add Map, Catalog & Data to the classpath
        await classpath.setModule("", "./db/edits.js")          // add all Edit (sub)types for intra-cluster communication
        await classpath.setModule("", "./db/records.js")
        await classpath.setModule("", "./item.js")
        await classpath.setModule("std", "./std/files.js")
        await classpath.setModule("std", "./std/site.js")
        await classpath.setModule("std", "./std/urls.js")

        if (this.server_side) {
            await classpath.setModule("db", "./db/block.js")
            await classpath.setModule("db", "./db/sequence.js")
            await classpath.setModule("db", "./db/index.js")
            await classpath.setModule("db", "./db/db.js")
        }

        // add all Type subtypes (all-caps class names) + TypeWrapper
        await classpath.setModule("", "./type.js", {accept: (name) =>
                name.toUpperCase() === name || name === 'TypeWrapper'
        })

        this.classpath = classpath
        // print('initClasspath() done')
    }

    async boot(site_id = SITE_ID) {
        /* (Re)create/load `this.root` and `this.site`. The latter will be left undefined if not present in the DB. */
        this.root = await this._init_root()             // always returns a valid object, possibly created from `root_data`
        this.site = await this._init_site(site_id)      // may return undefined if the record not found in DB (!)
        // if (this.site) print("Registry: site loaded")
    }

    async _init_root() {
        /* Create the RootCategory object, ID=0, and load its contents from the DB.  The root object must be present
           in the lowest ring already, possibly overwritten by newer variants in higher rings.
         */
        // if (this.root) return this.root                  // warn: this is incorrect during startup if root is redefined in higher rings
        let root = this.root = RootCategory.create()
        this.register(root)

        await root.load()
        root.assert_loaded()
        // print("Registry: root category loaded from DB")

        // // try loading `root` from the DB first...
        // if (schemat.db)
        //     try {
        //         await root.load()
        //         root.assert_loaded()
        //         print("Registry: root category loaded from DB")
        //     } catch (ex) {
        //         if (!(ex instanceof ItemNotFound)) throw ex
        //     }
        //
        // // ...only when the above fails due to missing data, load from the predefined `root_data`
        // // TODO: this is only used by CLI_build() and bootstrap.js -- can be removed if bootstrap is not supported anymore!
        // if (!root.is_loaded()) {
        //     await root.load(new ItemRecord(ROOT_ID, root_data))
        //     print("Registry: root category created from root_data")
        // }

        // print("Registry: root category created")
        return root
    }

    async _init_site(site_id) {
        /* (Re)load and return the `site` object, if present in the database, otherwise return undefined. */
        if (!schemat.db) return
        try {
            // if (!site_id)
            //     if (this.client_side) return
            //     else site_id = await this._find_site()
            return await this.get_loaded(site_id)
        } catch (ex) {
            if (!(ex instanceof ItemNotFound)) throw ex
        }
    }

    // async _find_site() {
    //     /* Retrieve an ID of the first Site item (CID=1) found by scanCategory() in the DB. */
    //     assert(this.server_side)
    //     let Site = await this.get_loaded(SITE_CATEGORY_ID)
    //     let scan = this.scan(Site, {limit: 1})
    //     let ret  = await scan.next()
    //     if (!ret || ret.done) throw new ItemNotFound(`no Site item found in the database`)
    //     return ret.value._id_
    // }


    /***  Items manipulation  ***/

    register(item) {
        /* Add `item` to the cache. This may override an existing item instance with the same ID. */
        assert(item._id_ !== undefined, `cannot register an item without an ID: ${item}`)
        this._cache.set(item._id_, item)
        return item
    }

    unregister(item) {
        /* Remove an object with a given ID from the cache, but only if this exact object is still there. */
        if (this._cache.get(item._id_) === item)
            this._cache.delete(item._id_)
    }

    get_item(id, {version = null} = {}) {
        /* Get a registered instance of an item with a given ID, possibly a stub. An existing instance is returned,
           this._cache, or a stub is created anew and saved for future calls.
         */
        // this.session?.countRequested(id)

        // ID requested was already loaded/created? return the existing instance, or create a stub (empty item) otherwise;
        // a stub has no expiry date until filled with data
        let item = this._cache.get(id) || this.register(Item.create_stub(id))

        assert(!item._meta_.mutable)
        return item
    }

    async get_loaded(id)     { return this.get_item(id).load() }

    async *scan_all({limit} = {}) {
        /* Scan the main data sequence in DB. Yield items, loaded and registered in the cache for future use. */
        let count = 0
        let records = schemat.db.scan_all()

        for await (const record of records) {                   // stream of ItemRecords
            if (limit !== undefined && count++ >= limit) break
            let item = await Item.from_record(record)
            yield this.register(item)
        }
    }

    async *scan_category(category) {
        let target_cid = category?._id_
        let start = category ? [target_cid] : null
        let stop = category ? [target_cid + 1] : null
        let records = schemat.db.scan_index('idx_category_item', {start, stop})         // stream of plain Records

        for await (const record of records) {
            let {cid, id} = record.object_key
            assert(target_cid === undefined || target_cid === cid)
            yield this.get_loaded(id)
        }
    }


    /***  Object <=> classpath mapping (for de/serialization)  ***/

    get_class_path(cls) {
        /* Return a dotted module path of a given class or function as stored in a global Classpath.
           `cls` should be either a constructor function, or a prototype with .constructor property.
         */
        if (typeof cls === "object")            // if `cls` is a class prototype, take its constructor instead
            cls = cls.constructor
        if (!cls) throw `Argument is empty or not a class: ${cls}`

        return this.classpath.encode(cls)
    }

    get_class(path) {
        /* Get a global object - class or function from a virtual package (Classpath) - pointed to by `path`. */
        return this.classpath.decode(path)
    }


    /***  Dynamic JS import over the SUN  ***/

    import(path, name) {
        /* High-level import of a module and (optionally) its element, `name`, from a SUN path.
           Uses the site's routing mechanism to locate the `path` anywhere across the SUN namespace.
           Implemented in subclasses. Can be called client-side and server-side alike.
         */
        throw new NotImplemented()
    }

    async importDirect(path, name) {
        /* Direct (low-level) import of a module and (optionally) its element, `name`, from a SUN path,
           using only plain import() rather than the generic routing mechanism - use .import() if the latter is needed.
           Works on a server and a client; performs any needed path conversion along the way.
           On a server, the `path` is restricted to subpaths of the PATH_LOCAL_SUN (/system/local) folder.
         */
        let module = import(this.directImportPath(path))
        return name ? (await module)[name] : module
    }

    directImportPath(path)  { throw new NotImplemented() }
}

