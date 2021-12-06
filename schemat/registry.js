"use strict";

import { print, assert } from './utils.js'
import { ItemsMap } from './data.js'
import { RootCategory, ROOT_CID } from './item.js'

// import * as mod_types from './type.js'
// import {LitElement, html, css} from "https://unpkg.com/lit-element/lit-element.js?module";


/**********************************************************************************************************************
 **
 **  DATABASE & CACHE
 **
 */

export class Database {
    /*
    DB operations on an `item`.

    Instant execution:
    - DELETE -- delete a DB record with a given ID=item.id
    - UPDATE <data> -- overwrite the entire item.data in DB with `data`

    Delayed exection (on commit):
    - INSERT -- create a new item record in DB, store item.data in it, assign and return a new IID
    - EDIT <action> <args>
             -- inside a write lock, load the item's current data, create an Item instance, call item._edit_<action>(args),
                save the resulting item.data; multiple EDIT/CHECK operations are executed together in a single transaction
    - CHECK <action> <args>
             -- like EDIT, but calls _check_<action>(args), which should NOT modify the data, but only return true/false;
                if false is returned, or an exception raised, the transaction is stopped, changes not saved

    Transactions work at a record level. NO transactions spanning multiple items.
    */

    async insert(...items) {
        /* Insert items to a DB, possibly using a bulk insert. */
        throw new Error("not implemented")
    }
    async update(item) { throw new Error("not implemented") }
    async delete(id)   { throw new Error("not implemented") }
    async write(id, edits) {
        /* Load an item of a given `id`, execute a number of `edits` on it, and write the result back to DB. */
        throw new Error("not implemented")
    }
}

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
        this.forward.set(path, obj)
        if (typeof obj === "function")
            this.inverse.set(obj, path)             // create inverse mapping for classes and functions
    }
    set_many(path, ...objects) {
        /* Add multiple objects to a given `path`, under names taken from their `obj.name` properties. */
        for (let obj of objects) {
            let name = obj.name
            if (!name) throw new Error(`Missing .name of an unnamed object being added to Classpath at path '${path}': ${obj}`)
            this.set(`${path}.${name}`, obj)
        }
    }

    async add_module(path, module_url, {symbols, accept, exclude_variables = true} = {})
        /*
        Add symbols from `module` to a given package `path`.
        If `symbols` is missing, all symbols found in the module are added, excluding:
        1) variables (i.e., not classes, not functions), if exclude_variables=true;
        2) symbols that point to objects whose accept(obj) is false, if `accept` function is defined.
        */
    {
        let module = await import(module_url)

        if (typeof symbols === "string")    symbols = symbols.split(' ')
        else if (!symbols)                  symbols = Object.keys(module)
        if (exclude_variables)              symbols = symbols.filter(s => typeof module[s] === "function")

        for (let name of symbols) {
            let obj = module[name]
            if (accept && !accept(obj)) continue
            this.set(`${path}.${name}`, obj)
        }
    }

    encode(obj) {
        /*
        Return canonical path of a given class or function, `obj`. If `obj` was added multiple times
        under different names (paths), the most recently assigned path is returned.
        */
        let path = this.inverse.get(obj)
        if (path === undefined) throw new Error(`Not in classpath: ${obj.name ?? obj}`)
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

    static STARTUP_SITE = 'startup_site'        // this property of the root category stores the current site, for startup boot()

    db      = null          // Database instance for accessing items and other data from database servers
    root    = null          // permanent reference to a singleton root Category object, kept here instead of cache
    site_id = null          // `site` is a property (below), not attribute, to avoid issues with caching (when an item is reloaded)
    items   = new ItemsMap()

    current_request = null      // the currently processed web request; is set at the beginning of request processing and cleared at the end

    // the getters below are async functions that return a Promise (!) and should be used with await
    get site()  { return this.getItem(this.site_id) }
    get files() { return this.site.then(site => site.get('filesystem')) }

    async init_classpath() {
        print('init_classpath() started...')
        let classpath = new Classpath

        classpath.set_many("schemat.data", Map)                             // schemat.data.Map
        await classpath.add_module("schemat.data", "./data.js")
        await classpath.add_module("schemat.item", "./item.js")
        await classpath.add_module("schemat.item", "./items.js")            // item.js & items.js are merged into one package
        await classpath.add_module("schemat.type", "./type.js")

        this.classpath = classpath
        print('init_classpath() done')
    }

    async boot() {
        await this.create_root()
        this.site_id = await this.root.get(Registry.STARTUP_SITE)
    }
    async create_root() {
        /* Create the RootCategory object, ID=(0,0), and load its data from DB. */
        let root = this.root = new RootCategory(this)
        await root.load()
        return root
    }

    async get_category(cid) { return await this.getItem([ROOT_CID, cid]) }

    async getItem(id, {load = false, version = null} = {}) {
        let [cid, iid] = id
        assert(Number.isInteger(cid) && Number.isInteger(iid))      // not undefined, not null, not NaN, ...

        if (cid === null) throw new Error('missing CID')
        if (iid === null) throw new Error('missing IID')
        if (cid === ROOT_CID && iid === ROOT_CID) return this.root

        // ID requested was already loaded/created? return the existing instance
        let item = this.items.get(id)       // this may return a Promise or an item, see below...
        if (item) return item

        // Store and return a Promise that will eventually create an item stub; the promise is FIRST saved to cache,
        // and only later on, the inner code of create_stub() gets executed; in this way, if another caller
        // requests the same item asynchronously, it will receive the same unique item object, eventually, without
        // the creation of duplicate items which might lead to data inconsistency if any of these objects is modified.
        // Creation of a stub and data loading are done as separate steps to ensure proper handling of circular relationships between items.
        let pending = this.create_stub(id)
        if (load) pending = pending.then(item => item.load())
        this.items.set(id, pending)
        pending.then(item => this.items.set(id, item))      // for efficiency, replace the proxy promise in cache with an actual item when it's ready
        return pending
    }

    async create_stub(id, category = null) {
        /* Create and return a "stub" item (no data) with a given ID. */
        let [cid, iid] = id
        category = category || await this.get_category(cid)
        let itemclass = await category.getClass()
        let item = new itemclass(category)
        item.iid = iid
        return item
    }

    async load_record(id) {
        /* Load item's record from server-side DB and return as a dict with keys: cid, iid, data, (meta?).
           Note that `data` can either be a JSON-encoded string, or a schema-encoded object
           - the caller must be prepared for both cases!
         */
        return this.db.select(id)
    }
    async *scan_category(category) {
        /* Load from DB all items of a given category ordered by IID. A generator. */
        let records = this.db.scan_category(category.iid)
        for await (const record of records) {
            let {cid, iid} = record
            assert(!category || cid === category.iid)
            if (cid === ROOT_CID && iid === ROOT_CID)
                yield this.root
            else {
                let item = await this.create_stub([cid, iid], category)
                await item.reload(undefined, record)
                yield item
            }
        }
    }

    get_path(cls) {
        /*
        Return a dotted module path of a given class or function as stored in a global Classpath.
        `cls` should be either a constructor function, or a prototype with .constructor property.
        */
        if (typeof cls === "object")            // if `cls` is a class prototype, take its constructor instead
            cls = cls.constructor
        if (!cls) throw `Argument is empty or not a class: ${cls}`

        return this.classpath.encode(cls)
    }

    getClass(path) {
        /* Get a global object - class or function from a virtual package (Classpath) - pointed to by `path`. */
        return this.classpath.decode(path)
    }
}

