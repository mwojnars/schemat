/**********************************************************************************************************************
 *
 *  Main class of Schemat's Web Object model.
 *
 *  @author Marcin Wojnarski
 *
 */

import {ROOT_ID, PLURAL, SUBFIELD} from '../common/globals.js'
import {print, assert, T, escape_html, concat, unique, sleep} from '../common/utils.js'
import {NotLoaded, URLNotFound, ValidationError} from '../common/errors.js'

import {Catalog, Struct} from './catalog.js'
import {REF} from "../types/type.js"
import {SCHEMA_GENERIC} from "../types/catalog_type.js"
import {html_page} from "../web/adapters.js"
import {Assets} from "../web/component.js"
import {WebRequest} from "../web/request.js"
import {ReactPage, ItemInspectView} from "../web/pages.js"
import {JsonPOST, Service} from "../web/services.js";
import {mWebObjects} from "../web/messages.js";

let RootCategory

// due to circular dependency between object.js and category.js, RootCategory must be imported with dynamic import() and NOT awaited:
import("./category.js").then(module => {RootCategory = module.RootCategory})

// shared immutable array, used in WebObject's property cache to avoid keeping separate arrays of dozens of empty .xyz$ plural attributes across multiple objects
const _EMPTY_ARRAY = Object.freeze([])

// // AsyncFunction class is needed for parsing from-DB source code
// const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor


/**********************************************************************************************************************
 **
 **  PROXY
 **
 */

class Intercept {
    /* A Proxy wrapper for all kinds of web objects: stubs, newborns, or loaded from DB.
       Makes loaded properties accessible with the `obj.prop` syntax, on top of plain JS attributes.
       Performs caching of computed properties in target.__meta.cache. Ensures immutability of regular properties.
       Since a Proxy class can't be subclassed, all methods and properties of Intercept are static.
     */

    // these special props are always read from regular POJO attributes and NEVER from object's __data;
    // many calls ask for `then` because when a promise resolves, .then is checked for another chained promise;
    // defining a custom `then` prop is unsafe, hence we disallow it
    static SPECIAL = ['then', '__id', '__meta', '__data', '__self']

    // UNDEFINED token marks that the value has already been fully computed, with inheritance and imputation,
    // and still remained undefined, so it should *not* be computed again
    static UNDEFINED    = Symbol.for('Intercept.UNDEFINED')
    static NO_CACHING   = Symbol.for('Intercept.NO_CACHING')   // marks a wrapper around a value (typically from a getter) that should not be cached


    static wrap(target) {
        /* Create a Proxy wrapper around `target` object. */
        return new Proxy(target, {get: this.proxy_get, set: this.proxy_set, deleteProperty: this.proxy_delete})
    }

    static proxy_get(target, prop, receiver, deep = true)
    {
        // special handling for multi-segment paths (a.b.c...)
        if (deep && prop?.includes?.(SUBFIELD))
            return Intercept._get_deep(target, prop, receiver)

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

        let [base, plural] = Intercept._check_plural(prop)      // property name without the $ suffix

        // fetch ALL repeated values of `prop` from __data, ancestors, imputation etc. (even if plural=false)...
        let values = target._compute_property(base)

        if (cache) {
            Intercept._cache_value(cache, base, values.length ? values[0] : Intercept.UNDEFINED)
            Intercept._cache_values(cache, base + PLURAL, values)
        }
        return plural ? values : values[0]
    }

    static _check_plural(prop) {
        let plural = prop.endsWith(PLURAL)
        let base = plural ? prop.slice(0, -1) : prop    // property name without the $ suffix
        return [base, plural]
    }

    static _get_deep(target, path, receiver) {
        /* Get a *deep* property value from `target` object; `path` is a multi-segment path (a.b.c...),
           optionally terminated with $ (plural path). */
        let [base, plural] = Intercept._check_plural(path)
        let [step, ...rest] = base.split(SUBFIELD)
        if (plural) {
            let roots = Intercept.proxy_get(target, step + PLURAL, receiver, false) || []
            return roots.flatMap(root => [...Struct.yieldAll(root, rest)])
        }
        let root = Intercept.proxy_get(target, step, receiver, false)
        return Struct.get(root, rest)
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

    static proxy_set(target, path, value, receiver)
    {
        // special attributes are written directly to __self (outside __data, not sent to DB);
        // also, when the __data is not loaded yet, *every* write goes to __self
        if (!(target.is_newborn() || target.is_loaded())
            || typeof path !== 'string'                         // `path` can be a symbol like [Symbol.toPrimitive]
            || Intercept.SPECIAL.includes(path)
        ) return Reflect.set(target, path, value, receiver)

        let [base, plural] = Intercept._check_plural(path)      // property name without the $ suffix
        let [prop] = base.split(SUBFIELD)                       // first segment of a deep path

        // `_xyz` props are treated as "internal" and can be written to __self (if not *explicitly* declared in schema) OR to __data;
        // others, including `__xyz`, are "regular" and can only be written to __data, never to __self
        let regular = (path[0] !== '_' || path.startsWith('__'))
        let schema = receiver.__schema              // using `receiver` not `target` because __schema is a cached property and receiver is the proxy wrapper here
        let type = schema?.get(prop)                // can be GENERIC for a field that's NOT explicitly declared in schema

        // write value in __data only IF the `path` is in schema, or the schema is missing (or non-strict) AND the path name is regular
        if (schema?.has(prop) || (!schema?.options.strict && regular)) {
            // if (!target.is_newborn()) print('proxy_set updating:', path)
            let {alias, getter} = type.options

            if (alias) return receiver[path.replace(prop, alias)] = value
            // if (getter) throw new Error(`cannot modify a getter property (${prop})`)

            if (plural) {
                if (!(value instanceof Array)) throw new Error(`array expected when assigning to a plural property (${path})`)
                target._make_edit('set', base, ...value)
            }
            else target._make_edit('set', path, value)
            return true
        }
        else if (regular) throw new Error(`property not in object schema (${prop})`)

        // print('proxy_set() internal:', path, '/', mutable)
        return Reflect.set(target, path, value, receiver)
    }

    static proxy_delete(target, prop) {
        throw new Error('not implemented')
        // return Reflect.deleteProperty(target, prop)
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

    /***  Special properties:

    (some of the props below have getters defined, so they must be commented out not to mask the getters)

    __id                    database ID of the object, globally unique; undefined in a newly created item; must never be changed for an existing item;
                            it is assumed that if __id exists, the object is ALREADY stored in the DB; for newly-created objects,
                            __provisional_id is used instead to keep a temporary ID of a batch of interconnected objects being saved to DB

    __provisional_id        temporary ID (1,2,3...) of a newly-created object not yet saved to DB; only used to differentiate the object
                            in a batch of interconnected objects that are being inserted to DB altogether

    __ring                  Ring instance that represents the ring where this object was retrieved from; stub or loaded
    __block                 Block instance that represents the physical data block where this object was retrieved from; stub or loaded
    __json_source           if __data was parsed from a JSON string, __json_source holds this string for future reference

    __data                  own properties of this object in their raw form (before imputation etc.), as a Catalog object created during .load()
    __object                JS object representation of __data, NOT encoded; for repeated fields, only the first value is included; may still contain nested Catalogs

    __base                  virtual category: either the __category itself (if 1x present), or a newly created Category object (TODO)
                            that inherits (like from prototypes) from all __category$ listed in this object or inherited

    __schema                schema of this item's data, as a SCHEMA object

    __prototype             direct ancestor (prototype) of this object; there can be multiple __prototype$ for an object
    __ancestors             array of all ancestors, deduplicated and linearized, with `this` at the first position

    __class                 JS class (or its class path) for this item; assigned AFTER object creation during .load()
    __category              category of this item, as a Category object; there can be multiple __category$; they can be inherited from __prototype$
    __container             Container of this item, for canonical URL generation
    __status                a string describing the current state of this object in the DB, e.g., "DELETED"; undefined means normal state

    __ttl                   time-to-live of this object in the registry, in seconds; 0 = immediate eviction on the next cache purge
    __ttl_ms                same as __ttl, but in milliseconds

    __ident                 (virtual) string identifier of this object inside its __container
    __path                  (virtual) URL path of this object; similar to __url, but contains blanks segments; imputed via _impute_path()
    __url                   (virtual) absolute URL path of this object, calculated via __url() getter

    __assets                cached web Assets of this object's __schema

    __record                JSONx-encoded representation of this object as {id, data}, where `data` is this.__flat
    __flat                  JSONx-encoded representation of this object's __data, where custom classes are replaced using {@:...} notation; suitable for JSON.stringify()
    __json                  stringified representation of this object's __data; can be passed to Catalog.load() to recreate the original __data structure

    __refresh               struct of the form {json, loaded_at} containing a newer version of this object's record, for use in .refresh()
    */

    set __id(id) {
        let prev = this.__id
        if (prev !== undefined && prev !== id) throw new Error(`object ID is read-only and can't be changed from ${prev} to ${id}`)
        if (id !== undefined) Object.defineProperty(this, '__id', {value: id, writable: false})
    }

    get id() { return this.__id }           // alias for __id

    get __cid()  { return this.__category?.id }
    get __cid$() { return this.__category$.map(c => c.id) }

    get __base() {
        let cats = this.__category$
        if (cats?.length > 1) throw new Error(`multiple categories not supported yet`)
        return cats[0]
    }

    get __schema() {
        return this.__category?.__child_schema || new SCHEMA_GENERIC()
               // new SCHEMA_GENERIC({fields: schemat.root_category['defaults.schema']?.object() || {}})
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

    get __object() { return this.__data.object() }

    get __record() {
        /* JSONx-encoded {id, data} representation of this object. NOT stringified.
           Stringification can be done through plain JSON in the next step. */
        if (!this.id) throw new Error(`cannot create a record for a newly created object (no ID)`)
        if (!this.__data) throw new Error(`cannot create a record for a stub object (no __data)`)
        return {id: this.id, data: this.__flat}
    }

    get __flat()   { return this.__data.encode() }
    get __json()   { return JSON.stringify(this.__flat) }

    get __references() {       // find_references()
        /* Array of all WebObjects referenced from this one. */
        let refs = []
        Struct.collect(this.__data, obj => {if (obj instanceof WebObject) refs.push(obj)})
        // JSONx.encode(this.__data, val => {if (val instanceof WebObject) { refs.push(val); return null; }})
        return refs
    }

    _impute__ttl() {
        /* Impute this object's __ttl (cache TTL in seconds), if missing. */
        if (!this.__ring) return 0      // if loaded from a bootstrap ring, schedule this object for immediate reload
        return this.__base?.cache_timeout || 0
    }

    get _ttl_ms() { return this.__ttl * 1000 }

    __ttl_left() {
        /* Remaining time between now and __meta.expire_at, in seconds. Returns a different value on each call, that's why it's not a getter. */
        return ((this.__meta.expire_at || 0) - Date.now()) / 1000
    }

    // get __infant_references() {
    //     /* Array of all newborn WebObjects referenced from this one. */
    //     let refs = []
    //     Struct.collect(this.__data, obj => {if (obj instanceof WebObject && obj.is_newborn()) refs.push(obj)})
    //     return refs
    // }


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
        expire_at:      undefined,  // timestamp [ms] when this object should be evicted from cache; 0 = immediate (i.e., on the next cache purge)
        // accessed_at:    undefined,  // the most recent timestamp [ms] when this object (if fully loaded) was requested from the Registry via schemat.get_object/get_loaded() or .refresh()

        cache:          undefined,  // Map of cached properties: read from __data, imputed, inherited or calculated from getters; ONLY present in immutable object
        edits:          undefined,  // array of edit operations that were reflected in __data so far, for replay on the DB; each edit is a pair: [op, args]
    }

    // GET/POST/LOCAL/... are isomorphic service triggers ({name: trigger_function}) for the object's network communication endpoints, initialized in _init_services().
    // this.<PROTO>.xxx(...args) call is equivalent to executing .invoke() of the Service object returned by this endpoint's handler function '<PROTO>.xxx'():
    //      this['<PROTO>.xxx']().invoke(this, '<PROTO>.xxx', ...args)
    // If the handler function doesn't return a service object, the corresponding trigger simply returns the handler's return value, whatever it is.

    GET             // triggers for HTTP GET endpoints of this object
    POST            // triggers for HTTP POST endpoints
    LOCAL           // triggers for LOCAL endpoints that only accept requests issued by the same process (no actual networking, similar to "localhost" protocol)
                    // ... Other trigger groups are created automatically for other protocol names.

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

    is_newborn()    { return !this.__id }       // object is a "newborn" when it hasn't been saved to DB yet, so it has no ID assigned
    is_loaded()     { return this.__data && !this.__meta.loading }  // false if still loading, even if data has already been created but object's not fully initialized (except __url & __path which are allowed to be delayed)
    is_mutable()    { return this.__meta.mutable }
    is_category()   { return false }
    //is_expired()    { return this.__meta.expire_at < Date.now() }

    assert_loaded() { if (!this.is_loaded()) throw new NotLoaded(this) }
    assert_active() { if (!this.is_loaded() && !this.is_newborn()) throw new NotLoaded(this) }

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

    static newborn(data = null, opts = {}) {
        /* Create a newborn object (not yet in DB): a mutable object with __data but no ID.
           Optionally, initialize its __data with `data`, but NO other initialization is done. */
        let obj = this.stub(null, {mutable: true, ...opts})
        obj.__data = new Catalog(data)
        return obj
    }

    static _new(categories = [], ...args) {
        /* `categories` may contain category objects or object IDs; in the latter case, IDs are converted to stubs. */
        let obj = this.newborn()
        categories = categories.map(cat => typeof cat === 'number' ? schemat.get_object(cat) : cat) || []
        
        let set_categories = () => {
            categories.forEach(cat => obj.__data.append('__category', cat))
            return obj
        }
        let ret = obj.__new__(...args)
        return ret instanceof Promise ? ret.then(set_categories) : set_categories()

        // obj.__data = new Catalog(categories.map(cat => ['__category', cat]))
        // let ret = obj.__new__(...args)
        // return ret instanceof Promise ? ret.then(() => obj) : obj
    }

    static new(...args) {
        /* Create an empty newborn object, no ID, and execute its __new__(...args). Return the object.
           If __new__() returns a Promise, this method returns a Promise too. Used instead of the constructor.
         */
        // if (this.__category === undefined) throw new Error(`static __category must be configured when calling create() through a class not category`)
        return this._new([], ...args)
    }

    static async from_data(id, data, {mutable = false, sealed = true, activate = true} = {}) {
        /* Create a new WebObject instance given the `data` with the object's content (a Catalog or encoded JSON string). */
        // assert(typeof data === 'string' || data instanceof Catalog)
        let obj = WebObject.stub(id, {mutable})
        obj._set_data(data)
        return obj.load({sealed, activate})
    }


    /***  Loading & initialization  ***/

    async load(opts = {}) {
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
        this.__meta.loading = loading = this._load(opts)

        let id = this.id
        if (id && schemat.registry.get_object(id) === this)
            schemat._loading.set(id, loading.then(() => {schemat._loading.delete(id); return this}))

        return loading
    }

    async _load({sealed = true, activate = true} = {}) {
        /* Load this.__data from DB if missing. Initialize this object: set up the class and prototypes, run __init__() etc. */

        schemat.before_data_loading(this)
        let data_loaded = false

        try {
            if (!this.__data) {
                let rec = schemat.load_record(this.id)
                if (rec instanceof Promise) rec = await rec
                let {json, loaded_at} = rec
                this._set_data(json, loaded_at)
                data_loaded = true
            }

            await this._initialize(sealed)
            if (!activate) return this                      // activation involves both __init__() and _activate(); none of these is executed when activate=false

            let init = this.__init__()                      // custom initialization after the data is loaded (optional)
            if (init instanceof Promise) await init

            this._activate()
            return this

        } catch (ex) {
            if (data_loaded) this.__data = undefined        // on error, clear the data to mark this object as not loaded
            throw ex

        } finally {
            this.__meta.loading = false                     // cleanup to allow another load attempt, even after an error
            schemat.after_data_loading(this)
        }
    }

    _set_data(data, loaded_at = Date.now()) {
        /* Create this.__data using content from `data`. Set related special fields. Extract & drop the temporary data.__meta.
           `data` can be a JSON string, or a Catalog, or a Catalog's state object.
         */
        let self = this.__self
        let json, meta

        if (typeof data === 'string') {
            json = data
            data = Catalog.load(json)
        }
        else if (!(data instanceof Catalog))
            data = Catalog.__setstate__(data)

        if (json) self.__json_source = json

        if ((meta = data.get('__meta'))) {
            // print(`[${this.id}] data.__meta:`, data.get('__meta'))
            let {ring, block} = meta
            if (ring) self.__ring = schemat.get_object(ring)
            if (block) self.__block = schemat.get_object(block)
            data.delete('__meta')
        }
        self.__data = data
        self.__meta.loaded_at = loaded_at
    }

    async _initialize(sealed) {
        /* Initialize dependencies and set the JS class of this object. */

        if (sealed) {                                   // if __seal is present, replace refs to prototypes/categories with proper versions of these dependency objects
            let seal = this.__data.get('__seal')
            if (seal) await this._sync_dependencies(seal)
        }

        let proto = this._load_prototypes()             // load prototypes
        if (proto instanceof Promise) await proto

        let cats = this.__category$.filter(c => !c.is_loaded() && c !== this)   // load categories, if any (none for non-categorized objects)
        if (cats.length) await (cats.length === 1 ? cats[0].load() : Promise.all(cats.map(c => c.load())))

        let container = this.__container
        if (container && !container.is_loaded())
            await container.load()          // [Category], [Container], [Directory] have no __container set up despite being placed in /$/sys just to avoid deadlocks here!
            // if (this.__id <= 5) container.load(); else await container.load()   // __container of [Container] must not be awaited

        if (this.__status) print(`WARNING: object [${this.id}] has status ${this.__status}`)

        if (this.constructor === WebObject) {           // set the target WebObject subclass if not yet present; stubs only have WebObject as their class, which must be changed when the data is loaded and the item is linked to its category
            let cls = this._load_class()
            if (cls instanceof Promise) cls = await cls
            T.setClass(this, cls || WebObject)
        }
    }

    async _sync_dependencies(seal) {
        /* When sealing of dependencies is used, make sure that proper versions of dependency objects are linked in __data. */

        print(`[${this.id}] _sync_dependencies(), seal = ${seal}`)

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

    _activate() {
        /* Make the object fully operational by initializing edit operations and network services.
           Configure expiration time and put the object in the Registry.
         */
        this._init_services()

        let __meta = this.__meta
        __meta.expire_at = __meta.loaded_at + this.__ttl * 1000
        __meta.active = true

        if (this.__ver && !this.__meta.mutable) schemat.register_version(this)
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

    refresh() {
        /* Synchronously return the newest cached version of this (loaded) object from the Registry; or self if this object was evicted from cache.
           Additionally, if a newer version of this object's record exists in the Registry, schedule a re-instantiation
           of this object in a background thread for future use.
         */
        // schemat.prepare(obj)     // schedule a reload of this object in the background for another refresh(); not awaited
        let id = this.id
        let obj = schemat.registry.get_object(id) || this
        let {json} = schemat.get_record(id) || {}

        if (!obj.is_loaded()) obj = this

        // if (id === 1024) {  // DEBUG
        //     let left = obj.__ttl_left()
        //     let get = schemat.registry.get_object(id)
        //     print(`refresh() id=${id} ttl left ${left}, get_object ${get ? 'YES' : 'NO'} loaded ${get?.is_loaded() ? 'YES' : 'NO'}`)
        // }

        if (json && json !== obj.__json_source)     // a newer record is present in the Registry or __refresh? schedule a reload...
            schemat.reload(id)                      // intentionally un-awaited: the reload is done in the background

        // also, schedule a reload if the object's age is more than 80% of its TTL
        else if (obj.__ttl_left() < 0.2 * obj.__ttl)
            schemat.reload(id)

        return obj?.is_loaded() ? obj : this
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
        /* Calculation of __path if missing. Root container must have its path='/' configured in DB, this is the reason why this method cannot be a getter. */
        return this.__container?.get_access_path(this) || this.system_url
    }

    get __url() {
        /* Calculation of __url if missing: same as __path but with blank routes (*ROUTE) removed. */
        return this.__path?.replace(/\/\*[^/]*/g, '') || this.system_url
        // let [url, on_blank_route] = WebObject._decode_access_path(this.__path)
        // if (on_blank_route)                                         // if any of the ancestor containers has the same URL, use the system URL instead for this object
        //     for (let parent = this.__container; parent; parent = parent.__container)
        //         if (url === parent.__url) return this.system_url
        // return url
    }

    get __ident() {
        return this.__container?.identify(this)
    }

    // async _init_url() {
    //     while (!schemat.site) {                                     // wait until the site is created; important for bootstrap objects
    //         await sleep()
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
            return [values[0]]
        }

        let {alias, getter, inherit} = type.options
        if (alias) return this[alias]

        let ancestors = inherit && !getter ? proxy.__ancestors : [proxy]                // `this` included as the first ancestor
        let streams = getter ? [] : ancestors.map(proto => proto._own_values(prop))     // for virtual property, __data[prop] is not used even if present

        // read `defaults` from the category and combine them with the `streams`
        if (prop !== '__prototype' && prop !== '__category')            // avoid circular dependency for these special props
        {
            let category = proxy.__category
            if (this === category?.__self && prop === 'defaults')       // avoid circular dependency for RootCategory
                category = undefined

            let defaults = category?.defaults?.getAll(prop)
            if (defaults?.length) streams.push(defaults)
        }
        // else if (prop === '__category')
        //     streams.push([schemat.Uncategorized])

        let values = type.combine_inherited(streams, proxy, prop)       // impute/getter/default of the `type` are applied here
        return values?.length === 0 ? _EMPTY_ARRAY : values
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

    validate() {
        // TODO SECURITY: make sure that __data does NOT contain special props: __meta, __self, __proxy, __id etc!

        let data = this.__data

        // validate each individual property in __data ... __data._entries may get directly modified (!)

        for (let loc = 0; loc < data.length; loc++) {
            let entry = data._entries[loc]
            let [prop, value] = entry
            let type = this.__schema.get(prop)

            if (!type)                                      // the property `prop` is not present in the schema? skip or raise an error
                if (this.__category.allow_custom_fields) continue
                else throw new ValidationError(`unknown property: ${prop} in object [${this.id}]`)

            if (!type.options.repeated) {                   // check that a single-valued property has no repetitions
                // print(`prop=${prop}:`, type)
                let count = data.getAll(prop).length
                if (count > 1) throw new ValidationError(`found multiple occurrences of a property declared as single-valued (${prop}) in object [${this.id}]`)
            }

            try {
                // if (type.options.getter) throw new ValueError(`"getter" property cannot be stored explicitly`)
                entry[1] = type.validate(value)             // may raise an exception
                // let newval = type.validate(value)
                // if (post_setup) entry[1] = newval
            }
            catch (ex) {
                // add name of the property to the exception message
                ex.message = `invalid value for property ${prop} in object [${this.id}]: ${ex.message}`
                throw ex
            }
        }

        // check multi-field constraints ...

        // run category-specific validation
        this.__validate__()
    }

    log(msg, args = null, level = 'INFO') {
        /* Server-side distributed logging of debug messages, warnings, errors.
           On client, the message is printed to the console with object ID prepended.
         */
        if (SERVER) return schemat.site.logger.KAFKA.log(msg, args, level)

        if (args) {
            let list = Object.entries(args).map(([k, v]) => k + `=${JSON.stringify(v)}`).join(', ')
            if (list) msg = `${msg} | ${list}`
        }
        console.log(`[${this.id}] ${msg}`)
    }


    /***  Hooks  ***/

    __new__(data) {
        /* Initialize own properties (__data) of this newborn object before its insertion to DB or transfer to the server.
           The JS class and `__category` property are already configured; this.__data is created.
           The default implementation just updates the entire __data using the first argument.
           Subclasses may override this method to change this behavior and accept a different list of arguments.
           Can be asynchronous in subclasses, in such case the call to ._create() or category.create() returns a Promise.
         */
        if (T.isPOJO(data) || data instanceof Catalog) this.__data.updateAll(data)
    }

    __init__() {}
        /* Custom initialization after this.__data was created (in a newborn object), or loaded from DB.
           Typically, this method loads selected related objects, so that other methods can use them directly with synchronous calls.
           Any other form of initialization that stores temporary data in local attributes (this.x = ...) is FORBIDDEN
           and incompatible with object cloning as done by get_mutable(). This method can be async in subclasses.
         */

    __destroy__() {}
        /* Custom tear down that is executed once before this object is permanently deleted from the database. */

    __validate__() {}
        /* Validate this object's own properties during update/insert. Called *after* validation of individual values through their schema.
           Called on NON-activated object; should NOT require that __init__() or _activate() was called beforehand!
         */

    __edited__(prev, curr) {}
        /* Post-processing after the __data was edited on the server during update of the record in DB. */

    // __setup__(id) {}
    //     /* One-time global setup after this object was created (on client or server) AND is pending insertion to DB (on server),
    //        BUT already has a provisional ID assigned (`id`). Typically, this method may insert related sub-objects.
    //        Can be declared async in subclasses or return a Promise.
    //      */
    //
    // __done__() {}
    //     /* Custom clean up to be executed after the item was evicted from the registry cache. Can be async. */


    /***  Triggers  ***/

    get edit() {
        /* Triggers of edit operations: obj.edit.X(...args) invokes obj._make_edit('edit.X', ...args).
           Can be called on client and server alike.
         */
        let obj = this
        return new Proxy({}, {
            get(target, prop) {
                if (typeof prop === 'string') return (...args) => obj._make_edit(prop, ...args)
            }
        })
    }

    get action() {
        /* Triggers of server-side actions: obj.action.X(...args) invokes site.POST.action(id, 'X', ...args),
           which forwards the call to obj['action.X'](...args) on server.
           This call can be used on client/server WITHOUT loading the target object, a stub is enough (!).
         */
        let id = this.id
        assert(id)
        return new Proxy({}, {
            get(target, prop) {
                if (typeof prop === 'string') return (...args) => schemat.site.POST.action(id, prop, ...args)
            }
        })
    }


    /***  Networking  ***/

    static _collect_methods(protocols = ['LOCAL', 'GET', 'POST', 'KAFKA'], SEP = '.') {
        /* Collect all special methods of this class: web handlers + actions + edit operators. */
        let is_endpoint = prop => protocols.some(p => prop.startsWith(p + SEP))
        let is_editfunc = prop => prop.startsWith('edit' + SEP)
        let is_action   = prop => prop.startsWith('action' + SEP)
        let is_remote   = prop => prop.startsWith('remote' + SEP)

        let proto = this.prototype
        let props = T.getAllPropertyNames(proto)

        let handlers = props.filter(is_endpoint).filter(name => proto[name]).map(name => [name, proto[name]])
        this.__handlers = new Map(handlers)
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
                let invoke = (res) => res instanceof Service ? res.invoke(this, endpoint, ...args) : res
                let result = handler.call(this)
                return result instanceof Promise ? result.then(invoke) : invoke(result)
            }
        }
    }

    async _handle_request(request, SEP = '.') {
        /* Handle a web or internal Request by executing the corresponding handler or service from this.__handlers.
           Query parameters are passed in `req.query`, as:
           - a string if there's one occurrence of PARAM in a query string,
           - an array [val1, val2, ...] if PARAM occurs multiple times.
           TODO: move this method to Site.handle_web(request)
        */
        assert(this.is_loaded)

        // convert endpoint names to full protocol-qualified communication endpoints: GET.name
        let names = this._get_endpoints(request)
        let endpoints = names.map(e => `${request.protocol}${SEP}${e}`)

        // find the first endpoint that matches this request and launch its handler
        for (let endpoint of endpoints) {
            // TODO: method _call_endpoint(endpoint, ...args)
            let handler = this._get_handler(endpoint)
            if (!handler) continue

            // print(`handle() endpoint: ${endpoint}`)
            request.set_endpoint(endpoint)
            let result = handler.call(this, request)

            if (result instanceof Promise) result = await result
            if (result instanceof Service) result = result.handle(this, request)
            if (typeof result === 'function') result = result.call(this, request)

            return result
        }

        throw new URLNotFound(`endpoint(s) not found in the target object: [${endpoints}]`, {path: request.path})
    }

    _get_handler(endpoint) {
        return this.__self[endpoint]
    }

    _get_endpoints(request) {
        /* Return a list of endpoint names (no protocol included) to be tried for this request. */

        // use request's endpoint if specified in the URL (::endpoint)
        let {endpoints, protocol} = request
        if (endpoints.length) return endpoints

        // otherwise, use category defaults, OR global defaults (for no-category objects)
        let glob_defaults = {GET: ['view', 'admin', 'inspect'], LOCAL: ['self']}
        let catg_defaults = this.__base?.default_endpoints.getAll(protocol)
        let defaults = catg_defaults || glob_defaults[protocol]
        if (defaults.length) return defaults

        throw new URLNotFound(`endpoint not specified (protocol ${protocol})`, {path: request.path})
    }

    url(endpoint, args) {
        /* Return the canonical URL of this object. `endpoint` is an optional name of ::endpoint,
           `args` will be appended to URL as a query string.
         */
        let path = this.__url || this.system_url                        // no-category objects may have no __url because of lack of schema and __url imputation
        if (endpoint) path += WebRequest.SEP_ENDPOINT + endpoint        // append ::endpoint and ?args if present...
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
            if (url) cat = `<a href="${url}">${cat}</a>`          // TODO SEC: {url} should be URL-encoded or injected in a different way
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

    async delete() {
        /* Delete this object from the database. No need to use save(). */
        return schemat.site.action.delete_object(this.__id)
    }

    _bump_version() {
        /* Set or increment __ver number, if already present or category's `set_version` is true. */
        if (this.__ver || this.__base?.set_version) {
            let ver = this.__ver || 0
            this.__data.set('__ver', ver + 1)
        }
        //else if (this.__ver) this.__data.delete('__ver')
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
        if (!this.__base?.seal_dependencies) return data.delete('__seal')
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


    /***  Object editing  ***/

    // get_private(opts = {}) {
    //     /* Create a fully-loaded, immutable, private copy of this web object (excluded from registry cache) whose content can be updated in place using .refresh() -
    //        so the object is not strictly immutable, but the edit operations are disallowed. The object is wrapped up in a proxy with AsyncLocalStorage,
    //        so each async thread receives its own copy that can be refreshed independently, i.e., without interference when one thread
    //        refreshes the copy while another one is still relying on a previous version.
    //      */
    // }

    get_mutable({activate = true, ...opts} = {}) {
        /* Create a fully-loaded, mutable instance of this (loaded) web object. The object is created synchronously by cloning this.__data.
           If dependencies of `this` were initialized (this._initialize()), they are still initialized for the clone.
         */
        assert(this.is_loaded() && !this.is_mutable(), 'a mutable copy can only be created from a fully-loaded immutable object')
        let obj = WebObject.stub(this.id, {...opts, mutable: true})
        obj._set_data(this.__data.clone(), this.__meta.loaded_at)
        T.setClass(obj, T.getClass(this))
        if (activate) obj._activate()
        return obj
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
        this._apply_edits(edit)
        this.__meta.edits?.push(edit)       // `edits` does not exist in newborn objects, so `edit` is not recorded then, but is still applied to __data
        return this
    }

    _apply_edits(...edits) {
        /* Apply `edits` to the __data. Each `edit` is an array: [op-name, ...args]. */
        for (const edit of edits) {
            let [op, ...args] = edit
            let func = this.__self[`edit.${op}`]
            if (!func) throw new Error(`edit method not found: '${op}'`)
            func.call(this, ...args)
            // this[method](JSONx.deepcopy(args))      // `args` are deep-copied for safety, in case they get modified during the edit
        }
    }

    async save(opts = {}) {
        /* Send __data (for a newly created object) or __meta.edits (for an existing object) to DB.
           Some of the available options: {ring, reload}.
           If reload=true (default), a new instance of this object is created with new content and returned.
         */
        this.assert_active()
        let {reload = true} = opts

        if (this.is_newborn()) return schemat.insert(this, opts)    // save a newly-created object

        let edits = this.__meta.edits           // otherwise, save updates of an existing object...
        if (edits?.length) {
            let submit = schemat.site.action.submit_edits(this.id, ...edits)
            edits.length = 0
            return reload ? submit.then(() => this.reload()) : submit
        }
        // throw new Error(`no edits to be submitted for ${this.id}`)
    }


    /***  Individual edits. Should be called via this.edit.*().
          Edits are methods that manipulate directly on the object's __data. Typically, they're first applied temporarily
          on the client; recorded in __meta.edits; then replayed on the server to do the permanent update in the database.
          New edit methods can be added in subclasses. They must be synchronous.
          They must NOT modify their arguments, because the same args may need to be sent later from client to DB.
     ***/

    'edit.set'(path, ...values) {
        /* Set value of a property or nested element inside a sub-catalog/map/array. */
        this.__data.set(path, ...values)
    }

    'edit.setkey'(path, key) {
        /* Change the key of a property or nested element inside a sub-catalog/map. */
        this.__data.setkey(path, key)
    }

    'edit.insert'(path, pos, key, value) {
        /* Insert a new property or a nested element inside a sub-catalog/map/array. */
        this.__data.insert(path, pos, key, value)
    }

    'edit.delete'(path) {
        /* Delete a property or a nested element inside a sub-catalog/map/array. */
        this.__data.delete(path)
    }

    'edit.move'(path, {pos, delta, count}) {
        /* Move a property or a nested element in a sub-catalog/map/array up or down inside its parent collection. */
        this.__data.move(path, {pos, delta, count})
    }

    'edit.increment'(path, delta = 1) {
        /* Increment a numeric value by `delta`. `path` should be unique, otherwise the duplicate occurrences will be removed. */
        let value = this.__data.get(path)
        this.__data.set(path, value + delta)
    }

    'edit.overwrite'(data) {
        /* Replace the entire set of own properties, __data, with a new object. */
        if (typeof data === 'string') data = Catalog.load(data)
        assert(data instanceof Catalog)
        this.__data = data
    }

    'edit.if_version'(ver) {
        /* Only apply the remaining edits if __ver on the server is equal `ver`. */
        if (this.__ver !== ver) throw new Error(`object has changed`)
    }

    add_version_check() {
        /* Insert `edit.if_version` operation to the stream of edits to make sure that the version hasn't changed on the server
           in the meantime. Here, __ver is the client-side version number.
         */
        assert(this.__ver, 'missing version number in the object')
        this.edit.if_version(this.__ver)
    }


    /***  Actions  ***/

    _execute_action(name, ...args) {
        assert(this.is_mutable())
        let func = this.__self[`action.${name}`]
        if (!func) throw new Error(`action method not found: '${name}'`)
        return func.call(this, ...args)
    }

    async 'action.move_to'(directory, overwrite = false) {
        /* Move this object from its current __container to `directory`, which must be a Directory object, or its URL.
           Returns an array of objects affected: the current object, the target directory, and the previous container.
         */
        if (typeof directory === 'number') directory = await schemat.get_loaded(directory)
        else if (typeof directory === 'string') directory = await schemat.import(directory)
        // TODO: check that `directory` is a Directory

        let [src, dir] = await schemat.get_mutable(this.__container, directory)
        let ident = this.__ident || this.name || `${this.id}`

        if (!overwrite && dir.has_entry(ident)) throw new Error(`entry '${ident}' already exists in the target directory (${dir})`)

        this.__container = dir
        dir.edit.set_entry(ident, this)

        if (src?.has_entry(this.__ident, this))
            src.edit.del_entry(this.__ident)

        await schemat.save([dir, this, src])
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

    'GET.json'({res})       { res.json(this.__record) }
    'GET.inspect'()         { return new ReactPage(ItemInspectView) }

    'LOCAL.self'()          { return this }

    // inspect()         { return react_page(ItemInspectView) }
    // inspect()         { return ItemInspectView.page(this) }
    // inspect()         { return ItemInspectView.page }


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


