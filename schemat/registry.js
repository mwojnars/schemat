"use strict";

import { print, assert, T } from './utils.js'
import { ItemNotFound, NotImplemented } from './errors.js'
import { JSONx } from './serialize.js'
import { Catalog, Data, ItemsCache, ItemsCount } from './data.js'
import { Item, RootCategory, ROOT_ID, SITE_ID } from './item.js'
import { root_data } from './server/root.js'

// import * as mod_types from './type.js'
// import {LitElement, html, css} from "https://unpkg.com/lit-element/lit-element.js?module";


export function isRoot(id) { return id === ROOT_ID }


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

    // global flags onServer/onClient to indicate the environment where the code is executing
    onServer = true
    get onClient() { return !this.onServer }

    db                      // database for accessing items and other data from database servers
    root                    // permanent reference to a singleton root Category object, kept here instead of cache
    site                    // fully loaded Site instance that will handle all web requests
    session                 // current web Session, or undefined; max. one session is active at a given moment

    cache = new ItemsCache()


    /***  Initialization  ***/

    constructor(db) {
        if(db) this.db = db
    }

    static async createGlobal(db, ...args) {
        let registry = globalThis.registry = new this(db, ...args)
        await registry._init_classpath()
        await registry.boot()               // typically, `db` here is provisional or missing, so boot() will only create `root` not `site` - can be called again later
        return registry
    }

    async boot(site_id = null) {
        /* (Re)create/load `this.root` and `this.site`. The latter will be left undefined if not present in the DB. */
        this.root = await this._init_root()             // always returns a valid object, possibly created from `root_data`
        this.site = await this._init_site(site_id)      // may return an undefined
        // if (!this.site) print('Registry.boot(): site is undefined')
        // else print('Registry.boot(): site defined')
    }

    async _init_classpath() {
        // print('initClasspath() started...')
        let classpath = new Classpath

        // classpath.setMany("schemat.data", Map)                             // schemat.data.Map
        // await classpath.setModule("schemat.data", "./data.js")
        // await classpath.setModule("schemat.type", "./type.js")

        // add Catalog & Data to the classpath
        classpath.setMany("", Catalog, Data)

        // add all schema subtypes (all-caps class names) + SchemaWrapper
        await classpath.setModule("", "./type.js", {accept: (name) =>
                name.toUpperCase() === name || name === 'SchemaWrapper'
        })

        this.classpath = classpath
        // print('initClasspath() done')
    }

    async _init_root() {
        /* Create the RootCategory object, ID=(0,0), and load its contents either from the DB (if present there)
           or from the predefined `root_data`.
         */
        let root = this.root = new RootCategory(this)

        // try loading `root` from the DB first...
        if (this.db)
            try {
                await root.reload()
                assert(root.isLoaded)
                // print("root category loaded from DB")
            } catch (ex) {
                if (!(ex instanceof ItemNotFound)) throw ex
            }

        // ...only when the above fails due to missing data, load from the predefined `root_data`
        if (!root.isLoaded) {
            await root.reload(root_data)
            print("Registry._init_root(): root category loaded from root_data")
        }

        return root
    }

    async _init_site(site_id = null) {
        /* (Re)load and return the `site` object, if present in the database, otherwise return undefined. */
        if (!this.db) return
        try {
            if (!site_id)
                if (this.onClient) return
                else site_id = await this._find_site()
            return await this.getLoaded(site_id)
        } catch (ex) {
            if (!(ex instanceof ItemNotFound)) throw ex
        }
    }

    async _find_site() {
        /* Retrieve an ID of the first Site item (CID=1) found by scanCategory() in the DB. */
        assert(this.onServer)
        let Site = await this.getLoaded(SITE_ID)
        let scan = this.scan(Site, {limit: 1})
        let ret  = await scan.next()
        if (!ret || ret.done) throw new ItemNotFound(`no Site item found in the database`)
        return ret.value.xid
    }


    /***  Items manipulation  ***/

    getItem(id, {version = null} = {}) {
        /* Get a read-only instance of an item with a given ID, possibly a stub. A cached copy is returned,
           if present, otherwise a stub is created anew and saved in this.cache for future calls.
         */
        this.session?.countRequested(id)
        if (isRoot(id)) return this.root

        // ID requested was already loaded/created? return the existing instance
        let item = this.cache.get(id)
        if (item) return item

        let stub = new Item(this, id)
        this.cache.set(id, stub)        // a stub, until loaded, has no expiry date that means immediate removal at the end of session
        return stub
    }

    async getLoaded(id)     { return this.getItem(id).load() }

    // async findItem(path) { return this.site.findItem(path) }

    async loadData(id) {
        /* Load item's full data record from server-side DB and return as a dict with keys: cid, iid, data, (meta?).
           Note that `data` can either be a JSON-encoded string, or a schema-encoded object
           - the caller must be prepared for both cases!
         */
        this.session?.countLoaded(id)
        return this.db.select(id)
    }
    async *scan(category = null, {limit} = {}) {
        /* Load from DB all items of a given category ordered by IID. Each item's data is already loaded. A generator. */
        if (category) category.assertLoaded()

        let count = 0
        let cid = category?.id
        let records = this.db.scan(cid)         // the cid argument is only used (and needed!) on the client side where this.db is AjaxDB

        for await (const record of records) {
            if (limit !== undefined && count >= limit) break
            let item = this.itemFromRecord(record, cid)
            if (item instanceof Promise) item = await item
            if (item) { yield item; count++ }
        }
    }

    itemFromRecord(record, cid) {
        /* Convert a record from DB into a booted item. If category's id is provided (`cid`), return the item only when
           the category's id matches, otherwise return undefined. May return a Promise. */
        // yield isRoot(id) ? this.root : Item.createBooted(this, id, {dataJson})
        const {id, data: dataJson} = record
        if (isRoot(id)) return cid === undefined || cid === ROOT_ID ? this.root : undefined
        let data = JSONx.parse(dataJson)
        if (!(data instanceof Data)) data = new Data(data)
        if (cid === undefined || cid === data.get('__category__').id)
            return Item.createBooted(this, id, {dataJson})
    }


    /***  Object <=> classpath mapping (for de/serialization)  ***/

    getPath(cls) {
        /* Return a dotted module path of a given class or function as stored in a global Classpath.
           `cls` should be either a constructor function, or a prototype with .constructor property.
         */
        if (typeof cls === "object")            // if `cls` is a class prototype, take its constructor instead
            cls = cls.constructor
        if (!cls) throw `Argument is empty or not a class: ${cls}`

        return this.classpath.encode(cls)
    }

    getClass(path) {
        /* Get a global object - class or function from a virtual package (Classpath) - pointed to by `path`. */
        return this.classpath.decode(path)  //this.site.getObject(path)
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


/**********************************************************************************************************************
 **
 **  WEB SESSION
 **
 */

export class Session {
    /* Collection of objects that are global to a single request processing. Also holds an evolving state of the latter. */

    registry            // instance of Registry
    req                 // instance of node.js express' Request (only present server-side)
    res                 // instance of node.js express' Response (only present server-side)

    get channels()      { return [this.req, this.res] }
    get path()          { return this.req.path }        // URL path, same as req.path, with @method name included (!)
    get method()        { return this.req.method }      // "GET" or "POST"

    // context & state of request processing; built gradually by subsequent nodes on the request route...

    //apps              // dict {...} of applications that occured on the current route, e.g., apps.posts, apps.comments ...
    //url               // dict {...} of URL-generation functions for the apps encountered along the route: url['posts'](nextPost)

    app                 // leaf Application object the request is addressed to
    item                // target item that's responsible for actual handling of the request
    // state = {}          // app-specific temporary data that's written during routing (handle()) and can be used for
    //                     // response generation when a specific app's method is called, most typically urlPath()
    //                     // TODO: only keep `route` instead of `app` for URL generation - Site.urlPath()

    // // req.query.PARAM is a string if there's one occurrence of PARAM in a query string,
    // // or an array [val1, val2, ...] if PARAM occurs multiple times
    // print('request query: ', req.query)
    // print('request body:  ', req.body)

    releaseMutex        // release function for registry.sessionMutex to be called at the end of this session

    itemsRequested = new ItemsCount()       // for each item ID: no. of times the item was requested through registry.getItem() during this session
    itemsLoaded    = new ItemsCount()       // for each item ID: no. of times the item data was loaded through registry.loadData()

    constructor(registry, req, res) {
        this.registry = registry
        this.req = req
        this.res = res
    }

    async start()   { this.releaseMutex = await this.registry.startSession(this) }
    async stop()    { return this.registry.stopSession(this.releaseMutex) }
    printCounts()   { print(`items requested ${this.itemsRequested.total()} times: `, this.itemsRequested)
                      print(`items loaded ${this.itemsLoaded.total()} times:    `, this.itemsLoaded) }

    redirect(...args)       { this.res.redirect(...args)   }
    send(...args)           { this.res.send(...args)       }
    sendFile(...args)       { this.res.sendFile(...args)   }
    sendStatus(...args)     { this.res.sendStatus(...args) }
    // sendItem(...args)       { this.res.sendItem(...args)   }
    // sendItems(...args)      { this.res.sendItems(...args)  }

    countRequested(id)      { this.itemsRequested.add(id) }
    countLoaded(id)         { this.itemsLoaded.add(id)    }

    dump() {
        /* Session data and a list of bootstrap items to be embedded in HTML response, state-encoded. */
        let site  = this.registry.site
        let items = [this.item, this.item.category, this.registry.root, site, this.app]
        items = [...new Set(items)].filter(Boolean)             // remove duplicates and nulls
        let records = items.map(i => i.recordEncoded())

        let {app, item} = this
        let session = {app, item}                               // truncated representation of the current session
        let system_url = site.systemURL()

        return {site_id: site.xid, system_url, session: JSONx.encode(session), items: records}
    }

    static load(registry, sessionData) {
        /* Create a Session instance, client-side, from state-encoded data.session as generated by dump(). */
        let session = new Session(registry)
        let {app, item} = JSONx.decode(sessionData)
        Object.assign(session, {app, item})
        return session
    }
}
