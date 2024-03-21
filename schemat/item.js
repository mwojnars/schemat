'use strict'

import {set_global} from "./common/globals.js"
import {print, assert, T, escape_html, splitLast, concat, unique, delay} from './common/utils.js'
import {UrlPathNotFound, NotLinked, NotLoaded} from './common/errors.js'

import {JSONx} from './serialize.js'
import {Catalog, Data} from './data.js'
import {DATA, DATA_GENERIC, ITEM, generic_type} from "./type.js"
import {HttpService, JsonService, API, Task, TaskService, InternalService, Network} from "./services.js"

import {ItemRecord} from "./db/records.js";
import {DataRequest} from "./db/data_request.js";

import {Assets} from "./ui/component.js";
import {ReactPage, CategoryAdminView, ItemAdminView} from "./ui/pages.js";

export const ROOT_ID = 0


// import * as utils from 'http://127.0.0.1:3000/system/local/common/utils.js'
// import * as utils from 'file:///home/..../src/schemat/common/utils.js'
// print("imported utils from localhost:", utils)
// print('import.meta:', import.meta)


// // AsyncFunction class is needed for parsing from-DB source code
// const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor


/**********************************************************************************************************************
 **
 **  REQUEST (custom Schemat's)
 **
 */

export class Request {
    /* Custom representation of a web request or internal request,
       together with context information that evolves during the routing procedure.
     */

    static SEP_ENDPOINT = '::'          // separator of an endpoint name within a URL path

    throwNotFound(msg, args)  { throw new UrlPathNotFound(msg, args || {path: this.path}) }

    req             // instance of node.js express' Request
    res             // instance of node.js express' Response

    protocol        // CALL, GET, POST, (SOCK in the future); there can be different services exposed at the same endpoint-name but different protocols
    path            // URL path with trailing ::endpoint name removed

    args            // dict of arguments for the handler function; taken from req.query (if a web request) or passed directly (internal request)
    methods = []    // names of access methods to be tried for a target item; the 1st method that's present on the item will be used, or 'default' if `methods` is empty

    target          // target object responsible for handling of the request; found by the routing procedure starting at the site object
    endpoint        // endpoint of the target item, as found by the routing procedure


    constructor({path, method, req, res}) {
        this.req = req
        this.res = res

        this.protocol =
            !this.req                   ? "CALL" :          // CALL = internal call through Site.route_internal()
            this.req.method === 'GET'   ? "GET"  :          // GET  = read access through HTTP GET
                                          "POST"            // POST = write access through HTTP POST

        if (path === undefined) path = this.req.path
        let endp, sep = Request.SEP_ENDPOINT;
        [this.path, endp] = path.includes(sep) ? splitLast(path, sep) : [path, '']

        // in Express, the web path always starts with at least on character, '/', even if the URL contains a domain alone;
        // this leading-trailing slash has to be truncated for correct segmentation and detection of an empty path
        if (this.path === '/') this.path = ''
        this._push(method, sep + endp)
    }

    _prepare(endpoint) {
        if (!endpoint) return endpoint
        let sep = Request.SEP_ENDPOINT
        assert(endpoint.startsWith(sep), `endpoint must start with '${sep}' (${endpoint})`)
        return endpoint.slice(sep.length)
    }

    _push(...methods) {
        /* Append names to this.methods. Each name must start with '::' for easier detection of method names
           in a source code - this prefix is truncated when appended to this.methods.
         */
        for (const method of methods) {
            let m = this._prepare(method)
            if (m && !this.methods.includes(m)) this.methods.push(m)
        }
    }

    dump() {
        /* Session data and a list of bootstrap items to be embedded in HTML response, state-encoded. */
        let site  = schemat.site
        let items = [this.target, this.target._category_, schemat.root_category, site, site._category_]
        items = [...new Set(items)].filter(Boolean)             // remove duplicates and nulls
        let records = items.map(it => it._record_.encoded())

        return {site_id: site._id_, target_id: this.target._id_, items: records}
    }
}


/**********************************************************************************************************************
 **
 **  EDIT container object
 **
 */

export class Edit {
    /* Specification of an edit operation that should be performed on an object inside the exclusive lock of its storage Block. */

    op          // name of the operation to be performed on object properties, e.g. 'insert', 'delete', 'move', 'field' (meaning 'update')
    args        // arguments for the operation, e.g. {field: 'name', value: 'new name'}

    constructor(op = null, args = {}) {
        this.op = op
        this.args = args
    }

    apply_to(object) {
        const method = object[`EDIT_${this.op}`]
        if (!method) throw new Error(`object does not support edit operation: '${this.op}'`)
        return method.call(object, this.args)       // may return a Promise
    }
}


/**********************************************************************************************************************
 **
 **  ITEM & CATEGORY
 **
 */

class ItemProxy {
    /* Creates a Proxy wrapper for network objects (Items), be it stubs, unlinked objects, or loaded from DB.
       Combines plain object attributes with loaded properties and makes them all accessible with the `obj.prop` syntax.
       Performs caching of computed properties in plain attributes of the `target` object.
       Ensures immutability of regular properties.
       Since a Proxy class can't be subclassed, all methods and properties of ItemProxy are static.
     */

    // the suffix appended to a property name when an array of *all* repeated values of this property is requested, not the first value only
    static MULTIPLE_SUFFIX = '_array'

    // these special props are always read from regular POJO attributes and NEVER from object's _data_
    static RESERVED = ['_id_', '_meta_', '_data_', '_record_', '_ready_']

    // these special props can still be written to after the value read from _data_ was undefined
    static WRITABLE_IF_UNDEFINED = ['_url_', '_path_']

    // UNDEFINED token marks that the value has already been fully computed, with inheritance and imputation,
    // and still remained undefined, so it should *not* be computed again
    static UNDEFINED = Symbol.for('ItemProxy.UNDEFINED')
    static CACHED    = Symbol.for('ItemProxy.CACHED')       // marks a wrapper around a value that comes from a getter function and should be cached


    static wrap(target) {
        /* Create a Proxy wrapper around `target` object. */
        return new Proxy(target, {get: this.proxy_get})
    }

    static proxy_get(target, prop, receiver) {
        let value = Reflect.get(target, prop, receiver)

        if (typeof value === 'object' && value?.[ItemProxy.CACHED]) {
            // the value comes from a getter and is labelled to be "CACHED"? save it in the target object
            value = value.value
            if (!target._meta_.mutable) {           // caching is only allowed in immutable objects
                let stored = (value === undefined) ? ItemProxy.UNDEFINED : value
                Object.defineProperty(target._self_, prop, {value: stored, writable: false, configurable: true})
            }
            return value
        }

        if (value === ItemProxy.UNDEFINED) return undefined
        if (value !== undefined) return value

        if (!target._data_) return undefined
        if (typeof prop !== 'string') return undefined          // `prop` can be a symbol like [Symbol.toPrimitive] - ignore

        // there are many queries for 'then' because after a promise resolves, its result is checked for .then
        // to see if the result is another promise; defining a `then` property is unsafe, hence we disallow it
        if (prop === 'then') return undefined

        // if (prop.length >= 2 && prop[0] === '_' && prop[prop.length - 1] === '_')    // _***_ props are reserved for internal use
        if (ItemProxy.RESERVED.includes(prop))
            return undefined

        // fetch a single value or an array of values of a property `prop` from the target object's _data_ ...

        // console.log('get', prop)
        let suffix = ItemProxy.MULTIPLE_SUFFIX
        let multiple = prop.endsWith(suffix)
        if (multiple) prop = prop.slice(0, -suffix.length)      // use the base property name without the suffix

        let values = target._compute_property(prop)

        // if (values.length || target.is_loaded)                  // ?? undefined (empty) value is not cached unless the object is fully loaded
        if (!target._meta_.mutable)                             // caching is only allowed in immutable objects
            ItemProxy._cache_property(target, prop, values)

        return multiple ? values : values[0]
    }

    static _cache_property(target, prop, values) {
        /* Cache the result in target._self_; _self_ is used instead of `target` because the latter
           can be a derived object (e.g., a View) that only inherits from _self_ through the JS prototype chain
         */
        let suffix = ItemProxy.MULTIPLE_SUFFIX
        let single = values[0]
        let single_cached = (single !== undefined) ? single : ItemProxy.UNDEFINED

        let self = target._self_
        let writable = (prop[0] === '_' && prop[prop.length - 1] !== '_')       // only private props, _xxx, remain writable after caching

        if (single === undefined && ItemProxy.WRITABLE_IF_UNDEFINED.includes(prop))
            writable = true

        if (writable) {
            self[prop] = single_cached
            self[prop + suffix] = values
        } else {
            Object.defineProperty(self, prop, {value: single_cached, writable, configurable: true})
            Object.defineProperty(self, prop + suffix, {value: values, writable, configurable: true})
        }
    }
}

/**********************************************************************************************************************/

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


    /***  Common properties ***/

    // defined in Category::fields::fields::default (root.js/default_fields), but declared here to avoid IDE warnings...

    name
    info
    _status_

    /***  Special properties:

    (some of the props below have getters defined, so they must be commented out not to mask the getters)

    _id_                    database ID of the object, globally unique; undefined in a newly created item; should never be changed
                            for an existing item, that's why the property is set to read-only after the first assignment

    _record_                ItemRecord that contains this item's ID and data as loaded from DB during last load() or assigned directly;
                            undefined in a newborn item; immutable after the first assignment

    _schema_                schema of this item's data, as a DATA object

    _extends_
    _prototypes_            array of direct ancestors (prototypes) of this object; alias for `_extends__array`
    _ancestors_             array of all ancestors, deduplicated and linearized, with `this` at the first position

    _class_                 JS class (or its class path) for this item; assigned AFTER object creation during .load()
    _category_              category of this item, as a Category object
    _container_             Container of this item, for canonical URL generation
    _status_                a string describing the current state of this object in the DB, e.g., "DRAFT"; undefined means normal state

    _path_
    _url_                   absolute URL path of this object; calculated right *after* __init__(); to be sure that _url_ is computed, await _meta_.pending_url first
    _assets_                cached web Assets of this object's _schema_

    */

    // it is assumed that if this._id_ exists, the object is ALREADY stored in the DB (is "linked");
    // for a newly created object that already has an ID assigned, but is not yet (fully) saved to DB, the ID must be kept
    // in _meta_.provisional_id instead (!) to avoid premature attempts to load the object's properties from DB
    get _id_()   { return undefined }
    set _id_(id) {
        if (id === undefined) return
        Object.defineProperty(this._self_, '_id_', {value: id, writable: false})
    }

    get _record_() {
        this.assert_linked()
        this.assert_loaded()
        return this._record_ = new ItemRecord(this._id_, this._data_)
    }
    set _record_(record) {
        assert(record)
        assert(record.id === this._id_)
        Object.defineProperty(this._self_, '_record_', {value: record, writable: false})
    }

    get _schema_() {
        let value = this._category_?.data_schema || new DATA_GENERIC()
        return this.CACHED_PROP(value)
    }

    get _prototypes_() { return this.CACHED_PROP(this._extends__array) }

    get _ancestors_() {
        // TODO: use C3 algorithm to preserve correct order (MRO, Method Resolution Order) as used in Python:
        // https://en.wikipedia.org/wiki/C3_linearization
        // http://python-history.blogspot.com/2010/06/method-resolution-order.html
        let prototypes = this._prototypes_
        let candidates = prototypes.map(proto => proto._ancestors_)
        let ancestors = [this, ...unique(concat(candidates))]
        return this.CACHED_PROP(ancestors)
    }

    get _assets_()  {
        let assets = new Assets()
        this._schema_.collect(assets)
        return this.CACHED_PROP(assets)
    }


    CACHED_PROP(value) {
        /* Wrap a `value` of a getter of a special property to mark that the value should be cached and reused
           after the first calculation. <undefined> is a valid value and is stored as ItemProxy.UNDEFINED
           to avoid repeated calculation. If you don't want to cache <undefined> (or any other value),
           return the original (unwrapped) value instead of calling CACHED_PROP().
         */
        return {[ItemProxy.CACHED]: true, value}
    }

    static compare(obj1, obj2) {
        /* Ordering function that can be passed to array.sort() to sort objects from DB by ascending ID. */
        return obj1._id_ - obj2._id_
    }


    /***  Internal properties  ***/

    _proxy_         // Proxy wrapper around this object created during instantiation and used for caching of computed properties
    _self_          // a reference to `this`; for proper caching of computed properties when this object is used as a prototype (e.g., for View objects) and this <> _self_ during property access
    _data_          // data fields of this item, as a Data object; created during .load()
    _net_           // per-instance Network adapter that connects this object to its network API as defined in the class's API (this.constructor._api_);
                    // API endpoints of the object can be called programmatically through this._net_.PROTO.xxx(args), where PROTO is GET/POST/CALL/...,
                    // which works both on the client and server (in the latter case, the call executes the service function directly without network communication)

    _meta_ = {                  // _meta_ contain system properties of this object...
        loading:   false,       // promise created at the start of _load() and removed at the end; indicates that the object is currently loading its data from DB
        mutable:   false,       // true if item's data can be modified through .edit(); editable item may contain uncommitted changes and must be EXCLUDED from the registry
        expiry:    0,           // timestamp [ms] when this item should be evicted from cache; 0 = immediate, undefined = NEVER
        pending_url: undefined,     // promise created at the start of _init_url() and removed at the end; indicates that the object is still computing its URL (after or during load())
        provisional_id: undefined,  // ID of a newly created object that's not yet saved to DB, or the DB record is incomplete (e.g., the properties are not written yet)

        // db         // the origin database of this item; undefined in newborn items
        // ring       // the origin ring of this item; updates are first sent to this ring and only moved to an outer one if this one is read-only
    }

    static _api_                // API instance that defines this class's endpoints and protocols; created lazily in _create_api() when the first instance is loaded, then reused for other instances


    /***  Object status  ***/

    is_newborn()    { return this._id_ === undefined }              // object is "newborn" when it hasn't been written to DB yet and has no ID assigned; "newborn" = "unlinked"
    is_linked()     { return this._id_ !== undefined }              // object is "linked" when it has an ID, which means it's persisted in DB or is a stub of an object to be loaded from DB
    is_loaded()     { return this._data_ && !this._meta_.loading }  // false if still loading, even if data has already been created but object's not fully initialized (except _url_ & _path_ which are allowed to be delayed)
    //is_activated()  { return this.is_loaded() && this._url_}        // true if the object is loaded AND its URL is already computed

    assert_linked() { if (!this.is_linked()) throw new NotLinked(this) }
    assert_loaded() { if (!this.is_loaded()) throw new NotLoaded(this) }

    is_equivalent(other) {
        /* True if `this` and `other` object have the same ID; they still can be two different instances
           AND may contain different data (!), for example, if one of them contains more recent updates than the other.
           If `other` is undefined or any of the objects has a missing ID, they are considered NOT equivalent.
         */
        return this._id_ !== undefined && this._id_ === other?._id_
    }

    /***  Instantiation  ***/

    constructor(_fail_ = true) {
        /* For internal use! Always call Item.create() instead of `new Item()`. */
        if(_fail_) throw new Error('item should be instantiated through Item.create() instead of new Item()')
        this._self_ = this      // for proper caching of computed properties when this object is used as a prototype (e.g., for View objects)
    }

    __create__(...args) {
        /* Override in subclasses to initialize properties of a newborn item (not from DB) returned by Item.create(). */
    }

    static create(...args) {
        /* Create an empty newborn item, no ID, and execute its __create__(...args). Return the item.
           This function, or create_stub(id), should be used instead of the constructor.
           If __create__() returns a Promise, this function returns a Promise too.
         */
        let item = this.create_stub()
        let created = item.__create__(...args)
        if (created instanceof Promise) return created.then(() => item)
        return item
    }

    static create_stub(id, {mutable = false} = {}) {
        /* Create a stub: an empty item with `id` assigned. To load data, load() must be called afterwards. */
        let core = new this(false)
        let item = core._proxy_ = ItemProxy.wrap(core)
        if (id !== undefined) core._id_ = id
        if (mutable) core._meta_.mutable = true     // this allows EDIT_xxx operations on the object and prevents caching in Schemat's registry
        return item
    }

    static async from_data(id, data, opts = {}) {
        /* Create a new Item instance; `data` is a Data object, or an encoded JSON string. */
        return Item.from_record(new ItemRecord(id, data), opts)
    }

    static async from_record(record /*ItemRecord*/, opts = {}) {
        /* Create a new item instance: either a newborn one (intended for insertion to DB, no ID yet);
           or an instance loaded from DB and filled out with data from `record` (an ItemRecord).
           In any case, the item returned is *booted* (this._data_ is initialized) and activated (__init__() was called).
         */
        // TODO: if the record is already cached in binary registry, return the cached item...
        // TODO: otherwise, create a new item and cache it in binary registry
        let item = Item.create_stub(record.id, opts)
        return item.load({record})
    }

    static _create_api() {
        /* Collect endpoints defined as static properties of the class and named "PROTO/endpoint" (PROTO in uppercase)
           and return as an API instance. The result is cached in this._api_ for reuse by all objects of this class.
         */
        let is_endpoint = prop => prop.includes('/') && prop.split('/')[0] === prop.split('/')[0].toUpperCase()
        let names = T.getAllPropertyNames(this).filter(is_endpoint)
        let endpoints = Object.fromEntries(names.map(name => [name, this[name]]))
        return this._api_ = new API(endpoints)
    }

    _set_id(id) {
        /* Like obj._id_ = id, but allows re-setting with the same ID value. */
        let prev = this._id_
        if (prev !== undefined) assert(prev === id, `ID is read-only and can't be changed from ${prev} to ${id}`)
        else this._id_ = id
        return id
    }

    _get_write_id() {
        /* Either _id_ or _meta_.provisional_id. */
        return this._id_ !== undefined ? this._id_ : this._meta_.provisional_id
    }


    /***  Loading & initialization ***/

    async load({record = null /*ItemRecord*/, await_url = true} = {}) {
        /* Load full data of this item from `record` or from DB, if not loaded yet. Return this object.
           The data can only be loaded ONCE for a given Item instance due to item's immutability.
           If you want to refresh the data, create a new instance or use refresh() instead.
           `await_url` has effect only after the schemat.site is loaded, not during boot up.
         */
        if (this._data_ || this._meta_.loading) {           // data is loaded or being loaded right now? do nothing except for awaiting the URL (previous load() may have been called with await_url=false)
            assert(!record)
            if (await_url && schemat.site && this._meta_.pending_url)
                await this._meta_.pending_url
            return this._meta_.loading || this              // if a previous load() is still running (`loading` promise), wait for it to complete instead of starting a new one
        }
        if (this.is_newborn() && !record) return this                       // newborn item with no ID and no data to load? fail silently; this allows using the same code for both newborn and in-DB items
        return this._meta_.loading = this._load(record, await_url)          // keep a Promise that will eventually load the data; this is needed to avoid race conditions
    }

    async _load(record /*ItemRecord*/, await_url) {
        /* Load this._data_ from `record` or DB. Set up the class and prototypes. Call __init__(). */

        schemat.before_data_loading(this)

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
                await category.load({await_url: false})     // if category's URL were awaited, a circular dependency would occur between Container categories and their objects that comprise the filesystem where these categories are placed

            this._set_expiry(category?.cache_ttl)

            if (this._status_) print(`WARNING: object [${this._id_}] has status ${this._status_}`)

            // after the props are loaded, attach a JS class to this object (to provide custom behavior) and call the initializer
            await this._init_class()                        // set the target JS class on this object; stubs only have Item as their class, which must be changed when the item is loaded and linked to its category
            this._init_network()

            if (this.is_linked())
                this._meta_.pending_url = this._init_url()  // set the URL path of this item; intentionally un-awaited to avoid blocking the load process of dependent objects

            let init = this.__init__()                      // custom initialization after the data is loaded (optional);
            if (init instanceof Promise) await init         // if this._url_ is needed inside __init__(), _meta_.pending_url must be explicitly awaited there

            // if (!schemat.site?.is_activated())
            //     print(`site NOT yet fully activated when calculating url for [${this._id_}]`)

            if (await_url && schemat.site && this._meta_.pending_url)
                await this._meta_.pending_url

            return this

        } catch (ex) {
            this._data_ = undefined                         // on error, clear the data to mark this object as not loaded
            throw ex

        } finally {
            this._meta_.loading = false                     // cleanup to allow another load attempt, even after an error
            schemat.after_data_loading(this)
        }
    }

    async _load_record() {
        this.assert_linked()
        // schemat.session?.countLoaded(this._id_)

        let req = new DataRequest(this, 'load', {id: this._id_})
        let json = await schemat.db.select(req)
        assert(typeof json === 'string', json)
        return new ItemRecord(this._id_, json)
    }

    _set_expiry(ttl = 'never') {
        /* Time To Live (ttl) is expressed in seconds. */
        this._meta_.expiry = (ttl === 'never') ? undefined : Date.now() + ttl * 1000

        // let expiry
        // if (ttl === undefined) return                       // leave the expiry date unchanged
        // if (ttl === 'never' || ttl < 0) expiry = 0          // never evict
        // else if (ttl === 0) expiry = undefined              // immediate eviction at the end of web request
        // else expiry = Date.now() + ttl * 1000
        // this._meta_.expiry = expiry
    }

    _init_prototypes() {
        /* Load all Schemat prototypes of this object. */
        let prototypes = this._prototypes_
        // for (const p of prototypes)        // TODO: update the code below to verify ._category_ instead of CIDs
            // if (p.cid !== this.cid) throw new Error(`item ${this} belongs to a different category than its prototype (${p})`)
        prototypes = prototypes.filter(p => !p.is_loaded())
        if (prototypes.length === 1) return prototypes[0].load()            // performance: trying to avoid unnecessary awaits or Promise.all()
        if (prototypes.length   > 1) return Promise.all(prototypes.map(p => p.load()))
    }

    async _init_url() {
        /* Initialize this item's URL path (this._url_) and container path (this._path_).
           This method must NOT be overridden in subclasses, because it gets called BEFORE the proper class is set on the object (!)
         */
        try {
            if (this._url_ && this._path_) return this._url_        // already initialized (e.g., for Site object)

            let site = schemat.site

            while (!site) {                                         // wait until the site is created (important for bootstrap objects)
                // print('no schemat.site, waiting for it to be initialized... in', this.constructor?.name || this, `[${this._id_}]`)
                await delay()
                if (this._url_) return this._url_                   // already initialized?
                if (schemat.is_closing) return undefined            // site is closing? no need to wait any longer
                site = schemat.site
            }

            let container = this._container_
            let default_path = () => site.default_path_of(this)
            // assert(container, `missing _container_ in [${this._id_}]`)

            if (!container) {
                let url = default_path()
                print('missing _container_:', url, `(${this.name})`)
                return this._url_ = this._path_ = url
            }
            // print(`_init_url() container: '${container._id_}'`)

            if (!container.is_loaded()) await container.load()              // container must be fully loaded
            if (!container._path_) await container._meta_.pending_url       // container's path must be initialized

            this._path_ = container.get_access_path(this)
            let [url, duplicate] = site.path_to_url(this._path_)
            // print('_init_url():', url, ` (duplicate=${duplicate})`)

            return this._url_ = duplicate ? default_path() : url
        }
        finally {
            this._meta_.pending_url = undefined
        }
    }

    async _init_class() {
        /* Initialize this item's class, i.e., substitute the object's temporary Item class with an ultimate subclass,
           known after loading the item's data.
         */
        if (this._id_ === ROOT_ID) return T.setClass(this, RootCategory)
        let cls = (!this._category_?.class_path && this._class_) || await this._category_?._item_class_     // TODO: `class_path` should be replaced with defaults._class_, so the check here could be removed
        if (typeof cls === 'string') cls = await schemat.get_class(cls)
        T.setClass(this, cls || Item)
    }

    _init_network() {
        /* Create a network interface, _net_, and action _triggers_ for this item's network API. */
        let role = schemat.server_side ? 'server' : 'client'
        let api = this.constructor._api_ || this.constructor._create_api()
        this._net_ = new Network(this, role, api)
    }


    /***  Access to properties  ***/

    _compute_property(prop) {
        /* Compute a property, `prop`, and return an array of its values. The array consists of own data + inherited
           (in this order), or just schema default / imputed (if own/inherited are missing).
           If the schema doesn't allow multiple entries for `prop`, only the first one is included in the result
           (for atomic types), or the objects (own, inherited & default) get merged altogether (for "mergeable" types like CATALOG).
         */
        assert(typeof prop === 'string')

        let proxy = this._proxy_
        let data  = this._data_
        if (!data) throw new NotLoaded(this)

        // check the Type of the property in this object's _schema_; special handling for:
        // 1) _extends_: because it is used at an early stage of the loading process (_init_prototypes() > this._prototypes_), before the object's category (and schema) is fully loaded;
        // 2) _category_: because the schema is not yet available and reading the type from _schema_ would create circular dependency.

        let type =
            prop === '_category_' ? new ITEM() :
            prop === '_extends_'  ? new ITEM({inherit: false}) :
                                    proxy._schema_.get(prop)

        if (!type) return []

        // if the property is atomic (non-repeated and non-compound) and an own value is present, skip inheritance to speed up
        if (!type.isRepeated() && !type.isCompound() && data.has(prop))
            return [data.get(prop)]

        let ancestors = type.props.inherit ? proxy._ancestors_ : [proxy]    // `this` is always included as the first ancestor
        let streams = ancestors.map(proto => proto._own_values(prop))

        // read `defaults` from the category and combine them with the `streams`
        if (prop !== '_extends_' && prop !== '_category_')                  // avoid circular dependency for these special props
        {
            let category = proxy._category_
            if (this === category?._self_ && prop === 'defaults')           // avoid circular dependency for RootCategory
                category = undefined

            let defaults = category?.defaults?.get_all(prop)
            if (defaults?.length) streams.push(defaults)
        }
        // else if (prop === '_category_')
        //     streams.push([schemat.Uncategorized])

        return type.combine_inherited(streams, proxy)                       // `default` and `impute` of the `type` are applied here
    }

    _own_values(prop)  { return this._data_.get_all(prop) }

    // async reload() {
    //     /* Get the most current instance of this item from the registry - can differ from `this` (!) - and make sure it's loaded. */
    //     return schemat.get_item(this._id_).load()
    // }

    async seal_data() {
        /* In a newborn (unlinked) object, create _data_ - if not present yet - by copying property values
           from regular POJO attributes of the object.
         */
        if (this._data_) return this._data_
        if (this.is_linked()) throw new Error('cannot seal properties of a linked object')
        return this._data_ = await Data.from_object(this)
    }

    dump_data() {
        /* Encode and stringify this._data_ through JSONx. Nested values are recursively encoded. */
        return this._data_.dump()
    }

    url(endpoint, args) {
        /* `endpoint` is an optional name of an ::endpoint, `args` will be appended to URL as a query string. */

        let path = this._url_
        if (!path) {
            console.error(`missing _url_ for object [${this._id_}], introduce a delay or await _meta_.pending_url`)
            return ''
        }
        if (endpoint) path += Request.SEP_ENDPOINT + endpoint               // append ::endpoint and ?args if present...
        if (args) path += '?' + new URLSearchParams(args).toString()
        return path
    }

    make_stamp({html = true, brackets = true, max_len = null, ellipsis = '...'} = {}) {
        /* [CATEGORY:ID] string (stamp) if the category of `this` has a name; or [ID] otherwise.
           If html=true, the category name is hyperlinked to the category's profile page (unless URL failed to generate)
           and is HTML-escaped. If max_len is provided, category's suffix may be replaced with '...' to make its length <= max_len.
         */
        let cat = this._category_?.name || ""
        if (max_len && cat.length > max_len) cat = cat.slice(max_len-3) + ellipsis
        if (html) {
            cat = escape_html(cat)
            let url = this._category_?.url()
            if (url) cat = `<a href="${url}">${cat}</a>`          // TODO: security; {url} should be URL-encoded or injected in a different way
        }
        let stamp = cat ? `${cat}:${this._id_}` : `${this._id_}`
        return brackets ? `[${stamp}]` : stamp
    }

    instanceof(category) {
        /* Check whether this item belongs to a `category`, or its subcategory.
           All comparisons along the way use item IDs, not object identity. The item must be loaded.
        */
        return this._category_.inherits_from(category)
    }

    inherits_from(parent) {
        /* Return true if `this` inherits from a `parent` item through the item prototype chain (NOT javascript prototypes).
           True if parent==this. All comparisons by item ID.
         */
        if (this.is_equivalent(parent)) return true
        for (const proto of this._prototypes_)
            if (proto.inherits_from(parent)) return true
        return false
    }

    async insert_self() {
        /* Insert this (newborn) object and, recursively, all the newborn objects referenced by this one, to the database. */

        assert(this.is_newborn(), 'trying to insert an object that is already stored in the database')

        // find recursively all the objects referenced (directly or indirectly) by this one that are still
        // not persisted in the database; the graph of such objects may contain circular references -
        // including a reference of this object to itself (!)
        let refs = await this._find_unlinked_references()

        // if no references need to be inserted together with this object, use the regular 1-phase insertion
        if (refs.length === 0) return schemat.db.insert(this)

        // otherwise, perform a 2-phase insertion of 1+ of cross/self-referencing objects
        let objects = new Set([this, ...refs])
        return schemat.db.insert_many(...objects)
    }

    async _find_unlinked_references(visited = new Set()) {
        /* Find recursively all newborn (non-persisted) objects that are referenced - directly or indirectly -
           by this one. If `this` is unsealed yet (properties are stored in POJO attributes not in _data_),
           create _data_ from the object's regular attributes.
         */
        let data = await this.seal_data()
        let refs = data.find_references()
        let unlinked_refs = refs.filter(obj => obj.is_newborn() && !visited.has(obj))

        unlinked_refs.forEach(ref => visited.add(ref))

        for (let ref of unlinked_refs)
            await ref._find_unlinked_references(visited)

        return visited
    }

    get_container_path(max_len = 10) {
        /* Return an array of containers that lead from the site's root to this object.
           The array contains pairs [segment, container] where `segment` is a string that identifies `container`
           inside its parent; the last pair is [segment, this] (the object itself).
           If containers are correctly configured, the first pair is [undefined, site_object] (the root).
         */
        let path = []
        let object = this

        while (object) {
            let parent = object._container_
            let segment = parent?.identify(object)

            path.push([segment, object])

            if (path.length > max_len) break            // avoid infinite loops
            object = parent
        }
        return path.reverse()
    }


    __init__() {}
        /* Optional item-specific initialization after this._data_ is loaded.
           Subclasses may override this method as either sync or async.
         */
    __done__() {}
        /* Custom clean up to be executed after the item was evicted from the registry cache. Can be async. */


    __handle__(request) {
        /* Serve a web or internal Request by executing the corresponding service from this.net.
           Query parameters are passed in `req.query`, as:
           - a string if there's one occurrence of PARAM in a query string,
           - an array [val1, val2, ...] if PARAM occurs multiple times.
        */
        request.target = this

        // convert endpoint names to full protocol-qualified endpoints: GET/xxx
        let names = this._get_endpoints(request)
        let endpoints = names.map(e => `${request.protocol}/${e}`)

        // find the first endpoint that has a corresponding service defined and launch its server() handler
        for (let endpoint of endpoints) {
            let service = this._net_.get_service(endpoint)
            if (service) {
                // print(`handle() endpoint: ${endpoint}`)
                request.endpoint = endpoint
                return service.server(this, request)
            }
        }

        request.throwNotFound(`endpoint(s) not found in the target object: [${endpoints}]`)
    }

    _get_endpoints(request) {
        /* Return a list of endpoint names (no protocol included) to be tried for this request. */

        // use request's endpoint if specified in the URL (::endpoint)
        let {methods: endpoints, protocol} = request
        if (endpoints.length) return endpoints

        // otherwise, use category defaults
        endpoints = this._category_?.default_endpoints.get_all(protocol) || []
        if (endpoints.length) return endpoints

        // otherwise, use global defaults
        let defaults = {GET: ['home', 'admin'], CALL: ['self']}
        endpoints = defaults[protocol] || []
        if (endpoints.length) return endpoints

        request.throwNotFound(`endpoint not specified (protocol ${protocol})`)
    }


    /***  Endpoints  ***/

    // When endpoint functions (below) are called, `this` is always bound to the Item instance, so they execute
    // in the context of their item like if they were regular methods of the Item (sub)class.
    // The first argument, `request`, is a Request instance, followed by action-specific list of arguments.
    // In a special case when an action is called directly on the server through _triggers_.XXX(), `request` is null,
    // which can be a valid argument for some actions - supporting this type of calls is NOT mandatory, though.

    static ['CALL/self'] = new InternalService(function() { return this })
    static ['GET/admin'] = new ReactPage(ItemAdminView)
    static ['GET/json']  = new JsonService(function() { return this._record_.encoded() })


    /***  Actions & edit operations. Can be called on a client or a server. All return a Promise.  ***/

    edit(op, args) {
        // print('edit:', this._id_, op)
        return schemat.site._net_.POST.submit_edits([this._id_, op, args])    //this, new Edit(op, args))
    }

    edit_insert(path, pos, entry)       { return this.edit('insert', {path, pos, entry}) }
    edit_delete(path)                   { return this.edit('delete', {path}) }
    edit_update(path, entry)            { return this.edit('update', {path, entry}) }
    edit_move(path, pos, pos_new)       { return this.edit('move', {path, pos, pos_new}) }

    delete_self() {
        /* Delete this object from the database. */
        return schemat.site._net_.POST.delete_object(this._id_)
    }


    /***  Implementations of edit operations. NOT for direct use!
          These methods are only called on the server where the object is stored, inside the block's object-level lock.
          New edit ops can be added in subclasses. An EDIT_{op} method can be async or return a Promise.
          The names of methods (the {op} suffix) must match the names of operations passed by callers to .edit().
          Typically, when adding a new OP, a corresponding shortcut method, edit_OP(), is added to the subclass.
     ***/

    EDIT_overwrite({data}) {
        /* Replace the entire set of own properties, _data_, with a new Data object. */
        if (typeof data === 'string') data = Data.load(data)
        assert(data instanceof Data)
        this._data_ = data
    }

    EDIT_insert({path, pos, entry}) {
        /* Insert a new property; or a new field inside a nested Catalog in an existing property. */
        this._data_.insert(path, pos, entry)
    }

    EDIT_delete({path}) {
        /* Delete a property; or a field inside a nested Catalog in a property. */
        this._data_.delete(path)
    }

    EDIT_update({path, entry}) {
        /* Update a property; or a field inside a nested Catalog. */
        this._data_.update(path, entry)
    }

    EDIT_move({path, pos, pos_new}) {
        /* Move a property or a field inside a nested Catalog. */
        this._data_.move(path, pos, pos_new)
    }



    /***  Dynamic loading of source code  ***/

    // async getClass()    {
    //     if (this.category && !this.category.getItemClass) {
    //         print('this.category:', this.category)
    //         print('getItemClass:', this.category.getItemClass)
    //     }
    //     return this.category?._item_class_
    // }

    // getClass() {
    //     /* Create/parse/load a JS class for this item. If `custom_class` property is true, the item may receive
    //        a custom subclass (different from the category's default) built from this item's own & inherited `code*` snippets.
    //      */
    //     return this.category._item_class_
    //     // let base = this.category._item_class_
    //     // let custom = this.category.get('custom_class')
    //     // return custom ? this.parseClass(base) : base
    // }

    // parseClass(base = Item) {
    //     /* Concatenate all the relevant `code_*` and `code` snippets of this item into a class body string,
    //        and dynamically parse them into a new class object - a subclass of `base` or the base class identified
    //        by the `class` property. Return the base if no code snippets found. Inherited snippets are included in parsing.
    //      */
    //     let name = this.get('_boot_class')
    //     if (name) base = schemat.get_class(name)
    //
    //     let body = this.route_internal(('class')           // full class body from concatenated `code` and `code_*` snippets
    //     if (!body) return base
    //
    //     let url = this.sourceURL('class')
    //     let import_ = (path) => {
    //         if (path[0] === '.') throw Error(`relative import not allowed in dynamic code of a category (${url}), path='${path}'`)
    //         return schemat.site.import(path)
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
}


/**********************************************************************************************************************/

export class Category extends Item {
    /* A category is an item that describes other items: their schema and functionality;
       also acts as a manager that controls access to and creation of new items within category.
     */

    /***  Special properties:

    data_schema             DATA_SCHEMA of items in this category (not the schema of self)

    _source_                module source code of this category: all code snippets combined, including inherited ones

    */

    __init__() { return this._initSchema() }

    async _initSchema() {
        // initialize Type objects inside `fields`; in particular, TypeWrapper class requires
        // explicit async initialization to load sublinked items

        // TODO: move initialization somewhere else; here, we don't have a guarantee that the
        //       initialized type object won't get replaced with a new one at some point

        let fields = this._data_.get('schema') || []
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
        return Item.from_data(id, data)
    }

    get_defaults(prop) {
        /* Return an array of default value(s) for a given `prop` as defined in this category's `defaults`
           OR in the type's own `default` property. NO imputation even if defined in the prop's type,
           because the imputation depends on the target object which is missing here.
         */
        let type = this.data_schema.get(prop) || generic_type
        let defaults = this.defaults?.get_all(prop) || []
        return type.combine_inherited([defaults])
    }

    get_default(prop) {
        /* Return the first default value for a given `prop`, or undefined. */
        return this.get_defaults(prop)[0]
    }

    // get schema_assets() {
    //     let assets = new Assets()
    //     this.data_schema.collect(assets)
    //     return this.CACHED_PROP(assets)
    // }

    get _item_class_() {
        /* Return a (cached) Promise that resolves to the dynamically created class to be used for items of this category. */
        return this.CACHED_PROP(this.getModule().then(module => {
            // below, module.Class is subclassed to allow safe addition of a static _category_ attribute:
            // when several categories share the `base` class, each one needs a different value of _category_
            let base = module.Class
            let name = `${base.name}`
            let cls = {[name]: class extends base {}}[name]
            let _category = T.getOwnProperty(cls, '_category_')     // ??? not needed?
            assert(_category === undefined || _category === this, this, _category)
            // cls.category_old = this

            // print('base:', base)
            // print('cls:', cls)
            return cls
        }))
    }

    async getModule() {
        /* Parse the source code of this category (from _source_) and return as a module's namespace object.
           This method uses this._url_ as the module's path for linking nested imports in parseModule().
         */
        let site = schemat.site
        let client_side = schemat.client_side
        let [classPath, name] = this.getClassPath()

        if (!site) {
            // when booting up, a couple of core items must be created before schemat.site becomes available
            if (!classPath) throw new Error(`missing 'class_path' property for a core category, ID=${this._id_}`)
            if (this._hasCustomCode()) throw new Error(`dynamic code not allowed for a core category, ID=${this._id_}`)
            return {Class: await this.getDefaultClass(classPath, name)}
        }

        let path = this._url_ || await this._meta_.pending_url          // wait until the item's URL is initialized
        assert(path, `missing _url_ for category ID=${this._id_}`)

        try {
            return await (client_side ?
                            schemat.import(path) :
                            site.parseModule(this._source_, path)
            )
        }
        catch (ex) {
            print(`ERROR when parsing dynamic code from "${path}" path for category ID=${this._id_}, will use a default class instead. Cause:\n`, ex)
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
            let proto = this._prototypes_[0]
            return proto ? proto._item_class_ : Item
        }
        return schemat.importDirect(path, name || 'default')
    }

    getClassPath() {
        /* Return import path of this category's items' base class, as a pair [module_path, class_name]. */
        return splitLast(this.class_path || '', ':')
    }

    get _source_() {
        /* Combine all code snippets of this category, including inherited ones, into a module source code.
           Import the base class, create a Class definition from `class_body`, append view methods, export the new Class.
         */
        let name = this.class_name || `Class_${this._id_}`
        let base = this._codeBaseClass()
        let init = this._codeInit()
        let code = this._codeClass(name)
        let expo = `export {Base, Class, Class as ${name}, Class as default}`

        let snippets = [base, init, code, expo].filter(Boolean)
        let source = snippets.join('\n')

        return this.CACHED_PROP(source)
    }

    _hasCustomCode() { return this._codeInit() || this._codeBody() }

    _codeInit()      { return this._merge_snippets('class_init') }
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
        return def
        // let views = this._codeViewsHandlers()
        // let hdlrs = this._codeHandlers()
    }
    _codeBody() {
        /* Source code of this category's dynamic Class body. */
        return this._merge_snippets('class_body')
        // let body = this.route_internal(('class_body')
        // let methods = []
        // let views = this.prop('views')                              // extend body with VIEW_* methods
        // for (let {key: vname, value: vbody} of views || [])
        //     methods.push(`VIEW_${vname}(props) {\n${vbody}\n}`)
        // return body + methods.join('\n')
    }

    _merge_snippets(key, params) {
        /* Retrieve all source code snippets (inherited first & own last) assigned to a given `key`.
           including the environment-specific {key}_client OR {key}_server keys; assumes the values are strings.
           Returns \n-concatenation of the strings found. Used internally to retrieve & combine code snippets.
         */
        // let side = schemat.server_side ? 'server' : 'client'
        // let snippets = this.getMany([key, `${key}_${side}`], params)
        let snippets = this[`${key}_array`].reverse()
        return snippets.join('\n')
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

    _checkPath(request) {
        /* Check if the request's path is compatible with the default path of this item. Throw an exception if not. */
        let path  = request.path
        let dpath = this._url_                      // `path` must be equal to the canonical URL path of this item
        if (path !== dpath)
            throw new Error(`code of ${this} can only be imported through '${dpath}' path, not '${path}'; create a derived item/category on the desired path, or use an absolute import, or set the "path" property to the desired path`)
    }


    /***  Endpoints  ***/

    static ['GET/admin'] = new ReactPage(CategoryAdminView)
    static ['GET/import'] = new HttpService(function (request) {
        /* Send JS source code of this category with a proper MIME type to allow client-side import(). */
        this._checkPath(request)
        request.res.type('js')
        return this._source_
    })

    static ['POST/read'] = new TaskService({
        list_items: new Task({
            /* Retrieve all children of `this` category server-side and send them to client as a JSON array
               of flat, fully loaded records.
             */
            async process(request, offset, limit) {
               // TODO: use size limit & offset (pagination).
               // TODO: let declare if full items (loaded), or meta-only, or naked stubs should be sent.
                let items = []
                for await (const item of schemat.scan_category(this)) {
                    await item.load()
                    items.push(item)
                }
                return items
            },
            encode_result(items) {
                return items.map(item => item._record_.encoded())
            },
            async decode_result(records) {
                /* Convert records to items client-side and keep in local cache (ClientDB) to avoid repeated web requests. */
                let items = []
                for (const rec of records) {                    // rec's shape: {id, data}
                    if (rec.data) {
                        rec.data = JSON.stringify(rec.data)
                        schemat.db.cache(rec)                   // need to cache the item in ClientDB
                        // schemat.unregister(rec.id)          // evict the item from the cache to allow re-loading
                    }
                    items.push(await schemat.get_loaded(rec.id))
                }
                return items
            }
        }),
    })

    static ['POST/create_item'] = new JsonService(
        async function(request, dataState) {
            /* Create a new item in this category based on request data. */
            let data = await (new Data).__setstate__(dataState)
            let item = await this.new(data)
            await schemat.db.insert(item)
            return item._record_.encoded()
            // TODO: check constraints: schema, fields, max lengths of fields and of full data - to close attack vectors
        },
    // }, //{encodeResult: false}    // avoid unnecessary JSONx-decoding by the client before putting the record in client-side DB
    )


    /***  Actions  ***/

    list_items()            { return this._net_.POST.read('list_items') }
    create_item(data)       { return this._net_.POST.create_item(data) }
}


/**********************************************************************************************************************/

export class RootCategory extends Category {

    _id_ = ROOT_ID

    _set_expiry() { this._meta_.expiry = undefined }          // never evict from cache

    get _category_() { return this._proxy_ }        // root category is a category for itself

    get data_schema() {
        /* In RootCategory, this == this._category_, and to avoid infinite recursion we must perform schema inheritance manually. */
        let root_fields = this._data_.get('schema')
        let default_fields = this._data_.get('defaults').get('schema')
        let fields = new Catalog(root_fields, default_fields)
        let custom = this._data_.get('allow_custom_fields')
        return new DATA({fields: fields.object(), strict: custom !== true})
    }
}


/**********************************************************************************************************************/

set_global({Item})                  // Item class is available globally without import, for dynamic code
