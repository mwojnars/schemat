'use strict'

import {set_global} from "./common/globals.js"
import {print, assert, T, escape_html, splitLast, concat, unique, delay} from './common/utils.js'
import {UrlPathNotFound, NotLinked, NotLoaded} from './common/errors.js'

import {JSONx} from './serialize.js'
import {Path, Catalog, Data} from './data.js'
import {DATA, DATA_GENERIC, ITEM} from "./type.js"
import {HttpService, JsonService, API, Task, TaskService, InternalService, Network} from "./services.js"
import {ReactPage, CategoryAdminView, ItemAdminView} from "./web/pages.js";
import {ItemRecord} from "./db/records.js";
import {DataRequest} from "./db/data_request.js";

export const ROOT_ID = 0
export const SITE_CATEGORY_ID = 1


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
        let site  = registry.site
        let items = [this.target, this.target._category_, registry.root, site, site._category_]
        items = [...new Set(items)].filter(Boolean)             // remove duplicates and nulls
        let records = items.map(it => it._record_.encoded())

        return {site_id: site._id_, target_id: this.target._id_, items: records}
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

    // the suffix appended to a property name when an array of *all* values of this property is requested, not a single value
    static MULTIPLE_SUFFIX = '_array'

    // these props can never be found inside item's schema and should always be accessed as regular object attributes
    static RESERVED = ['_id_', '_meta_', '_data_', '_record_', '_url_', '_path_', '_ready_']

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
            // the value comes from a getter and should be cached
            value = value.value
            let stored = (value === undefined) ? ItemProxy.UNDEFINED : value
            Object.defineProperty(target._self_, prop, {value: stored, writable: false, configurable: true})
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
        let single = values[0]
        let single_cached = (single !== undefined) ? single : ItemProxy.UNDEFINED

        // cache the result in target._self_; _self_ is used instead of `target` because the latter
        // can be a derived object (e.g., a View) that only inherits from _self_ through the JS prototype chain
        let self = target._self_
        let writable = (prop[0] === '_' && prop[prop.length - 1] !== '_')       // only private props, _xxx, remain writable after caching

        if (writable) {
            self[prop] = single_cached
            self[prop + suffix] = values
        } else {
            Object.defineProperty(self, prop, {value: single_cached, writable, configurable: true})
            Object.defineProperty(self, prop + suffix, {value: values, writable, configurable: true})
        }

        return multiple ? values : single
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

    _class_                 JS class of this item; assigned AFTER object creation during .load()
    _category_              category of this item, as a Category object
    _container_

    _path_
    _url_                   absolute URL path of this object; calculated right *after* __init__(); to be sure that _url_ is computed, await _ready_.url first
    _assets_                cached web Assets of this object's _schema_

    */

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
        let value = this._category_?.item_schema || new DATA_GENERIC()
        return this.CACHED_PROP(value)
    }

    get _prototypes_() { return this.CACHED_PROP(this._extends__array) }

    get _ancestors_() {
        // TODO: use C3 algorithm to preserve correct order (MRO, Method Resolution Order) as used in Python:
        // https://en.wikipedia.org/wiki/C3_linearization
        // http://python-history.blogspot.com/2010/06/method-resolution-order.html
        let candidates = this._prototypes_.map(proto => proto._ancestors_)
        let ancestors = [this, ...unique(concat(candidates))]
        return this.CACHED_PROP(ancestors)
    }

    get _assets_()  { return this.CACHED_PROP(this._schema_.getAssets()) }


    CACHED_PROP(value) {
        /* Wrap a `value` of a getter of a special property to mark that the value should be cached and reused
           after the first calculation. <undefined> is a valid value and is stored as ItemProxy.UNDEFINED
           to avoid repeated calculation. If you don't want to cache <undefined> (or any other value),
           return the original (unwrapped) value instead of calling CACHED_PROP().
         */
        return {[ItemProxy.CACHED]: true, value}
    }


    /***  Internal properties  ***/

    _proxy_         // Proxy wrapper around this object created during instantiation and used for caching of computed properties
    _self_          // a reference to `this`; for proper caching of computed properties when this object is used as a prototype (e.g., for View objects) and this <> _self_ during property access
    _data_          // data fields of this item, as a Data object; created during .load()
    _net_           // Network adapter that connects this item to its network API as defined in this.constructor.api
    action          // triggers for RPC actions of this item; every action can be called from a server or a client via action.X() call

    _meta_ = {                  // _meta_ contain system properties of this object...
        loading:   false,       // promise created at the start of _load() and removed at the end; indicates that the object is currently loading its data from DB
        mutable:   false,       // true if item's data can be modified through .edit(); editable item may contain uncommitted changes and must be EXCLUDED from Registry
        expiry:    undefined,   // timestamp [ms] when this item should be evicted from Registry.cache; 0 = NEVER, undefined = immediate

        // db         // the origin database of this item; undefined in newborn items
        // ring       // the origin ring of this item; updates are first sent to this ring and only moved to an outer one if this one is read-only
    }

    _ready_ = {                 // _ready_ contains status flags and promises that resolve when the corresponding data is calculated/loaded; subclasses may add their own...
        url: undefined,         // resolves with this._url_ when this._url_ is computed
    }

    static api        = null    // API instance that defines this item's endpoints and protocols
    static actions    = {}      // specification of action functions (RPC calls), as {action_name: [endpoint, ...fixed_args]}; each action is accessible from a server or a client


    /***  Object status  ***/

    is_linked()     { return this._id_ !== undefined }                  // object is "linked" when it has an ID, which means it's persisted in DB or is a stub of an object to be loaded from DB
    is_loaded()     { return this._data_ && !this._meta_.loading }      // false if still loading, even if data has already been created but object's not fully initialized

    assert_linked() { if (!this.is_linked()) throw new NotLinked(this) }
    assert_loaded() { if (!this.is_loaded()) throw new NotLoaded(this) }


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
        let item = core._proxy_ = ItemProxy.wrap(core)
        if (id !== undefined) core._id_ = id
        return item
    }

    static async from_data(id, data) {
        return Item.from_record(new ItemRecord(id, data))
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

    _set_id(id) {
        /* Like obj._id_ = id, but allows re-setting with the same ID value. */
        let prev = this._id_
        if (prev !== undefined) assert(prev === id, `ID is read-only and can't be changed from ${prev} to ${id}`)
        else this._id_ = id
        return id
    }


    /***  Loading & initialization ***/

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

            await this._init_class()                        // set the target JS class on this object; stubs only have Item as their class, which must be changed when the item is loaded and linked to its category
            this._init_network()

            let init = this.__init__()                      // optional custom initialization after the data is loaded
            if (init instanceof Promise) await init         // must be called BEFORE this._data_=data to avoid concurrent async code treat this item as initialized

            this._set_expiry(category?.cache_ttl)

            if (this.is_linked())
                this._ready_.url = this._init_url()         // set the URL path of this item; intentionally un-awaited to avoid blocking the load process of dependent objects

            return this

        } finally {
            this._meta_.loading = false                     // cleanup to allow another load attempt, even after an error
        }
    }

    async _load_record() {
        this.assert_linked()
        // schemat.registry.session?.countLoaded(this._id_)

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
        let prototypes = this._prototypes_
        // for (const p of prototypes)        // TODO: update the code below to verify ._category_ instead of CIDs
            // if (p.cid !== this.cid) throw new Error(`item ${this} belongs to a different category than its prototype (${p})`)
        prototypes = prototypes.filter(p => !p.is_loaded())
        if (prototypes.length === 1) return prototypes[0].load()            // performance: trying to avoid unnecessary awaits or Promise.all()
        if (prototypes.length   > 1) return Promise.all(prototypes.map(p => p.load()))
    }

    async _init_class() {
        /* Initialize this item's class, i.e., substitute the object's temporary Item class with an ultimate subclass,
           known after loading the item's data.
         */
        // T.setClass(this, await this.getClass() || Item)
        if (this._id_ === ROOT_ID) return T.setClass(this, RootCategory)
        let cls = this._class_ || this._category_?.item_class || await this._category_?._item_class_
        T.setClass(this, cls || Item)
    }

    async _init_url() {
        /* Initialize this item's URL path, this._url_. */

        let site = registry.site

        while (!site) {                                         // wait until the site is created (important for bootstrap objects)
            // print('no registry.site, waiting for it to be initialized... in', this.constructor?.name || this, `[${this._id_}]`)
            await delay()
            if (this._url_) return this._url_                   // already initialized?
            if (registry.is_closing) return undefined           // site is closing? no need to wait any longer
            site = registry.site
        }

        let container = this._container_
        let default_path = () => site.default_path_of(this)

        if (!container) {
            let url = default_path()
            print('missing _container_:', url, `(${this.name})`)
            return this._url_ = this._path_ = url
        }
        // let container = await registry.site.resolve(this.container_path, true)
        // print(`_init_url() container: '${container.name}'`)

        if (!container.is_loaded()) await container.load()          // container must be fully loaded
        if (!container._path_) await container._ready_.url          // container's path must be initialized

        this._path_ = container.build_path(this)
        let [url, duplicate] = site.path_to_url(this._path_)
        // print('_init_url():', url, ` (duplicate=${duplicate})`)

        return this._url_ = duplicate ? default_path() : url
    }

    _init_network() {
        /* Create a .net connector and .action triggers for this item's network API. */
        let role = registry.server_side ? 'server' : 'client'
        this._net_ = new Network(this, role, this.constructor.api)
        this.action = this._net_.create_triggers(this.constructor.actions)
    }


    /***  Access to properties  ***/

    _compute_property(prop) {
        /* Compute a property, `prop`, and return an array of its values. The array consists of own data + inherited
           (in this order), or just schema default / imputed (if own/inherited are missing).
           If the schema doesn't allow multiple entries for `prop`, only the first one is included in the result
           (for atomic types), or the objects (own, inherited & default) get merged altogether (for "mergeable" types like CATALOG).
         */
        assert(typeof prop === 'string')

        let data = this._data_
        if (!data) throw new NotLoaded(this)

        let proxy = this._proxy_
        let type

        // find out the `type` (Type instance) of the property ...
        // _category_ needs special handling because the schema is not yet available at this point

        if (prop === '_category_') type = new ITEM({inherit: false})
        else {
            // let schema = proxy._schema_ || new DATA_GENERIC()    // doesn't work here due to circular deps on properties
            let category = proxy._category_
            let schema = category?.item_schema || new DATA_GENERIC()
            type = schema.get(prop)
        }

        if (!type) return []

        // if the property is atomic (non-repeated and non-compound) and an own value is present, skip inheritance to speed up
        if (!type.isRepeated() && !type.isCompound() && data.has(prop))
            return [data.get(prop)]

        let ancestors = type.props.inherit ? proxy._ancestors_ : [proxy]    // `this` is always included as the first ancestor
        let streams = ancestors.map(proto => proto._own_values(prop))
        let values = type.combine_inherited(streams, proxy)                 // `default` and `impute` of the schema is applied here

        return values
    }

    _own_values(prop)  { return this._data_.getValues(prop) }

    async refresh() {
        /* Get the most current instance of this item from the registry - can differ from `this` (!) - and make sure it's loaded. */
        return registry.getItem(this._id_).load()
    }

    dump_data() {
        /* Encode and stringify this._data_ through JSONx. Nested values are recursively encoded. */
        return JSONx.stringify(this._data_)
    }

    url(endpoint, args) {
        /* `endpoint` is an optional name of an ::endpoint, `args` will be appended to URL as a query string. */

        let path = this._url_
        if (!path) {
            console.error(`missing _url_ for object [${this._id_}], introduce a delay or await _ready_.url`)
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
        return this._category_.inherits(category)
    }

    inherits(parent) {
        /* Return true if `this` inherits from a `parent` item through the item prototype chain (NOT javascript prototypes).
           True if parent==this. All comparisons by item ID.
         */
        if (schemat.equivalent(this, parent)) return true
        for (const proto of this._prototypes_)
            if (proto.inherits(parent)) return true
        return false
    }

    mark_editable() {
        /* Mark this item as editable and remove it from the Registry. */
        registry.unregister(this)
        this._meta_.mutable = true
        return this
    }


    __init__() {}
        /* Optional item-specific initialization after this._data_ is loaded.
           Subclasses may override this method as either sync or async.
         */
    __done__() {}
        /* Custom clean up to be executed after the item was evicted from the Registry cache. Can be async. */


    __handle__(request) {
        /* Serve a web or internal Request by executing the corresponding service from this.net.
           Query parameters are passed in `req.query`, as:
           - a string if there's one occurrence of PARAM in a query string,
           - an array [val1, val2, ...] if PARAM occurs multiple times.
        */
        let {methods: names, protocol} = request
        request.target = this

        if (!names.length) {
            let defaults = this._category_?.default_endpoints.getValues(protocol) || []
            names.push(...defaults)
        }

        if (!names.length) {
            let defaults = {GET: ['main', 'admin'], CALL: ['self']}
            names.push(...defaults[protocol] || [])
        }

        if (!names.length) return request.throwNotFound(`endpoint not specified (protocol ${protocol}`)

        let endpoints = names.map(e => `${protocol}/${e}`)        // convert endpoint names to full protocol-qualified endpoints: GET/xxx

        for (let endpoint of endpoints) {
            let service = this._net_.resolve(endpoint)
            if (service) {
                // print(`handle() endpoint: ${endpoint}`)
                request.endpoint = endpoint
                return service.server(this, request)
            }
        }

        request.throwNotFound(`endpoint(s) not found in the target object: [${endpoints}]`)
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
    //     if (name) base = registry.getClass(name)
    //
    //     let body = this.route_internal(('class')           // full class body from concatenated `code` and `code_*` snippets
    //     if (!body) return base
    //
    //     let url = this.sourceURL('class')
    //     let import_ = (path) => {
    //         if (path[0] === '.') throw Error(`relative import not allowed in dynamic code of a category (${url}), path='${path}'`)
    //         return registry.site.import(path)
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

// When service functions (below) are called, `this` is always bound to the Item instance, so they execute
// in the context of their item like if they were regular methods of the Item (sub)class.
// The first argument, `request`, is a Request instance, followed by action-specific list of arguments.
// In a special case when an action is called directly on the server through item.action.XXX(), `request` is null,
// which can be a valid argument for some actions - supporting this type of calls is NOT mandatory, though.

Item.create_api(
    {
        // http endpoints...

        'CALL/self':    new InternalService(function() { return this }),

        'GET/admin':    new ReactPage(ItemAdminView),
        'GET/json':     new JsonService(function() { return this._record_.encoded() }),

        // item's edit actions for use in the admin interface...
        'POST/edit':  new TaskService({

            delete_self(request)   { return schemat.db.delete(this) },

            // TODO: in all the methods below, `this` should be copied and reloaded after modifications

            insert_field(request, path, pos, entry) {
                // if (entry.value !== undefined) entry.value = this.getSchema([...path, entry.key]).decode(entry.value)
                if (entry.value !== undefined) entry.value = JSONx.decode(entry.value)
                this.mark_editable()
                this._data_.insert(path, pos, entry)
                return schemat.db.update_full(this)
            },

            delete_field(request, path) {
                this.mark_editable()
                this._data_.delete(path)
                return schemat.db.update_full(this)
            },

            update_field(request, path, entry) {
                // if (entry.value !== undefined) entry.value = this.getSchema(path).decode(entry.value)
                if (entry.value !== undefined) entry.value = JSONx.decode(entry.value)
                this.mark_editable()
                this._data_.update(path, entry)
                return schemat.db.update_full(this)
            },

            move_field(request, path, pos1, pos2) {
                this.mark_editable()
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
    /* A category is an item that describes other items: their schema and functionality;
       also acts as a manager that controls access to and creation of new items within category.
     */

    /***  Special properties:

    item_schema             ITEM_SCHEMA of items in this category (not the schema of self)

    _source_                module source code of this category: all code snippets combined, including inherited ones

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
        return Item.from_data(id, data)
    }

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
        let site = registry.site
        let client_side = registry.client_side
        let [classPath, name] = this.getClassPath()

        if (!site) {
            // when booting up, a couple of core items must be created before registry.site becomes available
            if (!classPath) throw new Error(`missing 'class_path' property for a core category, ID=${this._id_}`)
            if (this._hasCustomCode()) throw new Error(`dynamic code not allowed for a core category, ID=${this._id_}`)
            return {Class: await this.getDefaultClass(classPath, name)}
        }

        let path = this._url_ || await this._ready_.url                 // wait until the item's URL is initialized
        assert(path, `missing _url_ for category ID=${this._id_}`)

        try {
            return await (client_side ?
                            registry.import(path) :
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
        return registry.importDirect(path, name || 'default')
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
        // let side = registry.server_side ? 'server' : 'client'
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
}


Category.create_api(
    {
        'GET/admin':    new ReactPage(CategoryAdminView),
        'GET/import':   new HttpService(function (request)
            {
                /* Send JS source code of this category with a proper MIME type to allow client-side import(). */
                this._checkPath(request)
                request.res.type('js')
                return this._source_
            }),

        'POST/read': new TaskService({
            list_items: new Task({
                /* Retrieve all children of `this` category server-side and send them to client as a JSON array
                   of flat, fully loaded records.
                 */
                async process(request, offset, limit) {
                   // TODO: use size limit & offset (pagination).
                   // TODO: let declare if full items (loaded), or meta-only, or naked stubs should be sent.
                    let items = []
                    for await (const item of registry.scan_category(this)) {
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
                            // registry.unregister(rec.id)          // evict the item from the Registry to allow re-loading
                        }
                        items.push(await registry.getLoaded(rec.id))
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

    get item_schema() {
        /* In RootCategory, this == this._category_, and to avoid infinite recursion we must perform schema inheritance manually. */
        let root_fields = this._data_.get('fields')
        let default_fields = root_fields.get('fields').props.default
        let fields = new Catalog(root_fields, default_fields)
        let custom = this._data_.get('allow_custom_fields')
        return new DATA({fields: fields.object(), strict: custom !== true})
    }

    // _init_class() {}                            // RootCategory's class is already set up, no need to do anything more
}


/**********************************************************************************************************************/

set_global({Item})                  // Item class is available globally without import, for dynamic code
