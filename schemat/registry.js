"use strict";

import { print, assert } from './utils.js'
import { JSONx } from './serialize.js'
import { ItemsCache, ItemsCount } from './data.js'
import { Item, RootCategory, ROOT_CID } from './item.js'

// import * as mod_types from './type.js'
// import {LitElement, html, css} from "https://unpkg.com/lit-element/lit-element.js?module";


/**********************************************************************************************************************
 **
 **  DATABASE & CACHE
 **
 */

// export class Database {
//     /*
//     DB operations on an `item`.
//
//     Instant execution:
//     - DELETE -- delete a DB record with a given ID=item.id
//     - UPDATE <data> -- overwrite the entire item.data in DB with `data`
//
//     Delayed exection (on commit):
//     - INSERT -- create a new item record in DB, store item.data in it, assign and return a new IID
//     - EDIT <action> <args>
//              -- inside a write lock, load the item's current data, create an Item instance, call item._edit_<action>(args),
//                 save the resulting item.data; multiple EDIT/CHECK operations are executed together in a single transaction
//     - CHECK <action> <args>
//              -- like EDIT, but calls _check_<action>(args), which should NOT modify the data, but only return true/false;
//                 if false is returned, or an exception raised, the transaction is stopped, changes not saved
//
//     Transactions work at a record level. NO transactions spanning multiple items.
//     */
//
//     async insert(...items) {
//         /* Insert items to a DB, possibly using a bulk insert. */
//         throw new Error("not implemented")
//     }
//     async update(item) { throw new Error("not implemented") }
//     async delete(id)   { throw new Error("not implemented") }
//     async write(id, edits) {
//         /* Load an item of a given `id`, execute a number of `edits` on it, and write the result back to DB. */
//         throw new Error("not implemented")
//     }
// }

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

    static STARTUP_SITE = 'startup_site'        // this property of the root category stores the current site, for startup boot()

    db                      // database for accessing items and other data from database servers
    root                    // permanent reference to a singleton root Category object, kept here instead of cache
    site                    // fully loaded Site instance that will handle all web requests
    session                 // current web Session, or undefined; max. one session is active at a given moment

    cache = new ItemsCache()

    // the getters below are async functions that return a Promise (!) and should be used with await
    get files() { return this.site.getLoaded('filesystem') }
    // get _specializedItemJS() { assert(false) }

    async initClasspath() {
        // print('initClasspath() started...')
        let classpath = new Classpath

        classpath.set_many("schemat.data", Map)                             // schemat.data.Map
        await classpath.add_module("schemat.data", "./data.js")
        await classpath.add_module("schemat.item", "./item.js")
        // await classpath.add_module("schemat.item", this._specializedItemJS)
        await classpath.add_module("schemat.item", "./site.js")             // item.js & site.js are merged into one package
        await classpath.add_module("schemat.type", "./type.js")
        await classpath.add_module("schemat.item", "./server/db.js")

        // // amend base class of all Item subclasses from site.js: replace __proto__=Item with ServerItem or ClientItem ...
        // let mod_item = await import(this._specializedItemJS)
        // let mod_site = await import("./site.js")
        // let ItemSpec = mod_item.Item
        // let ItemBase = Object.getPrototypeOf(ItemSpec)
        //
        // for (let cls of Object.values(mod_site))
        //     if (Object.getPrototypeOf(cls) === ItemBase)
        //         cls.prototype.__proto__ = ItemSpec.prototype

        this.classpath = classpath
        // print('initClasspath() done')
    }

    async boot() {
        /* Initialize this Registry with existing items, server-side or client-side. NOT for DB bootstraping. */
        await this.initClasspath()
        await this.createRoot()
        let site_id = this.root.get(Registry.STARTUP_SITE)
        this.site   = await this.getLoaded(site_id)
    }
    async createRoot() {
        /* Create the RootCategory object, ID=(0,0), and load its data from DB. */
        let root = this.root = new RootCategory(this)
        await root.load()
        return root
    }

    createStub(id, category = null) {
        /* Create a "stub" item of a given ID. The item is unloaded and NO specific class is attached (only the Item class),
           unless `category` object was provided. */
        let [cid, iid] = id
        if (category) return category.new(null, iid)
        let item = new Item()
        item.cid = cid
        item.iid = iid
        item.registry = this
        return item
    }

    getItem(id, {version = null} = {}) {
        /* Get a read-only instance of an item with a given ID. If possible, an existing cached copy
           is taken from this.cache, otherwise it is created anew and saved in this.cache for future calls.
         */
        let [cid, iid] = id
        if (cid === null) throw new Error('missing CID')
        if (iid === null) throw new Error('missing IID')
        assert(Number.isInteger(cid) && Number.isInteger(iid))      // not undefined, not null, not NaN, ...

        this.session?.countRequested(id)
        if (cid === ROOT_CID && iid === ROOT_CID) return this.root

        // ID requested was already loaded/created? return the existing instance
        let item = this.cache.get(id)
        if (item) return item

        let stub = this.createStub(id)
        this.cache.set(id, stub)            // a stub, until loaded, is scheduled for immediate removal (ttl=0) at the end of session
        return stub
    }

    async getCategory(cid) { return this.getLoaded([ROOT_CID, cid]) }

    async getLoaded(id) {
        let item = this.getItem(id)
        await item.load()
        return item
    }

    async loadData(id) {
        /* Load item's full data record from server-side DB and return as a dict with keys: cid, iid, data, (meta?).
           Note that `data` can either be a JSON-encoded string, or a schema-encoded object
           - the caller must be prepared for both cases!
         */
        this.session?.countLoaded(id)
        return this.db.select(id)
    }
    async *scanCategory(category) {
        /* Load from DB all items of a given category ordered by IID. A generator. */
        let records = this.db.scanCategory(category.iid)
        for await (const record of records) {
            let {cid, iid} = record
            assert(!category || cid === category.iid)
            if (cid === ROOT_CID && iid === ROOT_CID)
                yield this.root
            else {
                let item = this.createStub([cid, iid], category)
                await item.reload(undefined, record)
                yield item
            }
        }
    }

    getPath(cls) {
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


/**********************************************************************************************************************
 **
 **  WEB SESSION
 **
 */

export class Session {
    /* Collection of objects that are global to a single request processing. Also holds an evolving state of the latter. */

    registry            // instance of Registry
    request             // instance of node.js express' Request (only present server-side)
    response            // instance of node.js express' Response (only present server-side)

    get req()           { return this.request  }
    get res()           { return this.response }
    get channels()      { return [this.request, this.response] }

    // context of request processing; built gradually by the application(s) that process the request...

    ipath               // like request.path, but with trailing @endpoint removed; typically identifies an item ("item path")
    endpoint            // action to be executed on the target item; empty string '' if not provided in a request
    endpointDefault     // default endpoint that should be used instead of "view" if `endpoint` is missing;
                        // configured by an application that handles the request

    app                 // leaf Application object the request is addressed to
    item                // target item that's responsible for actual handling of the request
    state = {}          // app-specific temporary data that's written during routing (handle()) and can be used for
                        // response generation when a specific app's method is called, most typically url_path()
                        // TODO: only keep `route` instead of `app` for URL generation - Site.url_path()

    // // req.query.PARAM is a string if there's one occurrence of PARAM in a query string,
    // // or an array [val1, val2, ...] if PARAM occurs multiple times
    // print('request query: ', req.query)
    // print('request body:  ', req.body)

    releaseMutex        // release function for registry.sessionMutex to be called at the end of this session

    itemsRequested = new ItemsCount()       // for each item ID: no. of times the item was requested through registry.getItem() during this session
    itemsLoaded    = new ItemsCount()       // for each item ID: no. of times the item data was loaded through registry.loadData()

    constructor(registry, request, response) {
        this.registry = registry
        this.request  = request
        this.response = response
    }

    async start()   { this.releaseMutex = await this.registry.startSession(this) }
    stop()          { this.registry.stopSession(this.releaseMutex) }
    printCounts()   { print(`items requested ${this.itemsRequested.total()} times: `, this.itemsRequested)
                      print(`items loaded ${this.itemsLoaded.total()} times:    `, this.itemsLoaded) }

    redirect(...args)       { this.response.redirect(...args)   }
    send(...args)           { this.response.send(...args)       }
    sendFile(...args)       { this.response.sendFile(...args)   }
    sendStatus(...args)     { this.response.sendStatus(...args) }
    sendItem(...args)       { this.response.sendItem(...args)   }
    sendItems(...args)      { this.response.sendItems(...args)  }

    // get an ultimate endpoint, fall back to a default when necessary
    getEndpoint()           { return this.endpoint || this.endpointDefault || 'view' }

    countRequested(id)      { this.itemsRequested.add(id) }
    countLoaded(id)         { this.itemsLoaded.add(id)    }

    dump() {
        /* Session data and a list of bootstrap items to be embedded in HTML response, state-encoded. */
        let items = [this.item, this.item.category, this.registry.root, this.app]
        items = [...new Set(items)].filter(Boolean)             // remove duplicates and nulls
        items = items.map(i => i.encodeSelf())

        let {app, item, state} = this
        let session = {app, item, state}                       // truncated representation of the current session
        let system_url = this.registry.site.systemURL()

        return {system_url, 'session': JSONx.encode(session), items}
    }

    static load(registry, sessionData) {
        /* Create a Session instance, client-side, from state-encoded data.session as generated by dump(). */
        let session = new Session(registry)
        let {app, item, state} = JSONx.decode(sessionData)
        Object.assign(session, {app, item, state})
        return session
    }
}
