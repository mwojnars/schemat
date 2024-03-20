"use strict";

import {T, print, assert, Stack} from './common/utils.js'
import {ItemNotFound, NotImplemented} from './common/errors.js'
import {Catalog, Data, ItemsCache} from './data.js'
import {Item, RootCategory} from './item.js'
import {set_global} from "./common/globals.js";

// import {LitElement, html, css} from "https://unpkg.com/lit-element/lit-element.js?module";


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
 **  SCHEMAT
 **
 */

export class Schemat {
    /* Global (or thread-local) object that exposes Schemat internal API for use by the application code:
       loading and caching of web objects, dynamic module import, classpath management, session management etc.
     */

    // global flags server_side/client_side to indicate the environment where the code is executing
    server_side = true
    get client_side() { return !this.server_side }

    _db                  // client-side or bootstrap DB; regular server-side DB is taken from site.database

    get db() {
        /* The site's database instance, either a Database (on server) or a ClientDB (on client) */
        return (this.server_side && this.site?.database) || this._db
    }

    root_category           // site-wide RootCategory object
    site                    // fully loaded and activated Site instance that handles all web requests
    is_closing = false      // true if the Schemat node is in the process of shutting down

    _cache = new ItemsCache()

    // IDs of objects currently being loaded/initialized with a call to .load()
    _loading = new class extends Stack {
        push(obj, _print = false) {
            super.push(obj)
            if (_print) print(`loading:  + ${this._head(obj)}  ${this._tail()}`)
        }
        pop(obj, _print = false) {
            obj = super.pop(obj)
            if (_print) print(`loading:  - ${this._head(obj)}  ${this._tail()}`)
            return obj
        }

        _head(obj) {
            let id   = `[${obj._id_}]`.padEnd(6)
            let name = `${obj._self_.name || obj._data_?.get('name') || ''}`.padEnd(15)
            return `${id} ${name}`
        }
        _tail() {
            // IDs and names of all objects currently being loaded
            let ids = this.map(obj => obj._id_)
            let names = this.map(obj => obj._self_.name || obj._data_?.get('name') || obj._id_)    //(obj.is_loaded ? obj.name : obj._self_.name)
            return `[${ids}]  --  [${names.join(', ')}]`
        }
    }

    // _load_running -- IDs of objects whose .load() is currently being executed (at most one per ID)
    // _load_awaited -- IDs of objects whose .load() is being awaited, with the number of awaiters


    /***  Initialization  ***/

    static async create_global(...args) {
        /* Create a new Schemat instance, perform basic initialization and make it a global object. */

        let schemat = new this(...args)
        set_global({schemat, registry: schemat})

        await schemat.init_classpath()
        // await schemat.boot()
        return schemat
    }


    async init_classpath() {
        // print('initClasspath() started...')
        let classpath = new Classpath

        // add standard classes to the classpath
        classpath.setMany("js", Map)
        classpath.setMany("base", Catalog, Data)
        await classpath.setModule("base", "./item.js")
        await classpath.setModule("std", "./std/files.js")
        await classpath.setModule("std", "./std/site.js")
        await classpath.setModule("std", "./std/containers.js")

        // if (this.server_side) {
        await classpath.setModule("db", "./db/records.js")
        await classpath.setModule("db", "./db/block.js")
        await classpath.setModule("db", "./db/sequence.js")
        await classpath.setModule("db", "./db/index.js")
        await classpath.setModule("db", "./db/db.js")

        // add all Type subtypes (all-caps class names) + TypeWrapper
        await classpath.setModule("type", "./type.js", {accept: (name) =>
                name.toUpperCase() === name || name === 'TypeWrapper'
        })

        this.classpath = classpath
        // print('initClasspath() done')
    }

    set_db(db)  { return this._db = db }

    async boot(site_id) {
        /* (Re)create/load `this.root_category` and `this.site`. The latter will be left undefined if not present in the DB. */
        assert(T.isNumber(site_id), `Invalid site ID: ${site_id}`)
        this.root_category = await this._init_root()        // always returns a valid object, possibly created from `root_data`
        this.site = await this._init_site(site_id)          // may return undefined if the record not found in DB (!)
        if (this.site) await this._activate_site()
        // if (this.site) print("Schemat: site loaded")
    }

    async _init_root() {
        /* Create the RootCategory object, ID=0, and load its contents from the DB. The root_category must be present
           in the lowest ring already, possibly overwritten by newer variants in higher rings.
         */
        // if (this.root_category) return this.root_category        // warn: this is incorrect during startup if root is redefined in higher rings
        let root = this.root_category = RootCategory.create()
        this.register(root)

        await root.load()
        root.assert_loaded()
        // print("Schemat: root category loaded from DB")

        // // try loading `root` from the DB first...
        // if (this.db)
        //     try {
        //         await root.load()
        //         root.assert_loaded()
        //         print("Schemat: root category loaded from DB")
        //     } catch (ex) {
        //         if (!(ex instanceof ItemNotFound)) throw ex
        //     }
        //
        // // ...only when the above fails due to missing data, load from the predefined `root_data`
        // // TODO: this is only used by CLI_build() and bootstrap.js -- can be removed if bootstrap is not supported anymore!
        // if (!root.is_loaded()) {
        //     await root.load(new ItemRecord(ROOT_ID, root_data))
        //     print("Schemat: root category created from root_data")
        // }

        // print("Schemat: root category created")
        return root
    }

    async _init_site(site_id) {
        /* (Re)load and return the `site` object, if present in the database, otherwise return undefined. */
        if (!this.db) return
        try {
            // if (!site_id)
            //     if (this.client_side) return
            //     else site_id = await this._find_site()
            return await this.get_loaded(site_id)
        } catch (ex) {
            if (!(ex instanceof ItemNotFound)) throw ex
        }
    }

    async _activate_site() {
        /* When the site is loaded, we can safely await URLs of all the objects created so far.
           Later on, newly created objects will have their URLs awaited automatically during load().
           TODO: re-create the objects instead of just awaiting their URLs, so that subsequent dynamic imports all go through the SUN instead of a static classpath.
         */
        print("activating site...")
        for (let obj of this._cache.values())
            if (obj._data_ && !obj._url_)
                await obj._meta_.pending_url
    }


    /***  Items manipulation  ***/

    register(item) {
        /* Add `item` to the cache. This may override an existing item instance with the same ID. */
        assert(item._id_ !== undefined, `cannot register an item without an ID: ${item}`)
        assert(!item._meta_.mutable, `cannot register a mutable item: ${item}`)
        this._cache.set(item._id_, item)
        return item
    }

    unregister(item_or_id) {
        /* Remove an object with a given ID from the cache. If the argument is an object not ID,
           it gets removed from the cache only if this exact instance (not another copy with the same ID) is there.
         */
        let item = T.isNumber(item_or_id) ? null : item_or_id
        let id = item ? item_or_id._id_ : item_or_id
        if (!item || this._cache.get(id) === item)
            this._cache.delete(id)
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
        let records = this.db.scan_all()

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
        let records = this.db.scan_index('idx_category_item', {start, stop})        // stream of plain Records

        for await (const record of records) {
            let {cid, id} = record.object_key
            assert(target_cid === undefined || target_cid === cid)
            yield this.get_loaded(id)
        }
    }


    /***  Object <=> classpath mapping (for de/serialization)  ***/

    get_classpath(cls) {
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


    /***  Debugging  ***/

    load_started(obj, MAX_LOADING = 10) {
        /* Called when a web object starts loading. */
        this._loading.push(obj, false)
        // if (count > MAX_LOADING) throw new Error(`Too many objects loading at once: ${count}`)
    }

    load_finished(obj) {
        /* Called when a web object finishes loading. */
        this._loading.pop(obj, false)
    }
}

