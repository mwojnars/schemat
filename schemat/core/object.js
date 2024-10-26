/**********************************************************************************************************************
 *
 *  Main class of Schemat's Web Object model.
 *
 *  @author Marcin Wojnarski
 *
 */

import {print, assert, T, escape_html, concat, unique, delay} from '../common/utils.js'
import {NotLoaded, ValidationError} from '../common/errors.js'

import {Catalog, Data} from './catalog.js'
import {REF} from "../types/type.js"
import {SCHEMA_GENERIC} from "../types/catalog_type.js"
import {html_page} from "../web/adapters.js"
import {Assets} from "../web/component.js"
import {Request} from "../web/request.js"
import {ReactPage, ItemInspectView} from "../web/pages.js"
import {JsonPOST, Service} from "../web/services.js";
import {mDataRecord, mWebObjects, mDataString} from "../web/messages.js";

const ROOT_ID = 1
let RootCategory

// due to circular dependency between object.js and category.js, RootCategory must be imported with dynamic import() and NOT awaited:
import("./category.js").then(module => {RootCategory = module.RootCategory})


// // AsyncFunction class is needed for parsing from-DB source code
// const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor


/**********************************************************************************************************************
 **
 **  PROXY
 **
 */

class Intercept {
    /* A Proxy wrapper for all kinds of web objects: stubs, newborn, or loaded from DB.
       Combines plain object attributes with loaded properties and makes them all accessible with the `obj.prop` syntax.
       Performs caching of computed properties in plain attributes of the `target` object.
       Ensures immutability of regular properties.
       Since a Proxy class can't be subclassed, all methods and properties of Intercept are static.
     */

    // the suffix appended to the property name when a *plural* form of this property is requested
    // (i.e., an array of ALL values of a repeated field, not the first value only)
    static PLURAL = '$'

    // these special props are always read from regular POJO attributes and NEVER from object's __data;
    // many calls ask for `then` because when a promise resolves, .then is checked for another chained promise;
    // defining a custom `then` prop is unsafe, hence we disallow it
    static SPECIAL = ['then', '__id', '__meta', '__data']

    // UNDEFINED token marks that the value has already been fully computed, with inheritance and imputation,
    // and still remained undefined, so it should *not* be computed again
    static UNDEFINED    = Symbol.for('Intercept.UNDEFINED')
    static NO_CACHING   = Symbol.for('Intercept.NO_CACHING')   // marks a wrapper around a value (typically from a getter) that should not be cached


    static wrap(target) {
        /* Create a Proxy wrapper around `target` object. */
        return new Proxy(target, {get: this.proxy_get, set: this.proxy_set, deleteProperty: this.proxy_delete})
    }

    static proxy_set(target, prop, value, receiver)
    {
        // special attributes are written directly to __self (outside __data, not sent to DB);
        // also, when the __data is not loaded yet, *every* write goes to __self
        if (!(target.is_newborn() || target.is_loaded())
            || typeof prop !== 'string'             // `prop` can be a symbol like [Symbol.toPrimitive]
            || Intercept.SPECIAL.includes(prop)
        ) return Reflect.set(target, prop, value, receiver)

        let suffix = Intercept.PLURAL
        let plural = prop.endsWith(suffix)
        let base = (plural ? prop.slice(0, -suffix.length) : prop)        // base property name without the $ suffix

        // `_xyz` props are treated as "internal" and can be written to __self (if not *explicitly* declared in schema) OR to __data;
        // others, including `__xyz`, are "regular" and can only be written to __data, never to __self
        let regular = (prop[0] !== '_' || prop.startsWith('__'))
        let schema = receiver.__schema              // using `receiver` not `target` because __schema is a cached property and receiver is the proxy wrapper here
        let type = schema?.get(base)

        // write value in __data only IF the `prop` is in schema, or the schema is missing (or non-strict) AND the prop name is regular
        if (schema?.has(base) || (!schema?.options.strict && regular)) {
            // if (!target.is_newborn()) print('proxy_set updating:', prop)
            if (type?.options.virtual) throw new Error(`cannot modify a virtual property (${prop})`)
            if (plural) {
                if (!(value instanceof Array)) throw new Error(`array expected when assigning to a plural property (${prop})`)
                target._make_edit('set_values', base, value)
            }
            else target._make_edit('set_value', prop, value)
            return true
        }
        else if (regular) throw new Error(`property not in object schema (${prop})`)

        // print('proxy_set() internal:', prop, '/', mutable)
        return Reflect.set(target, prop, value, receiver)
    }

    static proxy_delete(target, prop) {
        throw new Error('not implemented')
        // return Reflect.deleteProperty(target, prop)
    }

    static proxy_get(target, prop, receiver)
    {
        let val, {cache} = target.__meta

        // try reading the value from `cache` first, return if found
        if ((val = cache?.get(prop)) !== undefined) return val === Intercept.UNDEFINED ? undefined : val

        // try reading the value from regular JS attributes of the `target`
        val = Reflect.get(target, prop, receiver)

        // cache the value IF it comes from a cachable getter (no point in re-assigning regular attrs)
        if (target.constructor.cachable_getters.has(prop)) {
            if (val?.[Intercept.NO_CACHING]) return val.value       // NO_CACHING flag? return immediately
            if (cache) Intercept._cache_value(cache, prop, val)
            return val
        }

        // return if the value was found in a regular JS attr (not a getter)
        if (val !== undefined) return val === Intercept.UNDEFINED ? undefined : val

        // return if the object is not loaded yet, or the property is special in any way
        if (!target.__data
            || typeof prop !== 'string'                 // `prop` can be a symbol like [Symbol.toPrimitive] - should skip
            || Intercept.SPECIAL.includes(prop)
        ) return undefined

        let suffix = Intercept.PLURAL
        let plural = prop.endsWith(suffix)
        if (plural) prop = prop.slice(0, -suffix.length)        // use the base property name without the suffix

        // fetch ALL repeated values of `prop` from __data, ancestors, imputation etc. (even if plural=false)...
        let values = target._compute_property(prop)

        if (cache) {
            Intercept._cache_value(cache, prop, values.length ? values[0] : Intercept.UNDEFINED)
            Intercept._cache_values(cache, prop + suffix, values)
        }
        return plural ? values : values[0]
    }

    static _cache_value(cache, prop, val) {
        /* Save `value` in cache, but also provide special handling for promises, so that a promise is ultimately replaced with the fulfillment value,
           which may improve performance on subsequent accesses to the property (no need to await it again and again).
         */
        cache.set(prop, val instanceof Promise ? val.then(v => cache.set(prop, v)) : val)
    }
    static _cache_values(cache, prop$, vals) {
        /* Like _cache_value(), but for caching an array of repeated values, some of them possibly being promises. */
        cache.set(prop$, vals.some(v => v instanceof Promise) ? Promise.all(vals).then(vs => cache.set(prop$, vs)) : vals)
    }
}


/**********************************************************************************************************************/

export class WebObject {
    /* Web object. Persisted in the database; has a unique ID; can be exposed on the web at a particular URL. */
    // net object? internet object? active object? live object?

    static SEAL_SEP = '.'

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

    __data                  own properties of this object in their raw form (before imputation etc.), as a Data object created during .load()

    __base                  virtual category: either the __category itself (if 1x present), or a newly created Category object (TODO)
                            that inherits (like from prototypes) from all __category$ listed in this object or inherited

    __schema                schema of this item's data, as a SCHEMA object

    __prototype             direct ancestor (prototype) of this object; there can be multiple __prototype$ for an object
    __ancestors             array of all ancestors, deduplicated and linearized, with `this` at the first position

    __class                 JS class (or its class path) for this item; assigned AFTER object creation during .load()
    __category              category of this item, as a Category object; there can be multiple __category$; they can be inherited from __prototype$
    __container             Container of this item, for canonical URL generation
    __status                a string describing the current state of this object in the DB, e.g., "DRAFT"; undefined means normal state
    __ttl                   time-to-live of this object in the registry [seconds]; 0 = immediate eviction on the next cache purge

    __ident                 (virtual) string identifier of this object inside its __container
    __path                  (virtual) URL path of this object; similar to __url, but contains blanks segments; imputed via _impute_path()
    __url                   (virtual) absolute URL path of this object, calculated via type imputation in _impute_url()

    __assets                cached web Assets of this object's __schema

    */

    set __id(id) {
        let prev = this.__id
        if (prev !== undefined && prev !== id) throw new Error(`object ID is read-only and can't be changed from ${prev} to ${id}`)
        if (id !== undefined) Object.defineProperty(this, '__id', {value: id, writable: false})
    }

    get id() { return this.__id }           // alias for __id

    get __base() {
        let cats = this.__category$
        if (cats?.length > 1) throw new Error(`multiple categories not supported yet`)
        return cats[0]
    }

    get __schema() {
        return this.__category?.__child_schema || new SCHEMA_GENERIC()
    }

    get __proto_versions() { return this.__prototype$.map(proto => proto.__ver || 0) }      // DRAFT

    get __ancestors() {
        // TODO: use C3 algorithm to preserve correct order (MRO, Method Resolution Order) as used in Python:
        // https://en.wikipedia.org/wiki/C3_linearization
        // http://python-history.blogspot.com/2010/06/method-resolution-order.html
        let candidates = this.__prototype$.map(proto => proto.__ancestors)
        return [this, ...unique(concat(candidates))]
    }

    get __assets()  {
        let assets = new Assets()
        this.__schema.collect(assets)
        return assets
    }

    // service         // isomorphic service triggers created for this object from its class's __services; called as this.service.xxx(args) or this.PROTO.xxx(args),
    //                 // where TYPE is GET/POST/LOCAL/... - works both on the client and server (in the latter case, the call executes server function directly without network communication)


    // static compare(obj1, obj2) {
    //     /* Ordering function that can be passed to array.sort() to sort objects from DB by ascending ID. */
    //     return obj1.__id - obj2.__id
    // }


    /***  Internal properties  ***/

    __proxy         // Proxy wrapper around this object created during instantiation and used for caching of computed properties
    __self          // a reference to `this`; for proper caching of computed properties when this object is used as a prototype (e.g., for View objects) and this <> __self during property access

    __meta = {                      // some special properties are grouped here to avoid cluttering the object's interface ...
        mutable:        false,      // if true, object can be edited; the edits are accumulated and committed to DB using .save(); this prop CANNOT be changed after construction; editable objects are excluded from server-side caching
        active:         false,      // set to true after full initialization procedure was completed; implies that full __data is present (newborn or loaded)
        loading:        false,      // promise created at the start of _load() and removed at the end; indicates that the object is currently loading its data from DB
        loaded_at:      undefined,  // timestamp [ms] when the full loading of this object was completed; to detect the most recently loaded copy of the same object
        expire_at:      undefined,  // timestamp [ms] when this item should be evicted from cache; 0 = immediate (i.e., on the next cache purge)
        provisional_id: undefined,  // ID of a newly created object that's not yet saved to DB, or the DB record is incomplete (e.g., the properties are not written yet)
        //pending_url:  undefined,  // promise created at the start of _init_url() and removed at the end; indicates that the object is still computing its URL (after or during load())

        cache:          undefined,  // Map of cached properties: read from __data, imputed, inherited or calculated from getters; ONLY present in immutable object
        edits:          undefined,  // array of edit operations that were reflected in __data so far, for replay on the DB; each edit is a pair: [op, args]

        // db         // the origin database of this item; undefined in newborn items
        // ring       // the origin ring of this item; updates are first sent to this ring and only moved to an outer one if this one is read-only
    }

    edit = {}       // triggers of edit operations: obj.edit.xxx(...args) invokes obj._make_edit('edit.xxx', ...args)

    // GET/POST/LOCAL/... are isomorphic service triggers ({name: trigger_function}) for the object's network endpoints, initialized in _init_services().
    // this.<PROTO>.xxx(...args) call is equivalent to executing .invoke() of the Service object returned by this endpoint's handler function '<PROTO>.xxx'():
    //      this['<PROTO>.xxx']().invoke(this, '<PROTO>.xxx', ...args)
    // If the handler function doesn't return a service object, the corresponding trigger simply returns the handler's return value, whatever it is.

    GET             // triggers for HTTP GET endpoints of this object
    POST            // triggers for HTTP POST endpoints
    LOCAL           // triggers for LOCAL endpoints that only accept requests issued by the same process (no actual networking, similar to "localhost" protocol)
                    // ... Other trigger groups are created automatically for other protocol names.

    static __edits                  // array of edit names ('xyz') for which an edit operator, 'edit.xyz'(), is defined in this class or parent classes; computed in _collect_methods()
    static __handlers               // Map of network handlers defined by this class or parent classes; computed in _collect_methods()
    static _cachable_getters        // Set of names of getters of the WebObject class or its subclass, for caching in Intercept

    static _collect_cachable_getters() {
        /* Find all getter functions in the current class, combine with parent's set of getters and store in _cachable_getters. */
        const prototype = this.prototype
        const parent_getters = Object.getPrototypeOf(this)?.cachable_getters || []
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

    is_newborn()    { return !this.__id }       // object is "newborn" when it hasn't been written to DB yet and has no ID assigned
    is_loaded()     { return this.__data && !this.__meta.loading }  // false if still loading, even if data has already been created but object's not fully initialized (except __url & __path which are allowed to be delayed)
    is_category()   { return false }
    //is_expired()    { return this.__meta.expire_at < Date.now() }

    assert_loaded() { if (!this.is_loaded()) throw new NotLoaded(this) }
    assert_loaded_or_newborn() { if (!this.is_loaded() && !this.is_newborn()) throw new NotLoaded(this) }

    is(other) {
        /* True if `this` and `other` object have the same ID; they still can be two different instances
           AND may contain different data (!), for example, if one of them contains more recent updates than the other.
           If `other` is undefined or any of the objects has a missing ID, they are considered NOT equivalent.
         */
        return this.__id !== undefined && this.__id === other?.__id
    }


    /***  Instantiation  ***/

    constructor(_fail = true, id = null, {mutable = false} = {}) {
        /* For internal use! Always call WebObject.new() or category.create() instead of `new WebObject()`.
           By default, the object is created immutable, and on client (where all modifications are local to the single client process)
           this gets toggled automatically on the first attempt to object modification. On the server
           (where any modifications might spoil other web requests), changing `mutable` after creation is disallowed.
         */
        if(_fail) throw new Error('web objects should be instantiated with CLASS._create() or category.create() instead of new CLASS()')

        if (id) this.__id = id

        this.__self = this              // for proper caching of computed properties when this object is used as a prototype (e.g., for View objects)

        // mutable=true allows edit operations on the object and prevents server-side caching of the object in Registry;
        // only on the client this flag can be changed after object creation
        Object.defineProperty(this.__meta, 'mutable', {value: mutable, writable: CLIENT, configurable: false})

        if (!mutable) this.__meta.cache = new Map()
        if (mutable && !this.is_newborn()) this.__meta.edits = []
    }

    static stub(id = null, opts = {}) {
        /* Create a stub: an empty object with `id` assigned. To load data, load() must be called afterwards. */

        // special case: the root category must have its proper class (RootCategory) assigned right from the beginning for correct initialization
        if (id === ROOT_ID && !this.__is_root_category)
            return RootCategory.stub(id, opts)

        let obj = new this(false, id, opts)
        return obj.__proxy = Intercept.wrap(obj)
    }

    static _create(categories = [], ...args) {
        /* `categories` may contain category objects or object IDs; in the latter case, IDs are converted to stubs. */
        let obj = this.stub(null, {mutable: true})          // newly-created objects are always mutable
        categories = categories.map(cat => typeof cat === 'number' ? schemat.get_object(cat) : cat)
        obj.__data = new Data(...categories.map(cat => ['__category', cat]))
        obj.__create__(...args)
        return obj
    }

    static new(...args) {
        /* Create an empty newborn object, no ID, and execute its __new__(...args). Return the object.
           If __new__() returns a Promise, this method returns a Promise too.
           This method should be used instead of the constructor.
         */
        // if (this.__category === undefined) throw new Error(`static __category must be configured when calling create() through a class not category`)
        return this._create([], ...args)
        // return this.create([this.__category], ...args)
    }

    static async from_json(id, json, {mutable = true, sealed = false} = {}) {
        /* Create a new WebObject instance given an encoded JSON string with the object's content. */
        assert(typeof json === 'string')
        let obj = WebObject.stub(id, {mutable})
        obj.__data = Data.load(json)
        return obj.load({sealed})
    }

    _get_write_id() {
        /* Either __id or __meta.provisional_id. */
        return this.__id !== undefined ? this.__id : this.__meta.provisional_id
    }


    /***  Loading & initialization  ***/

    async load({sealed = true} = {}) {
        /* Load full __data of this object from DB, if not loaded yet. Return this object.
           For a newborn object (__data already present), only perform its *activation* (initialization), no data loading.
           If sealed=true and __seal is present in the object, the exact versions of dependencies (prototypes, categories)
           as indicated by __seal are linked. The data can only be loaded ONCE for a given WebObject instance due to immutability.
           If you want to refresh the data, create a new instance with .reload().
         */
        let {active, loading} = this.__meta

        // data is loaded or being loaded right now? wait for the previous call to complete instead of starting a new one
        if (active || loading) return loading || this

        // keep and return a Promise that will eventually load the data; this is needed to avoid race conditions
        return this.__meta.loading = this._load(sealed)
    }

    async _load(sealed) {
        /* Load this.__data from DB if missing. Initialize this object: set up the class and prototypes, run __init__() etc. */

        schemat.before_data_loading(this)
        let data_loaded = false

        try {
            if (!this.__data) {
                let data_json = await schemat.load_record(this.id)
                this.__data = Data.load(data_json)
                data_loaded = true
            }

            let seal = this.__data.get('__seal')            // if seal is present, replace refs to prototypes/categories with proper versions of these dependency objects
            if (seal && sealed) await this._load_dependencies(seal)

            await this._activate()

            // if (this.is_linked())
            //     this.__meta.pending_url = this._init_url()  // set the URL path of this item; intentionally un-awaited to avoid blocking the load process of dependent objects
            // if (await_url && schemat.site && this.__meta.pending_url)
            //     await this.__meta.pending_url

            let now = Date.now()
            let ttl = (this.__ttl || this.__base?.ttl || 0) * 1000
            this.__meta.loaded_at = now
            this.__meta.expire_at = now + ttl

            if (this.__ver && !this.__meta.mutable) schemat.register_version(this)

            return this

        } catch (ex) {
            if (data_loaded) this.__data = undefined        // on error, clear the data to mark this object as not loaded
            throw ex

        } finally {
            this.__meta.loading = false                     // cleanup to allow another load attempt, even after an error
            schemat.after_data_loading(this)
        }
    }

    async _activate() {
        /* Make sure that dependencies are loaded. Set the JS class of this object. Init internals, call __init__().
           Can be called for both newborn or deserialized (loaded from DB) object.
         */
        let proto = this._load_prototypes()             // load prototypes
        if (proto instanceof Promise) await proto

        let cats = this.__category$.filter(c => !c.is_loaded() && c !== this)   // load categories, if any (none for non-categorized objects)
        if (cats.length) await (cats.length === 1 ? cats[0].load() : Promise.all(cats.map(c => c.load())))

        let container = this.__container
        if (container && !container.is_loaded())
            if (this.__id <= 5) container.load(); else await container.load()   // __container of [Category] and [Container] must not be awaited

        if (this.__status) print(`WARNING: object [${this.id}] has status ${this.__status}`)

        if (this.constructor === WebObject) {           // set the target WebObject subclass if not yet present; stubs only have WebObject as their class, which must be changed when the data is loaded and the item is linked to its category
            let cls = this._load_class()
            if (cls instanceof Promise) cls = await cls
            T.setClass(this, cls || WebObject)
        }

        let init = this.__init__()                      // custom initialization after the data is loaded (optional)
        if (init instanceof Promise) await init

        this._init_edit_triggers()
        this._init_services()

        this.__meta.active = true
        return this
    }

    async _load_dependencies(seal) {
        print(`[${this.id}] _load_dependencies(), seal = ${seal}`)

        let data = this.__data
        let locs = [...data.locs('__prototype'), ...data.locs('__category')]
        let refs = locs.map(i => data.get(i))
        let vers = (seal === WebObject.SEAL_SEP) ? [] : seal.split(WebObject.SEAL_SEP).map(Number)
        if (locs.length !== vers.length) throw new Error(`different size of seal (${seal}) and dependencies [${locs}]`)

        // replace references in `data` with proper versions of objects
        for (let i = 0; i < locs.length; i++) {
            let ref = refs[i], loc = locs[i], ver = vers[i]
            if (ref !== this && (!ref.is_loaded() || ref.__ver !== ver))
                data.set(loc, await schemat.get_version(ref.__id, ver))
        }
    }

    _load_prototypes() {
        /* Load all Schemat prototypes of this object. */
        let opts = {} //await_url: false}                                   // during boot up, URLs are not awaited to avoid circular dependencies (see category.load(...) inside _load())
        let prototypes = this.__prototype$.filter(p => !p.is_loaded())
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
        return schemat.reload(this.id)
    }


    /***  URLs and URL paths  ***/

    get system_url() {
        /* The internal URL of this object, typically /$/id/<ID> */
        return schemat.site.default_path_of(this)
    }

    _impute__path() {
        /* Calculation of __path if missing. */
        return this.__container?.get_access_path(this) || this.system_url
    }

    _impute__url() {
        /* Calculation of __url if missing: same as __path but with blank routes (*ROUTE) removed. */
        return this.__path.replace(/\/\*[^/]*/g, '')
        // let [url, on_blank_route] = WebObject._decode_access_path(this.__path)
        // if (on_blank_route)                                         // if any of the ancestor containers has the same URL, use the system URL instead for this object
        //     for (let parent = this.__container; parent; parent = parent.__container)
        //         if (url === parent.__url) return this.system_url
        // return url
    }

    _impute__ident() {
        return this.__container?.identify(this)
    }

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
    //
    //     delete this.__meta.pending_url
    //     return this.__url                                           // invokes calculation of __path and __url via impute functions
    // }
    //
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
        // 1) __prototype: because it is used at an early stage of loading (_load_prototypes()), before the object's category (and schema) is fully loaded;
        // 2) __category: because the schema is not yet available and reading the type from __schema would create circular dependency.

        let type =
            prop === '__category'  ? new REF() :
            prop === '__prototype' ? new REF({inherit: false}) :
                                     proxy.__schema.get(prop)

        if (!type) return []

        // if the property is atomic (non-repeated and non-compound) and an own value is present, skip inheritance to speed up
        if (!type.isRepeated() && !type.isCATALOG() && data.has(prop)) {
            let values = data.getAll(prop)
            if (values.length > 1) print(`WARNING: multiple values present for a property declared as unique (${prop} in [${this.id}]), using the first value only`)
            return [values[0]]  //[data.get(prop)]
        }

        let {inherit, virtual} = type.options
        let ancestors = inherit && !virtual ? proxy.__ancestors : [proxy]               // `this` included as the first ancestor
        let streams = virtual ? [] : ancestors.map(proto => proto._own_values(prop))    // for virtual property, __data[prop] is not used even if present

        // read `defaults` from the category and combine them with the `streams`
        if (prop !== '__prototype' && prop !== '__category')                // avoid circular dependency for these special props
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
        if (this.is(parent)) return true
        for (const proto of this.__prototype$)
            if (proto.inherits_from(parent)) return true
        return false
    }

    self_encode() {
        /* Encode this object's content into plain-object form and return as {id, data}, where `data` is encoded through JSONx.
           Encoded objects can be combined into larger structures for transfer or storage, and then serialized altogether
           with a single call to the standard JSON.stringify() - which would be inefficient if JSON-stringified representations
           of each object were used, because this would lead to *double* stringification.
         */
        if (this.id === undefined) throw new Error(`trying to encode a newborn object (no ID)`)
        if (!this.__data) throw new Error(`trying to encode a stub object (no __data)`)
        return {id: this.id, data: this.__data.encode()}
    }
    // self_stringify() { return JSON.stringify(this.self_encode()) }

    dump_data() {
        /* Encode and stringify this.__data through JSONx. Return a string. Nested values are recursively encoded. */
        return this.__data.dump()
    }

    validate(post_setup = true) {
        // TODO SECURITY: make sure that __data does NOT contain special props: __meta, __self, __proxy, __id etc!

        let data = this.__data

        // validate each individual property in __data ... values in __data entries may get modified (!)

        for (let loc = 0; loc < data.length; loc++) {
            let entry = data._entries[loc]
            let prop = entry.key
            let type = this.__schema.get(prop)

            if (!type)                                      // the property `prop` is not present in the schema? skip or raise an error
                if (this.__category.allow_custom_fields) continue
                else throw new ValidationError(`unknown property: ${prop}`)

            if (!type.options.repeated) {                   // check that a single-valued property has no repetitions
                let count = data.getAll(prop).length
                if (count > 1) throw new ValidationError(`found multiple occurrences of a property declared as single-valued (${prop})`)
            }

            let newval = type.validate(entry.value)         // may raise an exception
            if (post_setup) entry.value = newval
        }

        // check multi-field constraints ...

        // run category-specific validation
        this.__validate__(post_setup)
    }


    /***  Hooks  ***/

    __create__(data) {
        /* Initialize own properties (__data) of this newborn object before its insertion to DB or transfer to the server.
           The JS class and `__category` property are already configured; this.__data is created.
           The default implementation just updates the entire __data using the first argument.
           Subclasses may override this method to change this behavior and accept a different list of arguments.
           This method must be synchronous. Any async code should be placed in __init__() or __setup__().
         */
        if (T.isPOJO(data) || data instanceof Catalog) this.__data.updateAll(data)
    }

    __init__() {}
        /* Optional item-specific initialization after this.__data is created (in a newborn object), or loaded from DB. Can be async in subclasses. */

    __setup__(id) {}
        /* One-time global setup after this object was created (on client or server) AND is pending insertion to DB (on server),
           BUT already has a provisional ID assigned (`id`). Typically, this method may insert related sub-objects.
           Can be declared async in subclasses or return a Promise.
         */

    __destroy__() {}
        /* Custom tear down that is executed once before this object is permanently deleted from the database. */

    __done__() {}
        /* Custom clean up to be executed after the item was evicted from the registry cache. Can be async. */

    __validate__(post_setup = true) {}
        /* Validate this object's own properties during update/insert. Called *after* validation of individual values through their schema. */


    /***  Networking  ***/

    static _collect_methods(protocols = ['GET', 'POST', 'LOCAL'], SEP = '.') {
        /* Collect all special methods of this class: web handlers + edit operators. */
        let is_endpoint = prop => protocols.some(p => prop.startsWith(p + SEP))
        let is_editfunc = prop => prop.startsWith('edit' + SEP)

        let proto = this.prototype
        let props = T.getAllPropertyNames(proto)

        let handlers = props.filter(is_endpoint).filter(name => proto[name]).map(name => [name, proto[name]])
        this.__handlers = new Map(handlers)

        this.__edits = props.filter(is_editfunc).filter(name => proto[name]).map(name => name.slice(5))
    }

    _init_services(SEP = '.') {
        /* For each endpoint of the form "PROTO.name" create a trigger method, "name(...args)",
           that executes a given handler (client- or server-side) and, if the result is a Service instance,
           calls its .client() or .server() depending on the current environment.
         */
        if (!this.constructor.prototype.hasOwnProperty('__handlers')) this.constructor._collect_methods()
        let self = this.__self

        for (let [endpoint, handler] of this.constructor.__handlers.entries()) {
            let [protocol, name] = endpoint.split(SEP)

            self[protocol] ??= Object.create(null)
            if (self[protocol][name]) throw new Error(`service at this endpoint already exists (${endpoint}) in [${this.id}]`)

            self[protocol][name] = (...args) => {
                let result = handler.call(this)
                return result instanceof Service ? result.invoke(this, endpoint, ...args) : result
            }
        }
    }

    _init_edit_triggers(SEP = '.') {
        /* Create this.edit.*() edit triggers. Done once per object during activation. */
        if (!this.constructor.prototype.hasOwnProperty('__edits')) this.constructor._collect_methods()
        let edit = this.__self.edit = {}

        for (let name of this.constructor.__edits)
            edit[name] = (...args) => this._make_edit(name, ...args)
    }

    async handle(request, SEP = '.') {
        /* Serve a web or internal Request by executing the corresponding service from this.net.
           Query parameters are passed in `req.query`, as:
           - a string if there's one occurrence of PARAM in a query string,
           - an array [val1, val2, ...] if PARAM occurs multiple times.
        */
        assert(this.is_loaded)
        request.target = this

        // convert endpoint names to full protocol-qualified endpoints: GET.name
        let names = this._get_endpoints(request)
        let endpoints = names.map(e => `${request.protocol}${SEP}${e}`)

        // find the first endpoint that matches this request and launch its handler
        for (let endpoint of endpoints) {
            let handler = this._get_handler(endpoint)
            if (!handler) continue

            // print(`handle() endpoint: ${endpoint}`)
            request.endpoint = endpoint
            let result = handler.call(this, request)

            if (result instanceof Promise) result = await result
            if (result instanceof Service) result = result.handle(this, request)
            if (typeof result === 'function') result = result.call(this, request)

            return result
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
        let glob_defaults = {GET: ['view', 'admin', 'inspect'], LOCAL: ['self']}
        let catg_defaults = this.__base?.default_endpoints.getAll(protocol)
        let defaults = catg_defaults || glob_defaults[protocol]
        if (defaults.length) return defaults

        request.throwNotFound(`endpoint not specified (protocol ${protocol})`)
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


    /***  Database operations on self  ***/

    delete() {
        /* Delete this object from the database. */
        return schemat.site.POST.delete_object(this.__id)
    }

    _bump_version() {
        /* Set or increment __ver number, if already present or category's `set_version` is true. */
        if (this.__ver || this.__base.set_version) {
            //return this.__data.delete('__ver')
            let ver = this.__ver || 0
            this.__data.set('__ver', ver + 1)
        }
    }

    async _create_revision(data) {
        /* Create a new Revision to preserve an old `data` snapshot (JSON string) and link to it via __prev property. */
        assert(SERVER)
        assert(typeof data === 'string')

        let Revision = await schemat.import('/$/sys/Revision')
        let rev = await Revision.create({data, target: this})
        await rev.save()
        this.__data.set('__prev', rev)
    }

    _seal_dependencies() {
        /* Recalculate the __seal property as a string "v1.v2.v3..." of concatenated version numbers of all dependencies: prototypes + categories. */
        let data = this.__data
        if (!this.__base.seal_dependencies) return data.delete('__seal')
        if (!this.__ver) throw new Error(`cannot seal dependencies of [${this.id}], __ver of the object is missing`)

        // inherited categories are excluded from `deps`: they are already included in the seals of prototypes where they were originally declared
        let deps = [...data.getAll('__prototype'), ...data.getAll('__category')]

        for (let dep of deps) {
            assert(dep.is_loaded())
            if (!dep.__ver) throw new Error(`cannot seal dependencies of [${this.id}], __ver of the dependency [${dep.id}] is missing`)
            if (!dep.__seal) throw new Error(`cannot seal dependencies of [${this.id}], __seal of the dependency [${dep.id}] is missing`)
        }

        let sep  = WebObject.SEAL_SEP
        let vers = deps.map(d => d.__ver)
        let seal = vers.join(sep) || sep            // seal is always non-empty, even when no dependencies ('.')

        data.set('__seal', seal)
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

    async move_to(directory) {
        return this.POST.move_to(directory)
    }


    /***  Object editing  ***/

    async get_mutable() {
        /* Create a fully-loaded, but mutable, instance of this web object. The object is recreated from scratch,
           so it may have different (newer) content than `this`. */
        return schemat.get_mutable(this)
    }

    _make_mutable() {
        /* Make itself mutable. This removes the property cache, so read access becomes less efficient. Only allowed on client. */
        assert(CLIENT && !this.__meta.mutable)
        delete this.__meta.cache
        this.__meta.edits = []
        this.__meta.mutable = true
    }

    _make_edit(op, ...args) {
        /* Perform an edit locally on the caller and append to __meta.edits so it can be submitted to the DB with save(). Return `this`. */
        if (!this.__meta.mutable)
            if (SERVER) throw new Error(`cannot apply edit operation ('${op}') to immutable object [${this.id}]`)
            else this._make_mutable()       // on client, an immutable object becomes mutable on the first modification attempt

        let edit = [op, ...args]
        this.apply_edits(edit)
        this.__meta.edits?.push(edit)       // `edits` does not exist in newborn objects, so `edit` is not recorded then, but is still applied to __data
        return this
    }

    apply_edits(...edits) {
        /* Apply `edits` to the __data. Each `edit` is an array: [op-name, ...args]. */
        for (const edit of edits) {
            let [op, ...args] = edit
            let func = this[`edit.${op}`]
            if (!func) throw new Error(`object does not support edit operation: '${op}'`)
            func.call(this, ...args)
            // this[method](JSONx.deepcopy(args))      // `args` are deep-copied for safety, in case they get modified during the edit
        }
    }

    save() {
        /* Send __meta.edits (for an existing object), or __data (for a newly created object) to DB.
           In the latter case, the newly assigned ID is returned. May return a Promise.
         */
        this.assert_loaded_or_newborn()
        let edits = this.__meta.edits

        if (this.is_newborn())
            return schemat.site.POST.create_object(this.__data).then(({id}) => (this.__id = id))

        if (!edits?.length) return //throw new Error(`no edits to be submitted for ${this.id}`)

        let submit = schemat.site.POST.submit_edits(this.id, ...edits) //.then(() => this)
        edits.length = 0
        return submit
    }


    // specialized edits for UI with immediate commit ...

    edit_insert(path, entry)        { return this.edit.insert({path, ...entry}).save() }
    edit_delete(path)               { return this.edit.delete({path}).save() }
    edit_update(path, entry)        { return this.edit.update({path, ...entry}).save() }
    edit_move(path, delta)          { return this.edit.move({path, delta}).save() }


    /***  Individual edits. Should be called via this.edit.*()  ***/

    /***  "Edits" are methods that manipulate directly on the object's __data. Typically, they're first applied temporarily
          on the client; recorded in __meta.edits; then replayed on the server to do the permanent update in the database.
          New edit methods can be added in subclasses. They must be synchronous.
          They must NOT modify their arguments, because the same args may need to be sent later from client to DB.
     ***/

    'edit.if_version'(ver) {
        /* Only apply the remaining edits if this.__ver=ver. */
        if (this.__ver !== ver) throw new Error(`object has changed`)
    }

    'edit.overwrite'(data) {
        /* Replace the entire set of own properties, __data, with a new Data object. */
        if (typeof data === 'string') data = Data.load(data)
        assert(data instanceof Data)
        this.__data = data
    }

    'edit.insert'({path, key, value}) {
        /* Insert a new property; or a new field inside a nested Catalog in an existing property. */
        let pos = (path = [...path]).pop()
        this.__data.insert(path, pos, {key, value})
    }

    'edit.delete'({path}) {
        /* Delete a property; or a field inside a nested Catalog in a property. */
        this.__data.delete(path)
    }

    'edit.update'({path, key, value}) {
        /* Update a property; or a field inside a nested Catalog. */
        this.__data.update(path, {key, value})
    }

    'edit.move'({path, delta}) {
        /* Move a property or a field inside a nested Catalog. */
        let pos = (path = [...path]).pop()
        this.__data.move(path, pos, pos + delta)
    }


    'edit.set_value'(prop, value) {
        this.__data.set(prop, value)
    }

    'edit.set_values'(prop, values) {
        /* Set multiple (repeated) values for a given property, remove the existing ones. */
        this.__data.setAll(prop, ...values)
    }


    /***  Endpoints  ***/

    /* Handlers, below, take `request` (Request instance) as the only argument. However, when a handler is called via its
       trigger function (this.GET.xxx(), this.POST.xxx() etc.), `request` is left undefined. Handler may either:
       - return the web response (a string); or
       - send the response by itself via `request.res`; or
       - return a function, f(request), that will render the response; or
       - return a Service instance that (on server) provides generation of response, and (on client) can invoke the service remotely.
     */

    'GET.test_txt'()        { return "TEST txt ..." }                   // works
    'GET.test_fun'()        { return () => "TEST function ..." }        // works
    'GET.test_res'({res})   { res.send("TEST res.send() ...") }         // works
    'GET.test_html'()       { return html_page(import.meta.resolve('../test/views/page_02.html')) }

    'GET.json'({res})       { res.json(this.self_encode()) }
    'GET.inspect'()         { return new ReactPage(ItemInspectView) }

    'LOCAL.self'()          { return this }

    // inspect()         { return react_page(ItemInspectView) }
    // inspect()         { return ItemInspectView.page(this) }
    // inspect()         { return ItemInspectView.page }

    'POST.move_to'() {
        /* Move this object from its current __container to `directory`, which must be a Directory object, or its URL.
           Returns an array of objects affected: the current object, the target directory, and the previous container.
         */
        return new JsonPOST({
            async server(directory, overwrite = false)
            {
                if (typeof directory === 'number') directory = await schemat.get_loaded(directory)
                else if (typeof directory === 'string') directory = await schemat.import(directory)
                // TODO: check that `directory` is a Directory

                let [obj, src, dir] = await schemat.get_mutable(this, this.__container, directory)
                let ident = this.__ident || this.name || `${this.id}`

                if (!overwrite && dir.has_entry(ident)) throw new Error(`entry '${ident}' already exists in the target directory (${dir})`)

                obj.__container = dir
                dir.edit.set_entry(ident, this)

                if (src?.has_entry(this.__ident, obj))
                    src.edit.del_entry(this.__ident)

                return schemat.save_reload(dir, obj, src)
            },
            output: mWebObjects,
        })
    }


    /***  Dynamic loading of source code  ***/

    // parseClass(base = WebObject) {
    //     /* Concatenate all the relevant `code_*` and `code` snippets of this item into a class body string,
    //        and dynamically parse them into a new class object - a subclass of `base` or the base class identified
    //        by the `class` property. Return the base if no code snippets found. Inherited snippets are included in parsing.
    //      */
    //     let name = this.get('_boot_class')
    //     if (name) base = schemat.get_builtin(name)
    //
    //     let body = this.route_local(('class')           // full class body from concatenated `code` and `code_*` snippets
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
    //     let domain   = WebObject.CODE_DOMAIN
    //     let cat_name = clean(this.get('name'))
    //     let fil_name = `${cat_name}_${this.id_str}`
    //     return `${domain}:///items/${fil_name}/${path}`
    //     // return `\n//# sourceURL=${url}`
    // }
}


