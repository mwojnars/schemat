'use strict'

import { print, assert, T, escape_html, splitLast, concat, unique } from './utils.js'
import {NotFound, NotLinked, NotLoaded} from './errors.js'

import { JSONx } from './serialize.js'
import { Path, Catalog, Data } from './data.js'
import {DATA, DATA_GENERIC, generic_type} from "./type.js"
import {HttpService, JsonService, API, Task, TaskService, InternalService, Network} from "./services.js"
import {CategoryAdminPage, ItemAdminPage} from "./pages.js";
import {ItemRecord} from "./db/records.js";
import {DataRequest} from "./db/data_request.js";

export const ROOT_ID = 0
export const SITE_CATEGORY_ID = 1


// import * as utils from 'http://127.0.0.1:3000/system/local/utils.js'
// import * as utils from 'file:///home/..../src/schemat/utils.js'
// print("imported utils from localhost:", utils)
// print('import.meta:', import.meta)

/**********************************************************************************************************************
 **
 **  UTILITIES
 **
 */

// class Changes {
//     /* List of changes to item's data that have been made by a user and can be submitted
//        to the server and applied in DB. Multiple edits of the same data entry are merged into one.
//      */
//     constructor(item) { this.item = item }
//     reset() { print('Reset clicked') }
//     submit() { print('Submit clicked') }
//     Buttons() {
//         return DIV({style: {textAlign:'right', paddingTop:'20px'}},
//             BUTTON({id: 'reset' , name: 'btn btn-secondary', onClick: this.reset,  disabled: false}, 'Reset'), ' ',
//             BUTTON({id: 'submit', name: 'btn btn-primary',   onClick: this.submit, disabled: false}, 'Submit'),
//         )
//     }
// }

// AsyncFunction class is needed for parsing from-DB source code
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor


/**********************************************************************************************************************
 **
 **  REQUEST (custom Schemat's)
 **
 */

export class Request {
    /* Custom representation of a web request (.session defined) or internal request (no .session),
       together with context information that evolves during the routing procedure.
     */

    static SEP_ROUTE  = '/'         // separator of route segments in URL paths
    static SEP_METHOD = '@'         // separator of a method name within a URL path

    static PathNotFound = class extends NotFound {
        static message = "URL path not found"
    }

    throwNotFound(msg, args)  { throw new Request.PathNotFound(msg, args || {'path': this.pathFull, 'remaining': this.path}) }


    get req()       { return this.session?.req }
    get res()       { return this.session?.res }

    protocol        // CALL, GET, POST, (SOCK in the future); there can be different services exposed at the same endpoint-name but different protocols
    session         // Session object; only for top-level web requests (not for internal requests)
    pathFull        // initial path, trailing @method removed; stays unchanged during routing (no truncation)
    path            // remaining path to be consumed by subsequent nodes along the route;
                    // equal pathFull at the beginning, it gets truncated while the routing proceeds

    args            // dict of arguments for the handler function; taken from req.query (if a web request) or passed directly (internal request)
    methods = []    // names of access methods to be tried for a target item; the 1st method that's present on the item will be used, or 'default' if `methods` is empty

    item            // target item responsible for actual handling of the request, as found by the routing procedure
    endpoint        // endpoint of the target item, as found by the routing procedure

    get position() {
        /* Current position of routing along pathFull, i.e., the length of the pathFull's prefix consumed so far. */
        assert(this.pathFull.endsWith(this.path))
        return this.pathFull.length - this.path.length
    }

    get route() {
        /* Part of the pathFull consumed so far: pathFull = route + path */
        return this.pathFull.slice(0, this.position)
    }

    constructor({path, method, session}) {
        this.session = session
        this.protocol =
            !session                    ? "CALL" :          // CALL = internal call through Site.route()
            session.method === 'GET'    ? "GET"  :          // GET  = read access through HTTP GET
                                          "POST"            // POST = write access through HTTP POST

        let meth, sep = Request.SEP_METHOD
        ;[this.pathFull, meth] = path.includes(sep) ? splitLast(path, sep) : [path, '']

        // in Express, the web path always starts with at least on character, '/', even if the URL contains a domain alone;
        // this leading-trailing slash has to be truncated for correct segmentation and detection of an empty path
        if (this.pathFull === '/') this.pathFull = ''
        this.path = this.pathFull
        this.pushMethod(method, '@' + meth)
    }

    copy() {
        let request = T.clone(this)
        request.methods = [...this.methods]
        return request
    }

    _prepare(method) {
        if (!method) return method
        assert(method[0] === Request.SEP_METHOD, `method name must start with '${Request.SEP_METHOD}' (${method})`)
        return method.slice(1)
    }

    pushMethod(...methods) {
        /* Append names to this.methods. Each name must start with '@' for easier detection of method names
           in a source code - this prefix is truncated when appended to this.methods.
         */
        for (const method of methods) {
            let m = this._prepare(method)
            if (m && !this.methods.includes(m)) this.methods.push(m)
        }
    }

    step() {
        if (!this.path) return undefined
        if (this.path[0] !== '/') throw new Error(`missing leading slash '/' in a routing path: '${this.path}'`)
        return this.path.slice(1).split(Request.SEP_ROUTE)[0]
    }

    move(step = this.step()) {
        /* Truncate `step` or this.step() from this.path. The step can be an empty string. Return this object. */
        if (step === undefined) this.throwNotFound()
        if (step) {
            assert(this.path.startsWith('/' + step))
            this.path = this.path.slice(1 + step.length)
        }
        return this             //Object.create(this, {path: path})
    }

    pushApp(app) {
        this.app = app
        return this
    }

    settleEndpoint(endpoint) {
        /* Settle the endpoint for this request. */
        this.endpoint = endpoint
    }
}


/**********************************************************************************************************************
 **
 **  ITEM & CATEGORY
 **
 */

const proxy_handler = {
    /* Proxy handler for all network objects: stubs or loaded from DB. Combines POJO attributes with loaded properties
       and in this way facilitates caching of computed properties in plain attributes of the `target` object.
     */

    // UNDEFINED token marks that the value has already been fully computed, with inheritance and imputation,
    // and still remained undefined, so it should *not* be computed again
    UNDEFINED: Symbol.for('proxy_handler.UNDEFINED'),

    // these props can never be found inside item's schema and should always be accessed as regular object attributes
    _reserved: ['_id_', '_meta_', '_data_', '_record_'],

    get(target, prop, receiver) {
        let value = Reflect.get(target, prop, receiver)
        if (value === proxy_handler.UNDEFINED) return undefined
        if (value !== undefined) return value

        // there are many queries for 'then' because after a promise resolves, its result is checked for .then to see if it's another promise
        if (prop === 'then') return undefined

        // if (prop.length >= 2 && prop[0] === '_' && prop[prop.length - 1] === '_')    // _***_ props are reserved for internal use
        if (proxy_handler._reserved.includes(prop))
            return undefined

        // console.log('get', prop)

        if (target._data_) {
            let stream = target._scan_entries(prop, {silent: true})
            let entry = stream.next().value
            if (entry) return entry.value
        }
        // return target.prop(prop, {schemaless: true})
        // let data = target._data_
        // if (data?.has(prop)) return data.get(prop)
    },
    // set(target, prop, value, receiver) {
    //     // console.log('set', prop)
    //     return Reflect.set(target, prop, value, receiver)
    // },
}


export class Item {

    /*
    An application object that is persisted in a database, has a unique ID, is potentially accessible by a URL,
    and can communicate with its own instances on other machines.

    >> meta fields are accessible through this.get('#FIELD') or '.FIELD' ?
    >> item.getName() uses a predefined data field (name/title...) but falls back to '#name' when the former is missing
    - ver      -- current version 1,2,3,...; increased +1 after each modification of the item; null if no versioning
    - last_update -- [UUID of the last "update request" message + set of output changes]; ensures idempotency of updates within kafka transactions:
                     when a transaction is aborted, but the update was already written (without change propagation to derived indexes),
                     the resumed transaction only sends out all change requests without rewriting the same update;
                     after successful commit, the item record is re-written with the `last_update` field removed
    - cver     -- version of the category that encoded this item's data; the exact same version must perform decoding
    - sum      -- checksum of `data` (or of full item with `sum` value excluded) to detect corruption due to disk i/o errors etc.
    - itime, utime -- "inserted" timestamp, last "updated" timestamp
      created, updated -- Unix timestamps [sec] or [ms]; converted to local timezone during select (https://stackoverflow.com/a/16751478/1202674)
    ? owner(s) + permissions -- the owner can be a group of users (e.g., all editors of a journal, all site admins, ...)
    - honey    -- honeypot; artificial empty item for detection of spambots
    - draft    -- this item is under construction, not fully functional yet (app-level feature) ??
    - mock     -- a mockup object created for unit testing or integration tests; should stay invisible to users and be removed after tests
    - removed  -- undelete during a predefined grace period since updated_at, eg. 1 day; after that, `data` is removed, but id+meta stay
    - moved    -- ID of another item that contains more valid/complete data and replaces this one
    - stopper  -- knowingly invalid item that's kept in DB to prevent re-insertion of the same data again; with a text explanation
    - boot     -- true for a bootstrap item whose raw edits need to be saved to bootedits.yaml after being applied in DB
    ? status   -- enum, "deleted" for tombstone items
    ? name     -- for fast generation of lists of hyperlinks without loading full data for each item; length limit ~100
    ? info     -- a string like `name`, but longer ~300-500 ??
    */

    // static CODE_DOMAIN = 'schemat'      // domain name to be prepended in source code identifiers of dynamically loaded code


    /***  System properties  ***/

    /* _id_:
       database ID of the object, globally unique; undefined in a newly created item; should never be changed
       for an existing item, that's why the property is set to read-only after the first assignment
    */
    get _id_()   { return undefined }
    set _id_(id) {
        if (id === undefined) return
        Object.defineProperty(this, '_id_', {value: id, writable: false})
    }

    /* _record_:
       ItemRecord that contains this item's ID and data as loaded from DB during last load() or assigned directly;
       undefined in a newborn item; immutable after the first assignment
    */
    get _record_() {
        this.assert_linked()
        this.assert_loaded()
        return this._record_ = new ItemRecord(this._id_, this._data_)
    }
    set _record_(record) {
        assert(record)
        assert(record.id === this._id_)
        Object.defineProperty(this, '_record_', {value: record, writable: false})
    }

    _data_          // data fields of this item, as a Data object; created during .load()

    _schema_        // schema of this item's data, as a DATA object; calculated as an imputed property

    // _category_      // category of this item, as a Category object
    // _class_         // class of this item, as a JS class object; created during .load()

    _proxy_         // Proxy wrapper around this object created during instantiation and used for caching of computed properties
    _self_          // a reference to `this`; for proper caching of computed properties when this object is used as a prototype (e.g., for View objects) and this <> _self_ during property access

    _meta_ = {                  // Schemat-related special properties of this object and methods to operate on it...
        target:  this,          // the target object itself
        loading: false,         // Promise created at the start of _load(), indicates that the item is currently loading its data from DB
        mutable: false,         // true if item's data can be modified through .edit(); editable item may contain uncommitted changes and must be EXCLUDED from Registry
        expiry:  undefined,     // timestamp [ms] when this item should be evicted from Registry.cache; 0 = NEVER, undefined = immediate
        props_cache: new Map(), // cache of computed properties, {prop: array_of_entries}; each array consists of own data + inherited, or just schema default / imputed
        calls_cache: new Map(), // cache of method calls, {method: value}, of no-arg calls of methods registered thru setCaching(); values can be Promises!

        // db         // the origin database of this item; undefined in newborn items
        // ring       // the origin ring of this item; updates are first sent to this ring and only moved to an outer one if this one is read-only

        set_id(id) {
            /* Like obj._id_ = id, but allows re-setting with the same ID value. */
            let prev = this.target._id_
            if (prev !== undefined) assert(prev === id, `ID is read-only and can't be changed from ${prev} to ${id}`)
            else this.target._id_ = id
            return id
        },
    }

    registry        // Registry that manages access to this item

    _net_           // Network adapter that connects this item to its network API as defined in this.constructor.api
    action          // triggers for RPC actions of this item; every action can be called from a server or a client via action.X() call

    static api        = null    // API instance that defines this item's endpoints and protocols
    static actions    = {}      // specification of action functions (RPC calls), as {action_name: [endpoint, ...fixed_args]}; each action is accessible from a server or a client

    // get category()  { return this._category_ }
    // set category(c) { this._category_ = c }

    is_linked()     { return this._id_ !== undefined }                  // object is "linked" when it has an ID, which means it's persisted in DB or is a stub of an object to be loaded from DB
    is_loaded()     { return this._data_ && !this._meta_.loading }      // false if still loading, even if data has already been created but object's not fully initialized

    assert_linked() { if (!this.is_linked()) throw new NotLinked(this) }
    assert_loaded() { if (!this.is_loaded()) throw new NotLoaded(this) }


    /***  Instantiation & initialization  ***/

    constructor(_fail_ = true) {
        /* For internal use! Always call Item.create() instead of `new Item()`. */
        if(_fail_) throw new Error('item should be instantiated through Item.create() instead of new Item()')
        this._self_ = this      // for proper caching of computed properties when this object is used as a prototype (e.g., for View objects)
        this.registry = globalThis.registry
    }

    __create__(...args) {
        /* Override in subclasses to initialize properties of a newborn item (not from DB) returned by Item.create(). */
    }

    static create(...args) {
        /* Create an empty newborn item, no ID, and execute its __create__(...args). Return the item.
           This function, or create_stub(id), should be used instead of the constructor.
           If __create__ is overloaded and returns a Promise, this function returns a Promise too.
         */
        let item = this.create_stub()
        let created = item.__create__(...args)
        if (created instanceof Promise) return created.then(() => item)
        return item
    }

    static create_stub(id) {
        /* Create a stub: an empty item with `id` assigned. To load data, load() must be called afterwards. */
        let core = new this(false)
        let item = core._proxy_ = new Proxy(core, proxy_handler)
        if (id !== undefined) core._id_ = id
        return item
    }

    static async from_binary(binary_record /*Record*/) {
        let item_record = ItemRecord.from_binary(binary_record)
        return Item.from_record(item_record)
    }

    static async from_record(record /*ItemRecord*/, use_registry = true) {
        /* Create a new item instance: either a newborn one (intended for insertion to DB, no ID yet);
           or an instance loaded from DB and filled out with data from `record` (an ItemRecord).
           In any case, the item returned is *booted* (this._data_ is initialized).
         */
        // TODO: if the record is already cached in binary registry, return the cached item...
        // TODO: otherwise, create a new item and cache it in binary registry
        let item = Item.create_stub(record.id)
        return item.load(record)
    }

    static create_api(endpoints, actions = {}) {
        /* Create .api and .actions of this Item (sub)class. */
        let base = Object.getPrototypeOf(this)
        if (!T.isSubclass(base, Item)) base = undefined
        this.api = new API(base ? [base.api] : [], endpoints)
        this.actions = base ? {...base.actions, ...actions} : actions
    }


    /***  Loading from DB  ***/

    async refresh() {
        /* Get the most current instance of this item from the registry - can differ from `this` (!) - and make sure it's loaded. */
        return this.registry.getItem(this._id_).load()
    }

    async load(record = null /*ItemRecord*/) {
        /* Load full data of this item from `record` or from DB, if not loaded yet. Return this object.
           The data can only be loaded ONCE for a given Item instance due to item's immutability.
           If you want to refresh the data, create a new instance or use refresh() instead.
         */
        if (this.is_loaded()) { assert(!record); return this }
        if (this._meta_.loading) return assert(!record) && this._meta_.loading    // wait for a previous load to complete instead of starting a new one
        if (!this.is_linked() && !record) return this           // newborn item with no ID and no data to load? fail silently; this allows using the same code for both newborn and in-DB items
        return this._meta_.loading = this._load(record)         // keep a Promise that will eventually load this item's data to avoid race conditions
    }

    async _load(record = null /*ItemRecord*/) {
        /* Load this._data_ from `record` or DB. Set up the class and prototypes. Call __init__(). */
        try {
            record = record || await this._load_record()
            assert(record instanceof ItemRecord)

            this._data_ = record.data
            if (record.id !== undefined)                        // don't keep a record without ID: it's useless and creates inconsistency when ID is assigned
                this._record_ = record

            let proto = this._init_prototypes()                 // load prototypes
            if (proto instanceof Promise) await proto

            // // root category's class must be set here in a special way - this is particularly needed inside DB blocks,
            // // while instantiating temporary items from data records (so new Item() is called, not new RootCategory())
            // if (this._id_ === ROOT_ID) T.setClass(this, RootCategory)

            // this._data_ is already loaded, so _category_ should be available IF defined (except non-categorized objects)
            let category = this._category_

            if (category && !category.is_loaded() && category !== this)
                await category.load()

            await this._init_class()                            // set the target JS class on this object; stubs only have Item as their class, which must be changed when the item is loaded and linked to its category
            this._init_network()

            let init = this.__init__()                          // optional custom initialization after the data is loaded
            if (init instanceof Promise) await init             // must be called BEFORE this._data_=data to avoid concurrent async code treat this item as initialized

            this._set_expiry(category?.prop('cache_ttl'))

            return this

        } finally {
            this._meta_.loading = false                         // cleanup to allow another load attempt, even after an error
        }
    }

    async _load_record() {
        this.assert_linked()
        schemat.registry.session?.countLoaded(this._id_)

        let req = new DataRequest(this, 'load', {id: this._id_})
        let json = await schemat.db.select(req)
        assert(typeof json === 'string', json)
        return new ItemRecord(this._id_, json)
    }

    _set_expiry(ttl) {
        /* Time To Live (ttl) is expressed in seconds. */
        let expiry
        if (ttl === undefined) return                       // leave the expiry date unchanged
        if (ttl === 'never' || ttl < 0) expiry = 0          // never evict
        else if (ttl === 0) expiry = undefined              // immediate eviction at the end of web session
        else expiry = Date.now() + ttl * 1000
        this._meta_.expiry = expiry
    }

    _init_prototypes() {
        /* Load all Schemat prototypes of this object. */
        let prototypes = this.getPrototypes()
        // for (const p of prototypes)        // TODO: update the code below to verify ._category_ instead of CIDs
            // if (p.cid !== this.cid) throw new Error(`item ${this} belongs to a different category than its prototype (${p})`)
        prototypes = prototypes.filter(p => !p.is_loaded())
        if (prototypes.length === 1) return prototypes[0].load()            // performance: trying to avoid unnecessary awaits or Promise.all()
        if (prototypes.length   > 1) return Promise.all(prototypes.map(p => p.load()))
    }

    async _init_class() {
        /* Initialize this item's class, i.e., substitute the object's temporary Item class with an ultimate subclass. */
        // if (this._category_ === this) return                      // special case for RootCategory: its class is already set up, must prevent circular deps
        // T.setClass(this, await this._category_.getItemClass())    // change the actual class of this item from Item to the category's proper class
        T.setClass(this, await this.getClass() || Item)    // change the actual class of this item from Item to the category's proper class
    }

    _init_network() {
        /* Create a .net connector and .action triggers for this item's network API. */
        let role = this.registry.onServer ? 'server' : 'client'
        this._net_ = new Network(this, role, this.constructor.api)
        this.action = this._net_.createActionTriggers(this.constructor.actions)
    }

    __init__() {}
        /* Optional item-specific initialization after this._data_ is loaded.
           Subclasses may override this method as either sync or async.
         */
    __done__() {}
        /* Custom clean up to be executed after the item was evicted from the Registry cache. Can be async. */

    instanceof(category) {
        /* Check whether this item belongs to a `category`, or its subcategory.
           All comparisons along the way use item IDs, not object identity. The item must be loaded.
        */
        return this._category_.inherits(category)
    }
    inherits(parent) {
        /* Return true if `this` inherits from a `parent` item through the item prototype chain (NOT javascript prototypes).
           True if parent==this. All comparisons by item ID.
         */
        if (schemat.equivalent(this, parent)) return true
        for (const proto of this.getPrototypes())
            if (proto.inherits(parent)) return true
        return false
    }

    /***  Dynamic loading of source code  ***/

    async getClass()    { return this.prop('_class_') || this._category_?.getItemClass() }

    // async getClass()    {
    //     if (this.category && !this.category.getItemClass) {
    //         print('this.category:', this.category)
    //         print('getItemClass:', this.category.getItemClass)
    //     }
    //     return this.category?.getItemClass()
    // }

    // getClass() {
    //     /* Create/parse/load a JS class for this item. If `custom_class` property is true, the item may receive
    //        a custom subclass (different from the category's default) built from this item's own & inherited `code*` snippets.
    //      */
    //     return this.category.getItemClass()
    //     // let base = this.category.getItemClass()
    //     // let custom = this.category.get('custom_class')
    //     // return custom ? this.parseClass(base) : base
    // }

    // parseClass(base = Item) {
    //     /* Concatenate all the relevant `code_*` and `code` snippets of this item into a class body string,
    //        and dynamically parse them into a new class object - a subclass of `base` or the base class identified
    //        by the `class` property. Return the base if no code snippets found. Inherited snippets are included in parsing.
    //      */
    //     let name = this.get('_boot_class')
    //     if (name) base = this.registry.getClass(name)
    //
    //     let body = this.mergeSnippets('class')           // full class body from concatenated `code` and `code_*` snippets
    //     if (!body) return base
    //
    //     let url = this.sourceURL('class')
    //     let import_ = (path) => {
    //         if (path[0] === '.') throw Error(`relative import not allowed in dynamic code of a category (${url}), path='${path}'`)
    //         return this.registry.site.import(path)
    //     }
    //     let source = `return class extends base {${body}}` + `\n//# sourceURL=${url}`
    //     return new Function('base', 'import_', source) (base, import_)
    // }
        // let asyn = body.match(/\bawait\b/)              // if `body` contains "await" word, even if it's in a comment (!),
        // let func = asyn ? AsyncFunction : Function      // an async function is created instead of a synchronous one

    // parseMethod(path, ...args) {
    //     let source = this.get(path)
    //     let url = this.sourceURL(path)
    //     return source ? new Function(...args, source + `\n//# sourceURL=${url}`) : undefined
    // }

    // sourceURL(path) {
    //     /* Build a sourceURL string for the code parsed dynamically from a data element, `path`, of this item. */
    //     function clean(s) {
    //         if (typeof s !== 'string') return ''
    //         return s.replace(/\W/, '')                  // keep ascii-alphanum characters only, drop all others
    //     }
    //     let domain   = Item.CODE_DOMAIN
    //     let cat_name = clean(this.get('name'))
    //     let fil_name = `${cat_name}_${this.id_str}`
    //     return `${domain}:///items/${fil_name}/${path}`
    //     // return `\n//# sourceURL=${url}`
    // }


    /***  READ access to item's data  ***/

    // propObject(...paths) -- multiple prop(path) values wrapped up in a single POJO object {path_k: value_k}
    // prop(path)    -- the first value matching a given path; POJO attribute's value as a fallback
    // props(path)   -- stream of values matching a given path
    // entries(prop) -- stream of entries for a given property

    prop(path, opts = {}) {
        /* Read the item's property either from this._data_, or (if missing) from this POJO's regular attribute
           - this allows defining attributes either through DB or item's class constructor.
           If there are multiple values for 'path', the first one is returned.
           `opts` are {default, schemaless}.
         */
        // POJO attribute value as a default
        let value = this[path]

        if (this._data_) {
            // this._data_: a property can be read before the loading completes (!), e.g., for use inside __init__();
            // a "shadow" item doesn't map to a DB record, so its props can't be read with this.props() below
            let value = this.props(path, opts).next().value
            if(value === proxy_handler.UNDEFINED) print('UNDEFINED #1', path, this)
            if (value !== undefined) return value

            // // before falling back to a default value stored in a POJO attribute,
            // // check that 'path' is valid according to schema, to block access to system fields like ._data_ etc
            // if (!opts.schemaless) {
            //     let schema = this._schema_  //getSchema()
            //     let [prop] = Path.split(path)
            //     if (schema && !schema.isValidKey(prop)) throw new Error(`not in schema: ${prop}`)
            // }
        }

        if(value === proxy_handler.UNDEFINED) print('UNDEFINED #2', path, this)
        if (value !== undefined) return value

        return opts.default
    }

    *props(path, opts) {
        /* Generate a stream of all (sub)property values that match a given `path`. The path should start with
           a top-level property name, followed by subproperties separated by '/'. Alternatively, the path
           can be an array of subsequent property names, or positions (in a nested array or Catalog).
         */
        let [prop, tail] = Path.splitAll(path)
        for (const entry of this._scan_entries(prop, opts))     // find all the entries for a given `prop`
            yield* Path.walk(entry.value, tail)                 // walk down the `tail` path of nested objects
    }

    propsList(path)         { return [...this.props(path)] }
    propsReversed(path)     { return [...this.props(path)].reverse() }

    *_scan_entries(prop, {schemaless=false, silent=false} = {}) {
        /* Generate a stream of valid entries for a given property: own entries followed by inherited ones;
           or the default entry (if own/inherited are missing), or an imputed entry.
           If the schema doesn't allow multiple entries for `prop`, the first one is yielded (for atomic types),
           or the objects (own, inherited & default) get merged into one (for "mergeable" types like CATALOG).
           Once computed, the list of entries is cached for future use.
           If schemaless=true, a concatenated stream of all matching entries is returned without caching -
           for system properties, like _category_, which are processed when the schema is not yet available.
         */
        if (!this._data_) throw new NotLoaded(this)
        assert(typeof prop === 'string')

        let entries = this._meta_.props_cache.get(prop)                         // array of entries, or undefined
        if (entries) yield* entries

        // below, `this` is included at the 1st position among ancestors;
        // `streams` is a function so its evaluation can be omitted if a non-repeated value is already available in this._data_
        let streams = () => this.getAncestors().map(proto => proto._data_.readEntries(prop))   //proto[`${prop}_array`]

        if (prop === '_category_')
            entries = concat(streams().map(stream => [...stream]))
        else {
            // let schema = this.getSchema()
            // let schema = this._schema_     // doesn't work here due to circular deps on properties

            let category = this._proxy_._category_
            let schema = category?.getItemSchema() || new DATA_GENERIC()
            let type = schema.get(prop)

            if (!type)
                if (!silent) throw new Error(`not in schema: '${prop}'`)
                else return

            if (!type.isRepeated() && !type.isCompound() && this._data_.has(prop))
                entries = [this._data_.getEntry(prop)]                        // non-repeated value is present in `this`, can skip inheritance to speed up
            else
                entries = type.combineStreams(streams(), this)            // `default` or `impute` property of the schema may be applied here

            this._meta_.props_cache.set(prop, entries)
        }

        // cache the result in a plain attribute in this._self_; _self_ is used instead of `this` because the latter
        // can be a derived object (e.g., a View) whose prototype is _self_
        this._self_[prop] = entries.length && (entries[0].value !== undefined) ? entries[0].value : proxy_handler.UNDEFINED
        this._self_[`${prop}_array`] = entries.map(entry => entry.value)

        yield* entries
    }

    // object(first = true) {
    //     /* Return this._data_ converted to a plain object. For repeated keys, only one value is included:
    //        the first one if first=true (default), or the last one, otherwise.
    //        TODO: for repeated keys, return a sub-object: {first, last, all} - configurable in schema settings
    //       */
    //     this.assert_loaded()
    //     let obj = this._data_.object(first)
    //     obj.__item__ = this
    //     return obj
    // }

    getAncestors() {
        /* Linearized list of all ancestors, with `this` at the first position.
           TODO: use C3 algorithm to preserve correct order (MRO, Method Resolution Order) as used in Python:
           https://en.wikipedia.org/wiki/C3_linearization
           http://python-history.blogspot.com/2010/06/method-resolution-order.html
         */
        let ancestors = this.getPrototypes().map(proto => proto.getAncestors())
        return [this, ...unique(concat(ancestors))]
    }

    getPrototypes()     { return this._data_.getValues('extends') }


    getName() { return this.prop('name') || '' }
    getPath() {
        /* Default URL import path of this item, for interpretation of relative imports in dynamic code inside this item.
           Starts with '/' (absolute path). */
        return this.prop('path') || this.registry.site.systemPath(this)
    }

    getStamp({html = true, brackets = true, max_len = null, ellipsis = '...'} = {}) {
        /*
        "Category-Item ID" (CIID) string (stamp) of the form:
        - [CATEGORY-NAME:IID], if the category of this has a "name" property; or
        - [CID:IID] otherwise.
        If html=true, the first part (CATEGORY-NAME or CID) is hyperlinked to the category's profile page
        (unless URL failed to generate) and the CATEGORY-NAME is HTML-escaped. If max_len is not null,
        CATEGORY-NAME gets truncated and suffixed with '...' to make its length <= max_len.
        */
        let cat = this._category_?.getName() || ""
        if (max_len && cat.length > max_len) cat = cat.slice(max_len-3) + ellipsis
        if (html) {
            cat = escape_html(cat)
            let url = this._category_?.url()
            if (url) cat = `<a href="${url}">${cat}</a>`          // TODO: security; {url} should be URL-encoded or injected in a different way
        }
        let stamp = cat ? `${cat}:${this._id_}` : `${this._id_}`
        if (!brackets) return stamp
        return `[${stamp}]`
    }

    // getSchema() {
    //     /* Return schema of this item (instance of DATA), or of a particular `field`. */
    //     return this.category?.getItemSchema() || new DATA_GENERIC()
    // }

    // getSchema(path = null) {
    //     /* Return schema of this item (instance of DATA), or of a given `path` inside nested catalogs,
    //        as defined in this item's category's `fields` property. */
    //     let schema = this.category.getItemSchema()
    //     if (!path?.length) return schema
    //
    //     assert(false, 'getSchema() is never used with an argument')
    //
    //     this.assert_loaded()
    //     let keys = [], data = this._data_
    //
    //     // convert numeric indices in `path` to keys
    //     for (let step of path) {
    //         assert(data instanceof Catalog)
    //         let entry = data.getEntry(step)                     // can be undefined for the last step of `path`
    //         keys.push(typeof step === 'number' ? entry.key : step)
    //         data = entry?.value
    //     }
    //     return schema.find(keys)
    // }

    mergeSnippets(key, params) {
        /* Retrieve all source code snippets (inherited first & own last) assigned to a given `key`.
           including the environment-specific {key}_client OR {key}_server keys; assumes the values are strings.
           Returns \n-concatenation of the strings found. Used internally to retrieve & combine code snippets.
         */
        // let env = this.registry.onServer ? 'server' : 'client'
        // let snippets = this.getMany([key, `${key}_${env}`], params)
        let snippets = this.propsReversed(key)
        return snippets.join('\n')
    }

    dumpData() {
        /* Dump this._data_ to a JSONx string with encoding of nested values. */
        return JSONx.stringify(this._data_)
    }


    /***  Routing & handling of requests (server-side)  ***/

    url(method, args) {
        /* `method` is an optional name of a web @method, `args` will be appended to URL as a query string. */
        let site = this.registry.site
        let app  = this.registry.session.app
        let path
        // let defaultApp = this.registry.site.getApplication()
        // let defaultApp = this.registry.session.apps['$']
        // app = app || defaultApp

        if (app) {
            app.assert_loaded()
            path = app.urlPath(this)
            if (path) path = './' + path            // ./ informs the browser this is a relative path, even if dots and ":" are present similar to a domain name with http port
        }
        if (!path)  path = site.urlRaw(this)        // fallback; urlRaw() is an absolute path, no leading ./
        if (method) path += Request.SEP_METHOD + method                 // append @method and ?args if present...
        if (args)   path += '?' + new URLSearchParams(args).toString()
        return path
    }

    async route(request) {
        /*
        Override this method, or findRoute(), in subclasses of items that serve as intermediate nodes on URL paths.
        The route() method should forward the `request` to the next node on the path
        by calling either its node.route(), if more routing is needed, or node.handle(),
        if the node was identified as a TARGET item that should actually serve the request.
        The routing node can also forward the request to itself by calling this.handle().
        Typically, `request` originates from a web request. The routing can also be started internally,
        and in such case request.session is left undefined.
        */
        assert(this.registry.onServer)                  // route() is exclusively server-side functionality, including internal URL-calls
        let [node, req, target] = this._findRouteChecked(request)
        if (node instanceof Promise) node = await node
        if (!node instanceof Item) throw new Error("internal error, expected an item as a target node of a URL route")
        if (!node.is_loaded()) await node.load()
        if (typeof target === 'function') target = target(node)         // delayed target test after the node is loaded
        return target ? node.handle(req) : node.route(req)
    }
    async routeNode(request, strategy = 'last') {
        /* Like route(), but request.path can point to an intermediate node on a route,
           and instead of calling .handle() this method returns a (loaded) node pointed to by the path:
           the first node where request.path becomes empty (if strategy="first");
           or the last node before catching a Request.NotFound error (if strategy="last");
           or the target node with remaining subpath - if the target was reached along the way.
           A pair is returned: [node, current-request] from the point where the routing was terminated.
         */
        if (!request.path && strategy === 'first') return [this, request]
        try {
            let [node, req, target] = this._findRouteChecked(request)
            if (node instanceof Promise) node = await node
            if (!node.is_loaded()) await node.load()
            if (typeof target === 'function') target = target(node)     // delayed target test after the node is loaded
            if (target) return [node, req]
            return node.routeNode(req, strategy)
        }
        catch (ex) {
            if (ex instanceof Request.PathNotFound && strategy === 'last')
                return [this, request]      // assumption: findRoute() above must NOT modify the `request` before throwing a NotFound!
            throw ex
        }
    }

    _findRouteChecked(request) {
        /* Wrapper around findRoute() that adds validity checks. */
        let next = this.findRoute(request)              // here, a part of request.path gets consumed
        if (!next) request.throwNotFound()
        if (!next[0]) request.throwNotFound()           // missing `node` in the returned tuple
        return next
    }

    findRoute(request) {
        /* Find the next node on a route identified by request.path, the route starting in this node.
           Return [next-node, new-request, is-target], or undefined. The next-node can be a stub (unloaded).
           The is-target can be omitted (false by default), or can be a function, target(node),
           to be called later, after the `node` is fully loaded. If `request` is modified internally,
           the implementation must ensure that any exceptions are raised *before* the modifications take place.
         */
        request.throwNotFound()
        return [this, request, false]           // just a mockup for an IDE to infer return types
    }

    handlePartial(request) {
        /* Handle a request whose "partial path" addresses an inner element of the item. Default: error.
           Subclasses may override this method. Overriding methods can be "async".
         */
        request.throwNotFound()
        // // route into `data` if there's still a path to be consumed
        // // TODO: check for "GET" privilege of request.client to this item
        // await this.load()
        // ;[entry, subpath] = this._data_.route(request.path)
        // if (subpath) throw new Error(`path not found: ${subpath}`)
        //     // if (entry.value instanceof Item) return entry.value.handle(request.move(subpath), session)
        //     // else throw new Error(`path not found: ${subpath}`)
    }

    handle(request) {
        /*
        Serve a web or internal `request` by executing the corresponding service from this.net.
        Query parameters are passed in `req.query`, as:
        - a string if there's one occurrence of PARAM in a query string,
        - an array [val1, val2, ...] if PARAM occurs multiple times.
        */
        request.item = this
        if (request.path) return this.handlePartial(request)

        let {session, methods, protocol} = request
        if (!methods.length) methods = ['default']
        let endpoints = methods.map(p => `${protocol}/${p}`)        // convert endpoint-names to full endpoints

        if (session) {
            session.item = this
            if (request.app) session.app = request.app
        }

        for (let endpoint of endpoints) {
            let service = this._net_.resolve(endpoint)
            if (service) {
                request.settleEndpoint(endpoint)
                return service.server(this, request)
            }
        }

        request.throwNotFound(`no service found for [${endpoints}]`)
    }

    make_editable() {
        /* Mark this item as editable and remove it from the Registry. */
        this.registry.unregister(this)
        this._meta_.mutable = true
        return this
    }

    static setCaching(...methods) {
        /* In the class'es prototype, replace each method from `methods` with cached(method) wrapper.
           The wrapper utilizes the `_methodCache` property of an Item instance to store cached values.
           NOTE: the value is cached and re-used only when the method was called without arguments;
                 otherwise, the original method is executed on each and every call.
           NOTE: methods cached can be async, in such case the value cached and returned is a Promise.
         */
        // print(`${this.constructor.name}.setCaching(): ${methods}`)

        const cached = (name, fun) => {
            function wrapper(...args) {
                while (args.length && args[args.length-1] === undefined)
                    args.pop()                                      // drop trailing `undefined` arguments
                if (args.length) return fun.call(this, ...args)     // here and below, `this` is an Item instance

                let cache = this._meta_.calls_cache                 // here, `this` is an Item instance
                if (cache.has(name)) return cache.get(name)         // print(`${name}() from _methodCache`)

                let value = fun.call(this)
                if (value instanceof Promise)                       // for async methods store the final value when available
                    value.then(v => cache.set(name, v))             // to speed up subsequent access (no waiting for promise)

                // Object.defineProperty(this, name, {enumerable: false, value: function(...args_) {
                //     // TODO: call the original fun if multiple args are passed
                //     return value
                // }})

                cache.set(name, value)                              // may store a promise (!)
                return value                                        // may return a promise (!), the caller should be aware
            }
            Object.defineProperty(wrapper, 'name', {value: `${name}_cached`})
            wrapper.isCached = true                                 // to detect an existing wrapper and avoid repeated wrapping
            return wrapper
        }
        for (const name of methods) {
            let fun = this.prototype[name]                          // here, `this` is the Item class or its subclass
            if (fun && !fun.isCached)
                this.prototype[name] = cached(name, fun)
        }
    }

    // static cached_methods = ['getPrototypes', 'getAncestors', 'getPath', 'getActions', 'getEndpoints', 'getSchema', 'render']
    //
    // static initClass() {
    //     let methods = this.category.prop('cached_methods')
    //     this.setCaching(...methods)
    // }
}

/**********************************************************************************************************************/

Item.setCaching('getPrototypes', 'getAncestors', 'getPath', 'getActions', 'getEndpoints', 'getSchema', 'render')


// When service functions (below) are called, `this` is always bound to the Item instance, so they execute
// in the context of their item like if they were regular methods of the Item (sub)class.
// The first argument, `request`, is a Request instance, followed by action-specific list of arguments.
// In a special case when an action is called directly on the server through item.action.XXX(), `request` is null,
// which can be a valid argument for some actions - supporting this type of calls is NOT mandatory, though.

Item.create_api(
    {
        // http endpoints...

        'GET/default':  new ItemAdminPage(),            // TODO: add explicit support for aliases
        'GET/item':     new ItemAdminPage(),

        'CALL/default': new InternalService(function() { return this }),
        'CALL/item':    new InternalService(function() { return this }),
        'GET/json':     new JsonService(function() { return this._record_.encoded() }),

        // item's edit actions for use in the admin interface...
        'POST/edit':  new TaskService({

            delete_self(request)   { return schemat.db.delete(this) },

            // TODO: in all the methods below, `this` should be copied and reloaded after modifications

            insert_field(request, path, pos, entry) {
                // if (entry.value !== undefined) entry.value = this.getSchema([...path, entry.key]).decode(entry.value)
                if (entry.value !== undefined) entry.value = JSONx.decode(entry.value)
                this.make_editable()
                this._data_.insert(path, pos, entry)
                return schemat.db.update_full(this)
            },

            delete_field(request, path) {
                this.make_editable()
                this._data_.delete(path)
                return schemat.db.update_full(this)
            },

            update_field(request, path, entry) {
                // if (entry.value !== undefined) entry.value = this.getSchema(path).decode(entry.value)
                if (entry.value !== undefined) entry.value = JSONx.decode(entry.value)
                this.make_editable()
                this._data_.update(path, entry)
                return schemat.db.update_full(this)
            },

            move_field(request, path, pos1, pos2) {
                this.make_editable()
                this._data_.move(path, pos1, pos2)
                return schemat.db.update_full(this)
            },

        }),
    },
    {
        // actions...
        // the list of 0+ arguments after the endpoint should match the ...args arguments accepted by execute() of the service
        //get_json:         ['GET/json'],
        delete_self:        ['POST/edit', 'delete_self'],
        insert_field:       ['POST/edit', 'insert_field'],
        delete_field:       ['POST/edit', 'delete_field'],
        update_field:       ['POST/edit', 'update_field'],
        move_field:         ['POST/edit', 'move_field'],
    }
)
// print(`Item.api.endpoints:`, Item.api.endpoints)


/**********************************************************************************************************************/

export class Category extends Item {
    /*
    A category is an item that describes other items: their schema and functionality;
    also acts as a manager that controls access to and creation of new items within category.
    */

    __init__() { return this._initSchema() }

    async _initSchema() {
        // initialize Type objects inside `fields`; in particular, TypeWrapper class requires
        // explicit async initialization to load sublinked items

        // TODO: move initialization somewhere else; here, we don't have a guarantee that the
        //       initialized type object won't get replaced with a new one at some point

        let fields = this._data_.get('fields') || []
        let calls  = fields.map(({value: type}) => type.init()).filter(res => res instanceof Promise)
        if (calls.length) return Promise.all(calls)

        // for (const entry of this._raw_entries('fields')) {
        //     let fields = entry.value
        //     let calls  = fields.map(({value: type}) => type.init()).filter(res => res instanceof Promise)
        //     if (calls.length) await Promise.all(calls)
        // }
    }

    async new(data, id) {
        /* Create a newborn item of this category (not yet in DB) and set its `data`; set its ID if given.
           The order of `data` and `id` arguments can be swapped.
         */
        if (typeof data === 'number') [data, id] = [id, data]
        assert(data)
        if (!(data instanceof Data)) data = new Data(data)
        data.set('_category_', this)
        return Item.from_record(new ItemRecord(id, data))
    }

    async getItemClass() {
        /* Return the dynamically created class to be used for items of this category. */
        // below, module.Class is subclassed to allow safe addition of a static .category attribute,
        // even when several categories share the `base` class, so each one needs a different value of .category
        let module = await this.getModule()
        let base = module.Class
        let name = `${base.name}`
        let cls = {[name]: class extends base {}}[name]
        let _category = T.getOwnProperty(cls, '_category_')
        assert(_category === undefined || _category === this, this, _category)

        // cls.category_old = this

        // print('base:', base)
        // print('cls:', cls)
        return cls
    }

    async getModule() {
        /* Parse the source code of this category (from getSource()) and return as a module's namespace object.
           This method uses this.getPath() as the module's path for linking nested imports in parseModule():
           this is either the item's `path` property, or the default path built from the item's ID on the site's system path.
         */
        let site = this.registry.site
        let onClient = this.registry.onClient
        let [classPath, name] = this.getClassPath()

        if (!site) {
            // when booting up, a couple of core items must be created before registry.site becomes available
            if (!classPath) throw new Error(`missing 'class_path' property for a core category, ID=${this._id_}`)
            if (this._hasCustomCode()) throw new Error(`dynamic code not allowed for a core category, ID=${this._id_}`)
            return {Class: await this.getDefaultClass(classPath, name)}
        }

        let modulePath = this.getPath()

        try {
            return await (onClient ?
                            this.registry.import(modulePath) :
                            site.parseModule(this.getSource(), modulePath)
            )
        }
        catch (ex) {
            print(`ERROR when parsing dynamic code for category ID=${this._id_}, will use a default class instead. Cause:\n`, ex)
            return {Class: await this.getDefaultClass(classPath, name)}
        }
    }

    async getDefaultClass(path, name) {
        /* Return a default class to be used for items of this category when dynamic code is not present or fails to parse.
           This class is always uniquely created by extending a standard/base class if needed.
         */
        let cls
        if (!path) [path, name] = this.getClassPath()
        if (!path) {
            let proto = this.getPrototypes()[0]
            return proto ? proto.getItemClass() : Item
        }
        return this.registry.importDirect(path, name || 'default')
    }

    getClassPath() {
        /* Return import path of this category's items' base class, as a pair [module_path, class_name]. */
        return splitLast(this.prop('class_path') || '', ':')
    }

    getSource() {
        /* Combine all code snippets of this category, including inherited ones, into a module source code.
           Import the base class, create a Class definition from `class_body`, append view methods, export the new Class.
         */
        let name = this.prop('class_name') || `Class_${this._id_}`
        let base = this._codeBaseClass()
        let init = this._codeInit()
        let code = this._codeClass(name)
        let expo = `export {Base, Class, Class as ${name}, Class as default}`

        let snippets = [base, init, code, expo].filter(Boolean)
        return snippets.join('\n')
    }

    _hasCustomCode() { return this._codeInit() || this._codeBody() }

    _codeInit()      { return this.mergeSnippets('class_init') }
    _codeBaseClass() {
        /* Source code that imports/loads the base class, Base, for a custom Class of this category. */
        let [path, name] = this.getClassPath()
        if (name && path) return `import {${name} as Base} from '${path}'`
        else if (path)    return `import Base from '${path}'`
        else              return 'let Base = Item'              // Item class is available globally, no need to import
    }
    _codeClass(name) {
        /* Source code that defines a custom Class of this category, possibly in a reduced form of Class=Base. */
        let body = this._codeBody()
        // if (!body) return 'let Class = Base'
        let def  = body ? `class ${name} extends Base {\n${body}\n}` : `let ${name} = Base`
        if (name !== 'Class') def += `\nlet Class = ${name}`
        // let views = this._codeViewsHandlers()
        // let hdlrs = this._codeHandlers()
        let cache = this._codeCache()
        return [def, cache] .filter(Boolean) .join('\n')
    }
    _codeBody() {
        /* Source code of this category's dynamic Class body. */
        return this.mergeSnippets('class_body')
        // let body = this.mergeSnippets('class_body')
        // let methods = []
        // let views = this.prop('views')                              // extend body with VIEW_* methods
        // for (let {key: vname, value: vbody} of views || [])
        //     methods.push(`VIEW_${vname}(props) {\n${vbody}\n}`)
        // return body + methods.join('\n')
    }
    // _codeViewsHandlers() {
    //     let views = this.prop('views')
    //     if (!views?.length) return
    //     let names = views.map(({key}) => key)
    //     let hdlrs = names.map(name => `${name}: new Item.Handler()`)
    //     let code  = `Class.handlers = {...Class.handlers, ${hdlrs.join(', ')}}`
    //     print('_codeViewsHandlers():', code)
    //     return code
    // }
    // _codeHandlers() {
    //     let entries = this.prop('handlers')
    //     if (!entries?.length) return
    //     let className = (name) => `Handler_${this._id_}_${name}`
    //     let handlers = entries.map(({key: name, value: code}) =>
    //         `  ${name}: new class ${className(name)} extends Item.Handler {\n${indent(code, '    ')}\n  }`
    //     )
    //     return `Class.handlers = {...Class.handlers, \n${handlers.join(',\n')}\n}`
    //     // print('_codeHandlers():', code)
    //     // return code
    // }
    _codeCache() {
        /* Source code of setCaching() statement for selected methods of a custom Class. */
        let methods = this.propsReversed('cached_methods')
        methods = methods.join(' ').replaceAll(',', ' ').trim()
        if (!methods) return ''
        methods = methods.split(/\s+/).map(m => `'${m}'`)
        print('_codeCache().cached:', methods)
        return `Class.setCaching(${methods.join(',')})`
    }

    getItemSchema() {
        /* Get schema of items in this category (not the schema of self, which is returned by getSchema()). */
        return this.prop('item_schema')
    }

    _checkPath(request) {
        /* Check if the request's path is compatible with the default path of this item. Throw an exception if not. */
        let path  = request.pathFull
        let dpath = this.getPath()              // `path` must be equal to the default path of this item
        if (path !== dpath)
            throw new Error(`code of ${this} can only be imported through '${dpath}' path, not '${path}'; create a derived item/category on the desired path, or use an absolute import, or set the "path" property to the desired path`)
    }
}

Category.setCaching('getModule', 'getItemClass', 'getSource', 'getItemSchema', 'getAssets')   //'getHandlers'

Category.create_api(
    {
        'GET/default':  new CategoryAdminPage(),            // TODO: add explicit support for aliases
        'GET/item':     new CategoryAdminPage(),

        'GET/import':   new HttpService(function (request)
        {
            /* Send JS source code of this category with a proper MIME type to allow client-side import(). */
            this._checkPath(request)
            request.res.type('js')
            request.res.send(this.getSource())
        }),

        // 'GET/scan':     new HttpService(async function (request)
        // {
        //     /* Retrieve all children of this category and send to client as a JSON array.
        //      */
        //     let items = []
        //     for await (const item of this.registry.scan(this)) {
        //         await item.load()
        //         items.push(item)
        //     }
        //     let records = items.map(item => item.record.encoded())
        //     request.res.json(records)
        // }),

        'POST/read': new TaskService({
            list_items: new Task({
                async process(request, offset, limit) {
                    /* Retrieve all children of this category server-side and send them to client as a JSON array of flat records. */
                   // TODO: use size limit & offset (pagination).
                   // TODO: let declare if full items (loaded), or meta-only, or naked stubs should be sent.
                    let items = []
                    for await (const item of this.registry.scan_category(this)) {
                        await item.load()
                        items.push(item)
                    }
                    return items.map(item => item._record_.encoded())
                },
                finalize(records) {
                    /* Convert records to items client-side and keep in local cache (ClientDB) to avoid repeated web requests. */
                    let items = []
                    for (const rec of records) {             // rec's shape: {id, data}
                        if (rec.data) {
                            rec.data = JSON.stringify(rec.data)
                            schemat.db.cache(rec)                   // need to cache the item in ClientDB
                            // this.registry.unregister(rec.id)     // evict the item from the Registry to allow re-loading
                        }
                        items.push(this.registry.getItem(rec.id))
                    }
                    return items
                }
            }),
        }),

        'POST/edit':  new TaskService({
            async create_item(request, dataState) {
                /* Create a new item in this category based on request data. */
                let data = await (new Data).__setstate__(dataState)
                let item = await this.new(data)
                await schemat.db.insert(item)
                return item._record_.encoded()
                // TODO: check constraints: schema, fields, max lengths of fields and of full data - to close attack vectors
            },
        }, //{encodeResult: false}    // avoid unnecessary JSONx-decoding by the client before putting the record in client-side DB
        ),
    },
    {
        // actions...
        list_items:     ['POST/read', 'list_items'],
        create_item:    ['POST/edit', 'create_item'],
    }
)


/**********************************************************************************************************************/

export class RootCategory extends Category {

    constructor(_fail_) {
        super(_fail_)
        this._id_ = ROOT_ID
        this._meta_.expiry = 0                  // never evict from Registry
    }

    get _category_() { return this }            // root category is a category for itself

    _init_class() {}                            // RootCategory's class is already set up, no need to do anything more

    getItemSchema() {
        /* In RootCategory, this == this._category_, and to avoid infinite recursion we must perform
           schema inheritance manually (without this.prop()).
         */
        let root_fields = this._data_.get('fields')
        let default_fields = root_fields.get('fields').props.default
        let fields = new Catalog(root_fields, default_fields)
        let custom = this._data_.get('allow_custom_fields')
        return new DATA({fields: fields.object(), strict: custom !== true})
    }
}

RootCategory.setCaching('getItemSchema')


/**********************************************************************************************************************/

globalThis.Item = Item              // Item class is available globally without import, for dynamic code
