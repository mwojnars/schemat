/**********************************************************************************************************************
 *  Main class of Schemat's web object model.
 *
 *  @author Marcin Wojnarski
 *
 */

import {print, assert, T, escape_html, concat, unique, delay} from '../common/utils.js'
import {NotLinked, NotLoaded, ValidationError} from '../common/errors.js'

import {Data} from './data.js'
import {REF} from "../types/type.js"
import {DATA_GENERIC} from "../types/catalog.js"

import {DataRecord} from "../db/records.js"
import {DataRequest} from "../db/data_request.js"

import {html_page} from "../web/adapters.js"
import {Assets} from "../web/component.js"
import {Request} from "../web/request.js"
import {ReactPage, ItemRecordView} from "../web/pages.js"


let ROOT_ID, RootCategory

// Due to circular dependency between object.js and category.js, RootCategory must be imported with dynamic import() and NOT awaited:
import("./category.js").then(module => {
    ROOT_ID = module.ROOT_ID
    RootCategory = module.RootCategory
    print('imported RootCategory')
})


// // AsyncFunction class is needed for parsing from-DB source code
// const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor


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
}


/**********************************************************************************************************************
 **
 **  PROXY
 **
 */

class ItemProxy {
    /* A Proxy wrapper for web objects: either stubs, newly created (unlinked) objects, or loaded from DB.
       Combines plain object attributes with loaded properties and makes them all accessible with the `obj.prop` syntax.
       Performs caching of computed properties in plain attributes of the `target` object.
       Ensures immutability of regular properties.
       Since a Proxy class can't be subclassed, all methods and properties of ItemProxy are static.
     */

    // the suffix appended to the property name when a *plural* form of this property is requested
    // (i.e., an array of ALL values of a repeated field, not the first value only)
    static PLURAL_SUFFIX = '$'

    // these special props are always read from regular POJO attributes and NEVER from object's __data;
    // many calls ask for `then` because when a promise resolves, .then is checked for another chained promise;
    // defining a custom `then` prop is unsafe, hence we disallow it
    static SPECIAL = ['then', '__id', '__meta', '__data', '__record']

    // UNDEFINED token marks that the value has already been fully computed, with inheritance and imputation,
    // and still remained undefined, so it should *not* be computed again
    static UNDEFINED    = Symbol.for('ItemProxy.UNDEFINED')
    static NO_CACHING   = Symbol.for('ItemProxy.NO_CACHING')   // marks a wrapper around a value (typically from a getter) that should not be cached


    static wrap(target) {
        /* Create a Proxy wrapper around `target` object. */
        return new Proxy(target, {get: this.proxy_get, set: this.proxy_set})
    }

    static proxy_set(target, prop, value, receiver)
    {
        // special attributes are written directly to __self (outside __data, not sent to DB);
        // also, when the __data is not loaded yet, *every* write goes to __self
        if (!target.is_loaded()
            || typeof prop !== 'string'             // `prop` can be a symbol like [Symbol.toPrimitive]
            || ItemProxy.SPECIAL.includes(prop)
        ) return Reflect.set(target, prop, value, receiver)

        let suffix = ItemProxy.PLURAL_SUFFIX
        let plural = prop.endsWith(suffix)
        let base = (plural ? prop.slice(0, -suffix.length) : prop)        // use the base property name without the suffix
        // if (plural) prop = prop.slice(0, -suffix.length)        // use the base property name without the suffix

        // "_xyz" props are treated as "internal" and can be written to __self (if not *explicitly* declared in schema) OR to __data;
        // others are "regular" and can only be written to __data, never to __self
        let regular = (prop[0] !== '_' || prop.startsWith('__'))
        let schema = receiver.__schema              // using `receiver` not `target` because __schema is a cached property and receiver is the proxy wrapper here

        // write value in __data only IF the `prop` is in schema, or the schema is missing (or non-strict) AND the prop name is regular
        if (schema?.has(base) || (!schema?.props.strict && regular)) {
            print('proxy_set updating:', prop)
            if (plural) {
                if (!(value instanceof Array)) throw new Error(`array expected when assigning to a plural property (${prop})`)
                target.make_edit('set_all', {prop: base, values: value})
            }
            else target.make_edit('set', {prop, value})
            return true
        }
        else if (regular) throw new Error(`property not in object schema (${prop})`)

        // print('proxy_set() internal:', prop, '/', mutable)
        return Reflect.set(target, prop, value, receiver)
    }

    // static _edit_prop(target, prop, value) {
    //     let {edits} = target.__meta
    //     if (!edits) throw new Error(`cannot set '${prop}' on immutable object`)
    //     print('proxy_set updating:', prop)
    //     target.__data.set(prop, value)
    //     edits.push(new Edit('update', {path: prop, entry: {value}}))
    //     return true
    // }

    static proxy_get(target, prop, receiver)
    {
        let val, {cache} = target.__meta

        // try reading the value from `cache` first, return if found
        if ((val = cache?.get(prop)) !== undefined) return val === ItemProxy.UNDEFINED ? undefined : val

        // try reading the value from regular JS attributes of the `target`
        val = Reflect.get(target, prop, receiver)

        // cache the value IF it comes from a cachable getter (no point in re-assigning regular attrs)
        if (target.constructor.cachable_getters.has(prop)) {
            if (val?.[ItemProxy.NO_CACHING]) return val.value       // NO_CACHING flag? return immediately
            cache?.set(prop, val)
            return val
        }

        // return if the value was found in a regular JS attr (not a getter)
        if (val !== undefined) return val === ItemProxy.UNDEFINED ? undefined : val

        // return if the object is not loaded yet, or the property is special in any way
        if (!target.__data
            || typeof prop !== 'string'                 // `prop` can be a symbol like [Symbol.toPrimitive] - should skip
            || ItemProxy.SPECIAL.includes(prop)
        ) return undefined

        let suffix = ItemProxy.PLURAL_SUFFIX
        let plural = prop.endsWith(suffix)
        if (plural) prop = prop.slice(0, -suffix.length)        // use the base property name without the suffix

        // fetch ALL repeated values of `prop` from __data, ancestors, imputation etc. (even if plural=false)...
        let values = target._compute_property(prop)

        if (cache) {
            cache.set(prop + suffix, values)
            cache.set(prop, values.length ? values[0] : ItemProxy.UNDEFINED)
        }
        return plural ? values : values[0]
    }
}


/**********************************************************************************************************************/

export class Item {     // WebObject? Entity? Artifact? durable-object? FlexObject?

    /*
    An application object that is persisted in a database, has a unique ID, is potentially accessible by a URL,
    and can communicate with its own instances on other machines.

    - last_update -- [UUID of the last "update request" message + set of output changes]; ensures idempotency of updates within kafka transactions:
                     when a transaction is aborted, but the update was already written (without change propagation to derived indexes),
                     the resumed transaction only sends out all change requests without rewriting the same update;
                     after successful commit, the item record is re-written with the `last_update` field removed
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
    */


    /***  Common properties ***/

    name
    info
    __status

    /***  Special properties:

    (some of the props below have getters defined, so they must be commented out not to mask the getters)

    __id                    database ID of the object, globally unique; undefined in a newly created item; must never be changed for an existing item;
                            it is assumed that if __id exists, the object is ALREADY stored in the DB (is "linked");
                            for a newly created object that already has an ID assigned, but is not yet (fully) saved to DB, the ID must be kept
                            in __meta.provisional_id instead (!) to avoid premature attempts to load the object's properties from DB

    __data                  own properties of this object in raw form (before imputation etc.), as a Data object created during .load()

    __record                DataRecord that contains this item's ID and data as loaded from DB during last load() or assigned directly;
                            undefined in a newborn item; immutable after the first assignment

    __base                  virtual category: either the __category itself (if 1x present), or a newly created Category object (TODO)
                            that inherits (like from prototypes) from all __category$ categories listed in this object

    __schema                schema of this item's data, as a DATA object

    __extends
    __prototypes            array of direct ancestors (prototypes) of this object; alias for `__extends$`
    __ancestors             array of all ancestors, deduplicated and linearized, with `this` at the first position

    __class                 JS class (or its class path) for this item; assigned AFTER object creation during .load()
    __category              category of this item, as a Category object
    __container             Container of this item, for canonical URL generation
    __status                a string describing the current state of this object in the DB, e.g., "DRAFT"; undefined means normal state
    __ttl                   time-to-live of this object in the registry [seconds]; 0 = immediate eviction on the next cache purge

    __path                  URL path of this object; similar to __url, but contains blanks segments; imputed via _impute_path()
    __url                   absolute URL path of this object, calculated via type imputation in _impute_url()
    __assets                cached web Assets of this object's __schema

    __services              instance-level dictionary {...} of all Services; initialized once for the entire class and stored in the prototype (!), see _create_services()

    */

    set __id(id) {
        let prev = this.__id
        if (prev !== undefined && prev !== id) throw new Error(`object ID is read-only and can't be changed from ${prev} to ${id}`)
        if (id !== undefined) Object.defineProperty(this, '__id', {value: id, writable: false})
    }

    get id() { return this.__id }           // alias for __id

    get __record() {
        this.assert_linked()
        this.assert_loaded()
        return new DataRecord(this.__id, this.__data.dump())
    }
    set __record(record) {
        assert(record)
        assert(record.id === this.__id)
        if (this.__meta.mutable) return                 // no caching of __record in a mutable object
        this.__meta.cache?.set('__record', record)      // __record is a special prop (ItemProxy.SPECIAL), so if we allow its modification the `cache` must be updated manually
    }

    get __base() {
        let cats = this.__category$
        if (cats?.length > 1) throw new Error(`multiple categories not supported yet`)
        return cats[0]
    }

    get __schema() {
        return this.__category?.__child_schema || new DATA_GENERIC()
    }

    get __prototypes() { return this.__extends$ }

    get __proto_versions() { return this.__prototypes.map(proto => proto.__ver || 0) }      // DRAFT

    get __ancestors() {
        // TODO: use C3 algorithm to preserve correct order (MRO, Method Resolution Order) as used in Python:
        // https://en.wikipedia.org/wiki/C3_linearization
        // http://python-history.blogspot.com/2010/06/method-resolution-order.html
        let prototypes = this.__prototypes
        let candidates = prototypes.map(proto => proto.__ancestors)
        return [this, ...unique(concat(candidates))]
    }

    get __assets()  {
        let assets = new Assets()
        this.__schema.collect(assets)
        return assets
    }

    service         // isomorphic service triggers created for this object from its class's __services; called as this.service.xxx(args) or this.service.xxx.TYPE(args),
                    // where TYPE is GET/POST/CALL/... - works both on the client and server (in the latter case, the call executes server function directly without network communication)


    // static compare(obj1, obj2) {
    //     /* Ordering function that can be passed to array.sort() to sort objects from DB by ascending ID. */
    //     return obj1.__id - obj2.__id
    // }


    /***  Internal properties  ***/

    __proxy         // Proxy wrapper around this object created during instantiation and used for caching of computed properties
    __self          // a reference to `this`; for proper caching of computed properties when this object is used as a prototype (e.g., for View objects) and this <> __self during property access

    __meta = {                      // some special properties are grouped here to avoid cluttering the object's interface ...
        loading:        false,      // promise created at the start of _load() and removed at the end; indicates that the object is currently loading its data from DB
        mutable:        false,      // if true, object can be edited; the edits are accumulated and committed to DB using .save(); this prop CANNOT be changed after construction; editable objects are excluded from server-side caching
        loaded_at:      undefined,  // timestamp [ms] when the full loading of this object was completed; to detect the most recently loaded copy of the same object
        expire_at:      undefined,  // timestamp [ms] when this item should be evicted from cache; 0 = immediate (i.e., on the next cache purge)
        provisional_id: undefined,  // ID of a newly created object that's not yet saved to DB, or the DB record is incomplete (e.g., the properties are not written yet)
        //pending_url:  undefined,  // promise created at the start of _init_url() and removed at the end; indicates that the object is still computing its URL (after or during load())

        cache:          undefined,  // Map of properties loaded from __data, imputed or inherited, stored here for performance; ONLY present in immutable object
        edits:          undefined,  // array of edit operations that were reflected in `local` so far, for replay on the DB; each edit is a pair: [op, args]

        // db         // the origin database of this item; undefined in newborn items
        // ring       // the origin ring of this item; updates are first sent to this ring and only moved to an outer one if this one is read-only
    }


    static _cachable_getters         // a Set of names of getters of the Item class or its subclass - for caching in ItemProxy

    static _collect_cachable_getters() {
        /* Find all getter functions in the current class, combine with parent's set of getters and store in _cachable_getters. */
        const prototype = this.prototype
        const parent_getters = this.__proto__?.cachable_getters || []
        const own_getters = Object.getOwnPropertyNames(prototype)
                .filter(prop => {
                    const descriptor = Object.getOwnPropertyDescriptor(prototype, prop)
                    return descriptor && typeof descriptor.get === 'function'
                })
        return this._cachable_getters = new Set([...parent_getters, ...own_getters])
    }

    static get cachable_getters() {
        return (this.hasOwnProperty('_cachable_getters') && this._cachable_getters) || this._collect_cachable_getters()
    }


    /***  Object status  ***/

    is_newborn()    { return this.__id === undefined }              // object is "newborn" when it hasn't been written to DB yet and has no ID assigned; "newborn" = "unlinked"
    is_linked()     { return this.__id !== undefined }              // object is "linked" when it has an ID, which means it's persisted in DB or is a stub of an object to be loaded from DB
    is_loaded()     { return this.__data && !this.__meta.loading }  // false if still loading, even if data has already been created but object's not fully initialized (except __url & __path which are allowed to be delayed)
    //is_expired()    { return this.__meta.expire_at < Date.now() }

    assert_linked() { if (!this.is_linked()) throw new NotLinked(this) }
    assert_loaded() { if (!this.is_loaded()) throw new NotLoaded(this) }
    assert_loaded_or_newborn() { if (!this.is_loaded() && !this.is_newborn()) throw new NotLoaded(this) }

    is_equivalent(other) {
        /* True if `this` and `other` object have the same ID; they still can be two different instances
           AND may contain different data (!), for example, if one of them contains more recent updates than the other.
           If `other` is undefined or any of the objects has a missing ID, they are considered NOT equivalent.
         */
        return this.__id !== undefined && this.__id === other?.__id
    }


    /***  Instantiation  ***/

    constructor(_fail = true, {mutable = false} = {}) {
        /* For internal use! Always call Item.create() or category.create() instead of `new Item()`.
           By default, the object is created immutable, and on client (where all modifications are local to the single client process)
           this gets toggled automatically on the first attempt to object modification. On the server
           (where any modifications might spoil other web requests), changing `mutable` after creation is disallowed.
         */
        if(_fail) throw new Error('web object must be instantiated through CLASS.create() instead of new CLASS()')

        this.__self = this              // for proper caching of computed properties when this object is used as a prototype (e.g., for View objects)

        // mutable=true allows edit operations on the object and prevents server-side caching of the object in Registry;
        // only on the client this flag can be changed after object creation
        Object.defineProperty(this.__meta, 'mutable', {value: mutable, writable: CLIENT, configurable: false})

        if (mutable)
            this.__meta.edits = []
        else
            this.__meta.cache = new Map()
    }

    static create_stub(id = null, opts = {}) {
        /* Create a stub: an empty item with `id` assigned. To load data, load() must be called afterwards. */

        // special case: the root category must have its proper class (RootCategory) assigned right from the beginning for correct initialization
        if (id === ROOT_ID && !this.__is_root_category)
            return RootCategory.create_stub(id)

        let obj = new this(false, opts)
        if (id !== undefined && id !== null) obj.__id = id
        return obj.__proxy = ItemProxy.wrap(obj)
    }

    static create(...args) {
        /* Create an empty newborn object, no ID, and execute its __create__(...args). Return the object.
           If __create__() returns a Promise, this method returns a Promise too.
           This method should be used instead of the constructor.
         */
        if (this.__category === undefined) throw new Error(`static __category must be configured when calling create() through a class not category`)
        let obj  = this.create_stub(null, {mutable: true})               // newly-created objects are always mutable
        let wait = obj.__create__(...args)
        return wait instanceof Promise ? wait.then(() => obj) : obj
    }

    __create__(...args) {
        /* Override in subclasses to initialize properties of a newborn item (not from DB) returned by Item.create(). */
    }

    static async from_json(id, json, opts = {}) {
        /* Create a new Item instance given an encoded JSON string with the object's content. */
        assert(typeof json === 'string')
        return Item.from_record(new DataRecord(id, json), opts)
    }

    static async from_record(record /*DataRecord*/, opts = {}) {
        /* Create a new item instance: either a newborn one (intended for insertion to DB, no ID yet);
           or an instance loaded from DB and filled out with data from `record` (an DataRecord).
           In any case, the item returned is *booted* (this.__data is initialized) and activated (__init__() was called).
         */
        // TODO: if the record is already cached in binary registry, return the cached item...
        // TODO: otherwise, create a new item and cache it in binary registry
        let item = Item.create_stub(record.id, opts)
        return item.load({record})
    }

    _get_write_id() {
        /* Either __id or __meta.provisional_id. */
        return this.__id !== undefined ? this.__id : this.__meta.provisional_id
    }


    /***  Loading & initialization ***/

    async load({record = null /*DataRecord*/, await_url = true} = {}) {
        /* Load full data of this item from `record` or from DB, if not loaded yet. Return this object.
           The data can only be loaded ONCE for a given Item instance due to item's immutability.
           If you want to refresh the data, create a new instance or use refresh() instead.
           `await_url` has effect only after the schemat.site is loaded, not during boot up.
         */
        if (this.__data || this.__meta.loading) {           // data is loaded or being loaded right now? do nothing except for awaiting the URL (previous load() may have been called with await_url=false)
            assert(!record)
            // if (await_url && schemat.site && this.__meta.pending_url)
            //     await this.__meta.pending_url
            return this.__meta.loading || this              // if a previous load() is still running (`loading` promise), wait for it to complete instead of starting a new one
        }
        if (this.is_newborn() && !record) return this                       // newborn item with no ID and no data to load? fail silently; this allows using the same code for both newborn and in-DB items
        return this.__meta.loading = this._load(record, await_url)          // keep a Promise that will eventually load the data; this is needed to avoid race conditions
    }

    async _load(record /*DataRecord*/, await_url) {
        /* Load this.__data from `record` or DB. Set up the class and prototypes. Call __init__(). */

        schemat.before_data_loading(this)

        try {
            record = record || await schemat.load_record(this.__id)
            assert(record instanceof DataRecord, record)

            this.__data = record.data_copy
            if (record.id !== undefined)                    // don't keep a record without ID: it's useless and creates inconsistency when ID is assigned
                this.__record = record

            let proto = this._load_prototypes()             // load prototypes
            if (proto instanceof Promise) await proto

            for (let category of this.__category$)          // this.__data is already loaded, so __category$ should be available, but still it can be empty (for non-categorized objects)
                if (!category.is_loaded() && category !== this)
                    await category.load({await_url: false}) // if category URLs were awaited, a circular dependency would occur between Container categories and their objects that comprise the filesystem where these categories are placed

            if (this.__status) print(`WARNING: object [${this.__id}] has status ${this.__status}`)

            let cls = await this._load_class()              // set the target JS class on this object; stubs only have Item as their class, which must be changed when the data is loaded and the item is linked to its category
            T.setClass(this, cls || Item)

            this._init_services()

            // if (this.is_linked())
            //     this.__meta.pending_url = this._init_url()  // set the URL path of this item; intentionally un-awaited to avoid blocking the load process of dependent objects

            let init = this.__init__()                      // custom initialization after the data is loaded (optional);
            if (init instanceof Promise) await init         // if this.__url is needed inside __init__(), __meta.pending_url must be explicitly awaited there

            // if (await_url && schemat.site && this.__meta.pending_url)
            //     await this.__meta.pending_url

            let now = Date.now()
            this.__meta.loaded_at = now
            this.__meta.expire_at = now + (this.__ttl || 0) * 1000

            return this

        } catch (ex) {
            this.__data = undefined                         // on error, clear the data to mark this object as not loaded
            throw ex

        } finally {
            this.__meta.loading = false                     // cleanup to allow another load attempt, even after an error
            schemat.after_data_loading(this)
        }
    }

    _load_prototypes() {
        /* Load all Schemat prototypes of this object. */
        let opts = {await_url: false}                                       // during boot up, URLs are not awaited to avoid circular dependencies (see category.load(...) inside _load())
        let prototypes = this.__prototypes.filter(p => !p.is_loaded())
        if (prototypes.length === 1) return prototypes[0].load(opts)        // performance: trying to avoid unnecessary awaits or Promise.all()
        if (prototypes.length   > 1) return Promise.all(prototypes.map(p => p.load(opts)))
    }

    _load_class() {
        /* Load or import this object's ultimate class. */
        if (this.__id === ROOT_ID) return RootCategory
        let path = this.__class || this.__category?.class
        if (path) return schemat.import(path)                   // the path can be missing, for no-category objects
    }

    async reload() {
        /* Create a new instance of this object using the most recent version of this object's content
           as available in the registry or downloaded from the DB. */
    }


    /***  initialization of URL & services  ***/

    // async _init_url() {
    //     while (!schemat.site) {                                     // wait until the site is created; important for bootstrap objects
    //         await delay()
    //         if (schemat.is_closing) return                          // site is closing? no need to wait any longer
    //     }
    //
    //     let container = this.__container
    //     if (!container) return this.__url                           // root Directory has no parent container; also, no-category objects have no *default* __container and no imputation of __path & __url
    //
    //     if (!container.is_loaded()) await container.load()          // container must be fully loaded
    //     if (!container.__path) await container.__meta.pending_url   // container's path must be initialized
    //     return this.__url                                           // invokes calculation of __path and __url via impute functions
    // }

    _impute__path() {
        /* Calculation of __path if missing. */
        return this.__container?.get_access_path(this) || this.system_url
    }

    _impute__url() {
        /* Calculation of __url if missing: same as __path but with blank routes (*ROUTE) removed. */
        return this.__path.replace(/\/\*[^/]*/g, '')
        // let [url, on_blank_route] = Item._decode_access_path(this.__path)
        // if (on_blank_route)                                         // if any of the ancestor containers has the same URL, use the system URL instead for this object
        //     for (let parent = this.__container; parent; parent = parent.__container)
        //         if (url === parent.__url) return this.system_url
        // return url
    }

    // static _decode_access_path(path) {
    //     /* Convert a container access path to a URL path by removing all blank segments (/*xxx).
    //        NOTE 1: if the last segment is blank, the result URL can be a duplicate of the URL of a parent or ancestor container (!);
    //        NOTE 2: even if the last segment is not blank, the result URL can still be a duplicate of the URL of a sibling object,
    //                if they both share an ancestor container with a blank segment. This case cannot be automatically detected
    //                and should be prevented by proper configuration of top-level containers.
    //      */
    //     let last = path.split('/').pop()
    //     let last_blank = last.startsWith('*')           // if the last segment is blank, the URL may be a duplicate of an ancestor's URL
    //     let url = path.replace(/\/\*[^/]*/g, '')
    //     return [url, last_blank]
    // }

    get system_url() {
        /* The internal URL of this object, typically /$/id/<ID> */
        return schemat.site.default_path_of(this)
    }


    static _collect_services() {
        /* Collect Services defined as static properties of the class and named "TYPE/endpoint" (TYPE in uppercase).
           The result is cached in prototype.__services for reuse by all objects of this class.
         */
        let is_endpoint = prop => prop.includes('/') && prop.split('/')[0] === prop.split('/')[0].toUpperCase()
        let names = T.getAllPropertyNames(this).filter(is_endpoint).filter(name => this[name])
        let endpoints = names.map(endpoint => {
            let service = this[endpoint]
            service.bindAt(endpoint)
            return [endpoint, service]
        })
        return this.prototype.__services = Object.fromEntries(endpoints)
    }

    _init_services() {
        /* Collect services for this object's class and create this.service.xxx() triggers for the object. */
        if (!this.constructor.prototype.hasOwnProperty('__services')) this.constructor._collect_services()
        let triggers = this.service = {}

        for (let [endpoint, service] of Object.entries(this.__services)) {
            let [type, name] = endpoint.split('/')
            if (triggers[name]) throw new Error(`service with the same name already exists (${name}) in [${this.id}]`)

            let trigger = SERVER
                ? (...args) => service.server(this, null, ...args)          // may return a Promise
                : (...args) => service.client(this, ...args)                // may return a Promise

            triggers[name] = trigger        // service.xxx(...)
            trigger[type] = trigger         // service.xxx.POST(...)
        }
    }


    /***  access to properties  ***/

    _compute_property(prop) {
        /* Compute a property, `prop`, and return an array of its values. The array consists of own data + inherited
           (in this order), or just schema default / imputed (if own/inherited are missing).
           If the schema doesn't allow multiple entries for `prop`, only the first one is included in the result
           (for atomic types), or the objects (own, inherited & default) get merged altogether (for "mergeable" types like CATALOG).
         */
        assert(typeof prop === 'string')

        let proxy = this.__proxy
        let data  = this.__data
        if (!data) throw new NotLoaded(this)

        // check the Type of the property in this object's __schema; special handling for:
        // 1) __extends: because it is used at an early stage of the loading process (_load_prototypes() > this.__prototypes), before the object's category (and schema) is fully loaded;
        // 2) __category: because the schema is not yet available and reading the type from __schema would create circular dependency.

        let type =
            prop === '__category' ? new REF() :
            prop === '__extends'  ? new REF({inherit: false}) :
                                    proxy.__schema.get(prop)

        if (!type) return []

        // if the property is atomic (non-repeated and non-compound) and an own value is present, skip inheritance to speed up
        if (!type.isRepeated() && !type.isCATALOG() && data.has(prop)) {
            let values = data.getAll(prop)
            if (values.length > 1) print(`WARNING: multiple values present for a property declared as unique (${prop} in [${this.id}]), using the first value only`)
            return [values[0]]  //[data.get(prop)]
        }

        let ancestors = type.props.inherit ? proxy.__ancestors : [proxy]    // `this` is always included as the first ancestor
        let streams = ancestors.map(proto => proto._own_values(prop))

        // read `defaults` from the category and combine them with the `streams`
        if (prop !== '__extends' && prop !== '__category')                  // avoid circular dependency for these special props
        {
            let category = proxy.__category
            if (this === category?.__self && prop === 'defaults')           // avoid circular dependency for RootCategory
                category = undefined

            let defaults = category?.defaults?.getAll(prop)
            if (defaults?.length) streams.push(defaults)
        }
        // else if (prop === '__category')
        //     streams.push([schemat.Uncategorized])

        return type.combine_inherited(streams, proxy)                       // `default` and `impute` of the `type` are applied here
    }

    _own_values(prop)  { return this.__data.getAll(prop) }

    instanceof(category) {
        /* Check whether this item belongs to a `category`, or its subcategory.
           All comparisons along the way use item IDs, not object identity. The item must be loaded.
        */
        return this.__category$.some(cat => cat.inherits_from(category))
    }

    inherits_from(parent) {
        /* Return true if `this` inherits from a `parent` item through the item prototype chain (NOT javascript prototypes).
           True if parent==this. All comparisons by item ID.
         */
        if (this.is_equivalent(parent)) return true
        for (const proto of this.__prototypes)
            if (proto.inherits_from(parent)) return true
        return false
    }


    self_encode() {
        /* Encode this object's content into plain objects and return as {id, data}, where `data` is encoded through JSONx.
           Encoded objects can be combined into larger structures for transfer or storage, and serialized together with the standard JSON.stringify().
         */
        if (this.id === undefined) throw new Error(`trying to encode a newborn object (no ID)`)
        if (!this.__data) throw new Error(`trying to encode a stub object (no __data)`)
        return {id: this.id, data: this.__data.encode()}
    }
    self_stringify() {
        return JSON.stringify(this.self_encode())
    }

    dump_data() {
        /* Encode and stringify this.__data through JSONx. Return a string. Nested values are recursively encoded. */
        return this.__data.dump()
    }

    url(endpoint, args) {
        /* Return the canonical URL of this object. `endpoint` is an optional name of ::endpoint,
           `args` will be appended to URL as a query string.
         */
        let path = this.__url || this.system_url                        // no-category objects may have no __url because of lack of schema and __url imputation
        if (endpoint) path += Request.SEP_ENDPOINT + endpoint           // append ::endpoint and ?args if present...
        if (args) path += '?' + new URLSearchParams(args).toString()
        return path
    }

    make_stamp({html = true, brackets = true, max_len = null, ellipsis = '...'} = {}) {
        /* [CATEGORY:ID] string (stamp) if the category of `this` has a name; or [ID] otherwise.
           If html=true, the category name is hyperlinked to the category's profile page (unless URL failed to generate)
           and is HTML-escaped. If max_len is provided, category's suffix may be replaced with '...' to make its length <= max_len.
         */
        let cat = this.__category?.name || ""
        if (max_len && cat.length > max_len) cat = cat.slice(max_len-3) + ellipsis
        if (html) {
            cat = escape_html(cat)
            let url = this.__category?.url()
            if (url) cat = `<a href="${url}">${cat}</a>`          // TODO: security; {url} should be URL-encoded or injected in a different way
        }
        let stamp = cat ? `${cat}:${this.__id}` : `${this.__id}`
        return brackets ? `[${stamp}]` : stamp
    }

    get_breadcrumb(max_len = 10) {
        /* Return an array of containers that lead from the site's root to this object.
           The array contains pairs [segment, container] where `segment` is a string that identifies `container`
           inside its parent; the last pair is [segment, this] (the object itself).
           If containers are correctly configured, the first pair is [undefined, site_object] (the root).
         */
        let steps = []
        let object = this

        while (object) {
            let parent = object.__container
            let segment = parent?.identify(object)

            steps.push([segment, object])

            if (steps.length > max_len) break                // avoid infinite loops
            object = parent
        }
        return steps.reverse()
    }

    validate() {
        // TODO SECURITY: make sure that __data does NOT contain special props: __meta, __self, __proxy, __id etc!

        for (const [prop, value] of this.__data) {          // validate each individual property in __data ...
            let type = this.__schema.get(prop)
            if (!type)                                      // the property `prop` is not present in the schema? skip or raise an error
                if (this.__category.allow_custom_fields) continue
                else throw new ValidationError(`unknown property: ${prop}`)

            type.validate(value)                            // may raise an exception

            if (!type.props.repeated) {                     // check that a single-valued property has no repetitions
                let count = this.__data.getAll(prop).length
                if (count > 1) throw new ValidationError(`found ${count} occurrences of a property declared as single-valued (${prop})`)
            }
        }

        // check multi-field constraints ...

        // run category-specific validation
        this.__validate__()
    }


    __validate__() {}
        /* Validate this object's properties before inserting to the database. Called *after* validation of individual values through their schema. */

    __setup__() {}
        /* Custom setup after this object is created AND inserted to the database. Called once site-wise right after the insertion is committed. */

    __teardown__() {}
        /* Custom tear down that is executed right after this object is deleted from the database. */

    __init__() {}
        /* Optional item-specific initialization after this.__data is loaded.
           Subclasses may override this method as either sync or async.
         */
    __done__() {}
        /* Custom clean up to be executed after the item was evicted from the registry cache. Can be async. */


    /***  Request handling  ***/

    async handle(request) {
        /* Serve a web or internal Request by executing the corresponding service from this.net.
           Query parameters are passed in `req.query`, as:
           - a string if there's one occurrence of PARAM in a query string,
           - an array [val1, val2, ...] if PARAM occurs multiple times.
        */
        assert(this.is_loaded)
        request.target = this

        // convert endpoint names to full protocol-qualified endpoints: GET/xxx
        let names = this._get_endpoints(request)
        let endpoints = names.map(e => `${request.protocol}/${e}`)

        // find the first endpoint that matches this request and launch its handler
        for (let endpoint of endpoints) {
            let service = this._get_handler(endpoint.replace('/','__'))
            service ??= this.__services[endpoint]
            if (!service) continue

            // print(`handle() endpoint: ${endpoint}`)
            request.endpoint = endpoint
            let handler = (typeof service === 'function') ? service.bind(this) : (r) => service.handle(this, r)
            let result = handler(request)
            if (result instanceof Promise) result = await result

            return (typeof result === 'function') ? result.call(this, request) : result
        }

        request.throwNotFound(`endpoint(s) not found in the target object: [${endpoints}]`)
    }

    _get_handler(endpoint) {
        return this[endpoint]
    }

    _get_endpoints(request) {
        /* Return a list of endpoint names (no protocol included) to be tried for this request. */

        // use request's endpoint if specified in the URL (::endpoint)
        let {methods: endpoints, protocol} = request
        if (endpoints.length) return endpoints

        // otherwise, use category defaults, OR global defaults (for no-category objects)
        let glob_defaults = {GET: ['view', 'admin', 'record'], CALL: ['self']}
        let catg_defaults = this.__category?.default_endpoints.getAll(protocol)
        let defaults = catg_defaults || glob_defaults[protocol]
        if (defaults.length) return defaults

        request.throwNotFound(`endpoint not specified (protocol ${protocol})`)
    }


    /***  Database operations on self  ***/

    delete_self() {
        /* Delete this object from the database. */
        return schemat.site.service.delete_object(this.__id)
    }

    _set_version() {
        /* Set __ver=1 for a newly created object, if so requested in category settings. */
        if (this.__base.versioning)
            this.__data.set('__ver', 1)
        else
            this.__data.delete('__ver')         // manually configuring __ver by the caller is disallowed
    }

    _bump_version(prev) {
        /* Increment (or set/delete) the __ver number, depending on the category's `versioning` setting.
           Create a new Revision with `prev` data (json) if keep_history=true in the category. May return a Promise.
           The existing __ver may get *removed* if `versioning` was disabled in the meantime (!).
         */
        if (this.__base.versioning) {
            let ver = this.__ver || 0
            this.__data.set('__ver', ver + 1)
            if (this.__base.keep_history)
                return this._create_revision(prev).then(rev => this.__data.set('__prev', rev))
        }
        else this.__data.delete('__ver')        // TODO: either drop orphaned revisions OR do garbage collection to save DB space and avoid accidental reuse when versioning starts again
    }

    async _create_revision(data) {
        /* Create a new Revision object to preserve the old `data` snapshot (JSON string). */
        // let Revision = await schemat.import('/$/sys/Revision')  ??
        // let Revision = schemat.sys.Revision
        // let rev = Revision.create()   ... Revision.create({data, target: this})
        // rev.target = this
        // rev.data = data
        // return rev.save()
    }

    // async insert_self() {
    //     /* Insert this (newborn) object and, recursively, all the newborn objects referenced by this one, to the database. */
    //
    //     assert(this.is_newborn(), 'trying to insert an object that is already stored in the database')
    //
    //     // find recursively all the objects referenced (directly or indirectly) by this one that are still
    //     // not persisted in the database; the graph of such objects may contain circular references -
    //     // including a reference of this object to itself (!)
    //     let refs = await this._find_unlinked_references()
    //
    //     // if no references need to be inserted together with this object, use the regular 1-phase insertion
    //     if (refs.length === 0) return schemat.db.insert(this)
    //
    //     // otherwise, perform a 2-phase insertion of 1+ of cross/self-referencing objects
    //     let objects = new Set([this, ...refs])
    //     return schemat.db.insert_many(...objects)
    // }
    //
    // async _find_unlinked_references(visited = new Set()) {
    //     /* Find recursively all newborn (non-persisted) objects that are referenced - directly or indirectly -
    //        by this one. If `this` is unsealed yet (properties are stored in POJO attributes not in __data),
    //        create __data from the object's regular attributes.
    //      */
    //     let data = await this.seal_data()
    //     let refs = data.find_references()
    //     let unlinked_refs = refs.filter(obj => obj.is_newborn() && !visited.has(obj))
    //
    //     unlinked_refs.forEach(ref => visited.add(ref))
    //
    //     for (let ref of unlinked_refs)
    //         await ref._find_unlinked_references(visited)
    //
    //     return visited
    // }
    //
    // async seal_data() {
    //     /* In a newborn (unlinked) object, create __data - if not present yet - by copying property values
    //        from regular POJO attributes of the object.
    //      */
    //     if (this.__data) return this.__data
    //     if (this.is_linked()) throw new Error('cannot seal properties of a linked object')
    //     return this.__data = await Data.from_object(this)
    // }


    /***  Object editing  ***/

    _make_mutable() {
        /* Make itself mutable. This removes the property cache, so read access becomes less efficient. Only allowed on client. */
        assert(CLIENT && !this.__meta.mutable)
        delete this.__meta.cache
        this.__meta.edits = []
        this.__meta.mutable = true
    }

    make_edit(op, args, save = false) {
        /* Perform the edit locally on the caller and append to __meta.edits so it can be submitted to the DB with save(). */
        let {mutable, edits} = this.__meta
        if (!mutable || !edits)
            if (SERVER) throw new Error(`cannot apply an edit operation ('${op}') to an immutable object [${this.id}]`)
            else this._make_mutable()         // on client, an immutable object becomes mutable on the first modification attempt

        let edit = [op, args]
        this.apply_edits(edit)
        this.__meta.edits.push(edit)
        if (save) return this.save()
    }

    apply_edits(...edits) {
        /* Apply edits before saving a modified object to the DB. For server-side use only. Each `edit` is an instance of Edit. */
        for (const edit of edits) {
            let {op, args} = (edit instanceof Edit) ? edit : {op: edit[0], args: edit[1]}
            const method = `EDIT_${op}`
            if (!this[method]) throw new Error(`object does not support edit operation: '${op}'`)
            this[method](structuredClone(args))     // `args` are deep-copied for safety, in case they get modified during the edit
        }
    }

    async save() {
        /* Send __meta.edits (for an existing object), or __data (for a newly created object) to DB. */
        this.assert_loaded_or_newborn()
        let edits = this.__meta.edits

        if (this.is_newborn()) {
            edits.length = 0                // truncate all edits up to now, they should be already reflected in __data
            let state = this.__data.__getstate__()
            return schemat.site.service.create_item(state).then(rec => {
                this.__id = schemat.register_record(DataRecord.decode(rec)).id
            })
        }

        if (!edits?.length) throw new Error(`no edits to be submitted for ${this.id}`)

        let submit = schemat.site.service.submit_edits(this.id, ...edits).then(rec => {
            schemat.register_record(DataRecord.decode(rec))
        })
        edits.length = 0
        return submit
    }


    // specialized edits for UI with immediate commit ...

    edit_insert(path, entry)        { return this.make_edit('insert', {path, ...entry}, true) }
    edit_delete(path)               { return this.make_edit('delete', {path}, true) }
    edit_update(path, entry)        { return this.make_edit('update', {path, ...entry}, true) }
    edit_move(path, delta)          { return this.make_edit('move',   {path, delta}, true) }


    /***  Server-side implementation of edits. NOT for direct use!  ***/

    /***  "Edits" are methods that manipulate directly on the object's __data instead of the object wrapper.
          They are only called on the server, inside the block's object-level lock, when modifications are to be committed to DB.
          New edit ops can be added in subclasses. An EDIT_{op} method can be async or return a Promise.
          The names of methods (the {op} suffix) must match the names of operations passed by callers to .edit().
          Typically, when adding a new OP, a corresponding client method, edit_OP(), is added, too.
     ***/

    EDIT_overwrite({data}) {
        /* Replace the entire set of own properties, __data, with a new Data object. */
        assert(false, 'not used?')
        if (typeof data === 'string') data = Data.load(data)
        assert(data instanceof Data)
        this.__data = data
    }

    EDIT_insert({path, key, value}) {
        /* Insert a new property; or a new field inside a nested Catalog in an existing property. */
        let pos = (path = [...path]).pop()
        this.__data.insert(path, pos, {key, value})
    }

    EDIT_delete({path}) {
        /* Delete a property; or a field inside a nested Catalog in a property. */
        this.__data.delete(path)
    }

    EDIT_update({path, key, value}) {
        /* Update a property; or a field inside a nested Catalog. */
        this.__data.update(path, {key, value})
    }

    EDIT_move({path, delta}) {
        /* Move a property or a field inside a nested Catalog. */
        let pos = (path = [...path]).pop()
        this.__data.move(path, pos, pos + delta)
    }


    EDIT_set({prop, value}) {
        this.__data.set(prop, value)
    }

    EDIT_set_all({prop, values}) {
        /* Set multiple (repeated) values for a given property, remove the existing ones. */
        this.__data.setAll(prop, ...values)
    }


    /***  Endpoints  ***/

    // When endpoint functions (below) are called, `this` is always bound to the Item instance, so they execute
    // in the context of their item like if they were regular methods of the Item (sub)class.
    // The first argument, `request`, is a Request instance, followed by action-specific list of arguments.
    // In a special case when an action is called directly on the server through _triggers_.XXX(), `request` is null,
    // which can be a valid argument for some actions - supporting this type of calls is NOT mandatory, though.


    GET__test_txt()         { return "TEST txt ..." }                   // works
    GET__test_fun()         { return () => "TEST function ..." }        // works
    GET__test_res({res})    { res.send("TEST res.send() ...") }         // works
    GET__test_html()        { return html_page(import.meta.resolve('../test/views/page_02.html')) }

    GET__json({res})        { res.json(this.self_encode()) }

    // CALL__self()     { print('CALL__self'); return this }
    // static ['CALL/self'] = new InternalService(function() { assert(false, 'NOT USED: Item.CALL/self'); return this })

    // GET__record(request)    { return new ReactPage(ItemRecordView).server(this, request) }
    // GET__record()     { return react_page(ItemRecordView) }
    static ['GET/record'] = new ReactPage(ItemRecordView)



    /***  Dynamic loading of source code  ***/

    // parseClass(base = Item) {
    //     /* Concatenate all the relevant `code_*` and `code` snippets of this item into a class body string,
    //        and dynamically parse them into a new class object - a subclass of `base` or the base class identified
    //        by the `class` property. Return the base if no code snippets found. Inherited snippets are included in parsing.
    //      */
    //     let name = this.get('_boot_class')
    //     if (name) base = schemat.get_builtin(name)
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


