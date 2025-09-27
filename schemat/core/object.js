/**********************************************************************************************************************
 *
 *  Main class of Schemat's Web Object model.
 *
 *  @author Marcin Wojnarski
 *
 */

import {ROOT_ID, PLURAL, SUBFIELD, check_plural, AgentRole} from '../common/globals.js'
import {print, assert, T, copy, escape_html, concat, unique, sleep, randint} from '../common/utils.js'
import {NotLoaded, URLNotFound, ValidationError} from '../common/errors.js'
import {Catalog, Struct} from '../common/catalog.js'
import {generic_type, REF} from "../types/type.js"
import {SCHEMA_GENERIC} from "../types/catalog_type.js"
import {html_page} from "../web/adapters.js"
import {Assets} from "../web/component.js"
import {WebRequest} from "../web/request.js"
import {ReactPage, InspectView} from "../web/pages.js"
import {Service} from "../web/services.js";

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
       Performs caching of computed properties in target.__cache. Ensures immutability of regular properties.
       Since a Proxy class can't be subclassed, all methods and properties of Intercept are static.
     */

    // UNDEFINED token marks that the value has already been fully computed, with inheritance and imputation,
    // and still remained undefined, so it should *not* be computed again
    static UNDEFINED    = Symbol.for('Intercept.UNDEFINED')
    static NO_CACHING   = Symbol.for('Intercept.NO_CACHING')   // marks a wrapper around a value (typically from a getter) that should not be cached

    // special properties of web object that are always stored/retrieved from __self (regular JS attibutes), not __data;
    // `then` is special because, when a promise resolves, .then is checked for another chained promise, so we disallow it as a persisted property
    static RESERVED = new Set([
        'then', 'id', '__provisional_id', '__meta', '__data', '__self', '__proxy', '__cache', '__status', '__ring', '__refresh',
        '$frame', '$state'
    ])


    static wrap(target) {
        /* Create a Proxy wrapper around `target` object. */
        return new Proxy(target, {get: this.proxy_get, set: this.proxy_set, deleteProperty: this.proxy_delete})
    }

    static proxy_get(target, prop, receiver, deep = true)
    {
        // use ordinary access if the property is a symbol or reserved
        if (Intercept._is_special(prop)) return Reflect.get(target, prop, receiver)

        // special handling for multi-segment paths (a.b.c...)
        if (deep && prop?.includes?.(SUBFIELD))
            return Intercept._get_deep(target, prop, receiver)

        let val, cache = target.__cache

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

        // handle role-based access to agent methods and state (e.g., $agent.f(), $leader.f(), etc.);
        // double $$, like in $$agent.f(), is treated as a broadcast call
        if (typeof prop === 'string' && prop[0] === '$' && ((prop.length > 1 && prop[1] !== '$') || (prop.length > 2 && prop[1] === '$')))
        {
            let broadcast = prop.startsWith('$$') || undefined
            if (broadcast) prop = prop.slice(1)
            let proxy = Intercept._agent_proxy(target, prop, broadcast)
            if (cache) Intercept._cache_value(cache, prop, proxy)
            return proxy
        }

        // return if the object is not loaded yet
        if (!target.__data) return undefined

        let [base, plural] = check_plural(prop)         // property name with $ suffix truncated

        // fetch ALL repeated values of `prop` from __data, ancestors, imputation, etc. (even if plural=false)...
        let values = target._compute_property(base)

        if (cache) {
            Intercept._cache_value(cache, base, values.length ? values[0] : Intercept.UNDEFINED)
            Intercept._cache_values(cache, base + PLURAL, values)
        }
        return plural ? values : values[0]
    }

    static _is_special(prop) {
        // `prop` can be a symbol like [Symbol.toPrimitive] instead of a string, or be a reserved property
        // that is always accessed as a regular JS attribute
        return typeof prop !== 'string' || Intercept.RESERVED.has(prop)
    }

    static _agent_proxy(target, role, broadcast) {
        /* Create an RPC proxy for this agent running in a particular role ($agent, $leader, etc.).
           The proxy creates triggers for intra-cluster RPC calls in two forms:
           1. obj.$ROLE.fun(...args) - sends a message that invokes obj['$ROLE.fun'](...args);
           2. obj.$ROLE(opts).fun(...args) - same but with additional options for rpc();
           3. obj.$ROLE.state is a special field that gives access to the locally running agent's state (if present).
           
           The object should be an instance of Agent class/category, because only agents are deployed 
           permanently on specific nodes in the cluster, maintain local state and accept RPC calls.
        */
        let id = target.id
        assert(id, `trying to access a newborn object as agent`)

        // `current_opts`: opts from $ROLE(opts) remembered here (shared variable!) until $ROLE(opts).fun is accessed;
        // WARNING: never separate $ROLE(opts) from *.fun, as this may result in wrong `opts` being passed to `fun` (!)
        let current_opts

        // create a parameterized handler factory
        let create_handler = (use_opts) => ({
            get(target, name) {
                if (typeof name !== 'string' || name === '__getstate__') return
                // if (!role || role === AgentRole.GENERIC)    // "$agent" as a requested role matches all role names at the target
                //     role = AgentRole.ANY

                let frame = schemat.get_frame(id, role)

                // // obj.$ROLE.state is a special field that gives access to the locally running agent's state (if present)
                // if (name === 'state') return frame?.state
                assert(name !== 'state')

                let opts = use_opts ? {broadcast, ...current_opts, role} : {broadcast, role}
                current_opts = null

                // if the target object is deployed here on the current process, call it directly without RPC
                if (frame && !opts.broadcast) return (...args) => frame.exec(name, args)

                // function wrapper for an RPC call
                assert(schemat.node, `the node must be initialized before remote agent [${id}].${role}.${name}() is called`)
                return (...args) => schemat.node.rpc(id, name, args, opts)
            }
        })

        // create both proxies using the handler factory
        let parameterized_proxy = new Proxy({}, create_handler(true))
        
        // create a function that updates current_opts and returns the parameterized proxy
        let func = function(opts = {}) {
            current_opts = opts
            return parameterized_proxy
        }

        // make the function itself a proxy that handles the direct access
        return new Proxy(func, create_handler(false))
    }

    static _get_deep(target, path, receiver) {
        /* Get a *deep* property value from `target` object; `path` is a multi-segment path (a.b.c...),
           optionally terminated with $ (plural path). */
        let [base, plural] = check_plural(path)
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
        // special attributes and symbols like [Symbol.toPrimitive] are written directly to __self
        if (Intercept._is_special(path))
            return Reflect.set(target, path, value, receiver)

        // if (!target.__meta.mutable) target._print(`proxy_set(${path}) on/via immutable object ${target}`)

        let [base, plural] = check_plural(path)         // property name without the $ suffix
        let [prop] = base.split(SUBFIELD)               // first segment of a deep path

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
                receiver._make_edit('set', base, ...value)
            }
            else receiver._make_edit('set', path, value)
            return true
        }
        else if (regular) throw new Error(`property not in object schema (${prop})`)

        // print('proxy_set() internal:', path, '/', mutable)
        if (!target.__meta.mutable) throw new Error(`trying to modify an immutable object ${target} (${path})`)
        return Reflect.set(target, path, value, receiver)
    }

    static proxy_delete(target, path) {
        if (Intercept._is_special(path)) return Reflect.deleteProperty(target, path)
        let [base] = check_plural(path)         // property name without the $ suffix
        target._make_edit('unset', base)
        return true
    }
}


/**********************************************************************************************************************/

export class WebObject {
    /* Web object. Persisted in the database; has a unique ID; can be exposed on the web at a particular URL. */

    static Status = Object.freeze({
        DELETED:  "DELETED",    // indicates the object is deleted from DB, or marked for deletion
    })

    static SEAL_SEP = '.'

    /***
    COMMON properties (stored in __data and persisted to DB):

    name                    human-readable name of this object (optional, repeated)
    info                    description of this object, similar to a comment or docstring in source code (optional, repeated)

    SYSTEM properties (implemented as POJO attributes or getters):

    id                      database ID of the object, globally unique; undefined in a newly created object; must never change;
                            it is assumed that `id` only exists for objects that are ALREADY stored in the DB; for newly-created objects,
                            __provisional_id is used to identify multiple interconnected objects while they're being saved to DB

    __data                  own properties of this object in their raw form (before imputation etc.), as a Catalog object created during .load()
    __object                JS object representation of __data, NOT encoded; for repeated fields, only the first value is included; may still contain nested Catalogs
    __json_source           if __data was parsed from a JSON string, __json_source holds this string for future reference
    __refresh               struct of the form {json, loaded_at} containing a newer version of this object's record, for use in .refresh()

    __ring                  Ring instance that represents the ring where this object was retrieved from; stub or loaded
    __block                 Block instance that represents the physical data block where this object was retrieved from; stub or loaded
    __hash                  random integer in [0, MAX_SAFE_INTEGER) assigned during instantiation to differentiate between multiple local instances of the same web object;
                            NOT strictly unique (!); does NOT depend on the object's content and does NOT change when the instance is edited
    __generation

    __meta, __proxy, __self -- see below in the code for details


    SPECIAL properties (some of them are virtual or implemented with getters; they must be commented out not to mask the getters):

    __provisional_id        temporary ID (-1,-2,-3...) of a newly created object not yet saved to DB; only used to differentiate the object
                            in a batch of interconnected objects that are being inserted to DB altogether
    __index_id              ID to be used for local indexing of persisted and newborn objects combined: positive value for persisted objects, negative for newborn ones

    __base                  virtual category: either the __category itself (if 1x present), or a newly created Category object (TODO)
                            that inherits (like from prototypes) from all __category$ listed in this object or inherited

    __schema                schema of this object's data, as a SCHEMA object

    __prototype             direct ancestor (prototype) of this object; there can be multiple __prototype$ for an object
    __ancestors             array of all ancestors, deduplicated and linearized, with `this` at the first position
    __ancestors_ids         a Set of all IDs in the __prototype inheritance chain/graph of this object, including self; for .instanceof() checks

    __category              category of this object, as a Category instance; there can be multiple __category$; can be inherited from __prototype$
    __class                 JS class (or its class path) for this object; assigned AFTER object creation during .load()

    __container             Container of this object, for canonical URL generation
    __status                a string describing the current state of this object in the DB, e.g., "DELETED"; undefined means normal state
    __std                   shortcut for __category.std: standard related objects (categories) that might be needed in __new__(), __setup__() etc

    __ttl                   time-to-live of this object in the registry, in seconds; 0 = immediate eviction on the next cache purge
    __ttl_ms                same as __ttl, but in milliseconds

    __ident                 (virtual) string identifier of this object inside its __container
    __path                  (virtual) URL path of this object; similar to __url, but contains blanks segments; imputed via _impute_path()
    __url                   (virtual) absolute URL path of this object, calculated via __url() getter

    __content               JSONx-encoded representation of {id, ...__data, __meta} for display during debugging
    __record                JSONx-encoded representation of this object as {id, data}, where `data` is this.__flat
    __flat                  JSONx-encoded representation of this object's __data, where custom classes are replaced using {@:...} notation; suitable for JSON.stringify()
    __json                  stringified representation of this object's __data; can be passed to Catalog.load() to recreate the original __data structure
    __assets                cached web Assets of this object's __schema

    */

    set id(id) {
        let prev = this.id
        if (prev !== undefined && prev !== id) throw new Error(`object ID is read-only and can't be changed from ${prev} to ${id}`)
        if (id !== undefined) Object.defineProperty(this, 'id', {value: id, writable: false})
    }

    get __cid()  { return this.__category?.id }
    get __cid$() { return this.__category$.map(c => c.id) }

    get __index_id()   { return this.id || this.__provisional_id }

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

    get __ancestors_ids() {
        /* A Set of all IDs in the __prototype inheritance chain/graph of this object, including self. */
        return new Set(this.__ancestors.map(obj => obj.id))
    }

    get __assets()  {
        let assets = new Assets()
        this.__schema.collect(assets)
        return assets
    }

    get __std()    { return this.__category?.std }

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

    get __label()  {
        /* [NAME] or [ID/CATEGORY] string that can be used in debug messages. */
        if (this.name) return `[${this.name}]`
        if (this.__category?.name) return `[${this.__index_id}:${this.__category.name}]`
        return `[${this.__index_id}]`
    }

    get __content() {
        /* Combined __data + __meta attributes, JSONx-encoded into a flat object suitable for display. Useful for debugging. */
        let flat = this.__index_id ? {id: this.__index_id} : {}
        flat = {...flat, ...(this.__data?.encode() || {})}
        if (Object.keys(this.__meta).length)            // add __meta but only if it's not empty
            flat.__meta = {...this.__meta}
        return flat
    }

    get __references() {
        /* Array of all WebObjects referenced from this one. May contain duplicates. */
        let refs = []
        Struct.collect(this.__data, obj => {if (obj instanceof WebObject) refs.push(obj)})
        return refs
    }

    _impute__ttl() {
        /* Impute this object's __ttl (cache TTL in seconds), if missing. */
        if (!this.__ring) return 0      // if loaded from a bootstrap ring, schedule this object for immediate reload
        return this.__base?.ttl || 0
    }

    get __ttl_ms() { return this.__ttl * 1000 }

    __ttl_left() {
        /* Remaining time between now and __meta.expire_at, in seconds. Returns a different value on each call, that's why it's not a getter. */
        return ((this.__meta.expire_at || 0) - Date.now()) / 1000
    }

    // static compare(obj1, obj2) {
    //     /* Ordering function that can be passed to array.sort() to sort objects from DB by ascending ID. */
    //     return obj1.id - obj2.id
    // }


    /***  Internal properties  ***/

    __self = this   // for direct system-level access to POJO special attributes after proxying
    // __proxy      // Proxy wrapper around this object created during instantiation and used for caching of computed properties
    // __cache      // Map of cached properties: read from __data, imputed, inherited or calculated from getters; ONLY present in immutable object

    __meta = {      // special properties grouped here to avoid cluttering the object's interface ...
        // active           set to true after full initialization procedure was completed; implies that full __data is present (newborn or loaded)
        // loading          promise created at the start of _load() and removed at the end; indicates that the object is currently loading its data from DB
        // loaded_at        timestamp [ms] when the full loading of this object was completed; to detect the most recently loaded copy of the same object
        // expire_at        timestamp [ms] when this object should be evicted from cache; 0 = immediate (i.e., on the next cache purge)
        // accessed_at      (NOT USED) the most recent timestamp [ms] when this object (if fully loaded) was requested from the Registry via schemat.get_object/get_loaded() or .refresh()
        // mutable          if true, this object can be edited; the edits are accumulated and committed to DB using .save(); this prop CANNOT be changed after construction; editable objects are excluded from server-side caching
        // obsolete         true if this mutable instance got replaced in the transaction's staging area by another one, so doing mutations on it is no longer allowed; max ONE instance per ID can accept mutations at a given time
        // edits            array of edit operations that were reflected in __data so far, for replay on the DB; each edit is a pair: [op, args]
    }

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

    is_newborn()    { return !this.id }         // object is "newborn" ("infant") when it hasn't been saved to DB, yet, and has no ID assigned, but is intended for insertion
    is_loaded()     { return this.__data && !this.__meta.loading }  // false if still loading, even if data has already been created but object's not fully initialized (except __url & __path which are allowed to be delayed)
    is_deleted()    { return this.__status === WebObject.Status.DELETED }
    is_category()   { return false }
    is_mutable()    { return this.__meta.mutable }
    is_expired()    { return this.__meta.expire_at < Date.now() }

    if_loaded()     { return this.is_loaded() && this }     // return self if already loaded, false/undefined otherwise

    assert_loaded() { if (!this.is_loaded()) throw new NotLoaded(this) }
    assert_active() { if (!this.is_loaded() && !this.is_newborn()) throw new NotLoaded(this) }

    is(other) {
        /* True if `this` and `other` object have the same ID; they still can be two different instances
           AND may contain different data (!), for example, if one of them contains more recent updates than the other.
           If `other` is undefined or any of the objects has a missing ID, they are considered NOT equivalent.
           Also, `other` can be an ID rather than an object.
         */
        return this.id !== undefined && ((typeof other === 'object' && this.id === other?.id) || this.id === other)
    }
    is_not(other)   { return !this.is(other) }

    // get_remote()    { return WebObject.remote(this.id) }


    /***  Instantiation  ***/

    constructor(_fail = true, id = null, {mutable = false, provisional, edits} = {}) {
        /* For internal use! Always call WebObject.new() instead of `new WebObject()`.
           By default, the object is created immutable, and on client (where all modifications are local to the single client process)
           this gets toggled automatically on the first attempt to object modification. On the server
           (where any modifications might spoil other web requests), changing `mutable` after creation is disallowed.
         */
        if (_fail) throw new Error('web objects should be instantiated with category.new() instead of new CLASS()')
        if (id) this.id = id
        if (provisional) this.__provisional_id = provisional
        // if (schemat._generation) this.__generation = schemat._generation

        // mutable=true allows edit operations on the object and prevents server-side caching of the object in Registry;
        // only on the client this flag can be changed after object creation
        Object.defineProperty(this.__meta, 'mutable', {value: mutable, writable: CLIENT, configurable: false, enumerable: true})

        if (!mutable) this.__cache = new Map()
        else if (id) this.__meta.edits = edits || []        // `edits` not needed for newborns because their full __data is transferred to DB upon save()
    }

    // static dummy(id) {
    //     /* An object simpler than a stub, only used as an ID holder for JSONx serialization. NO real functionality: no proxy, data loading, ... */
    //     return new this(false, id)
    // }

    static stub(id = null, opts = {}) {
        /* Create a stub: an empty object with `id` assigned. To load data, load() must be called afterwards. */

        // special case: the root category must have its proper class (RootCategory) assigned right from the beginning for correct initialization
        if (id === ROOT_ID && !this.__is_root_category)
            return RootCategory.stub(id, opts)

        let self = new this(false, id, opts)
        self.__hash = 1 + randint()

        return self.__proxy = Intercept.wrap(self)
    }

    // TODO: .remote() is probably not needed anymore
    static remote(id, edits = null) {   // proxy virtual ghost dummy
        /* An editable remote object: a mutable object with ID and __meta.edits, but no __data; it is *not* loaded,
           but still can be edited: the edits are recorded in the transaction and passed to DB upon .save()
           where they get applied to the object's content. An editable remote object serves as a temporary container
           for `edits` or __status=DELETED within a transaction that is to be written to DB.
           In this way, it allows manipulations (edits & delete) on a remote object *without* fully loading it, and without
           mirroring all edit operations on the client which may be costly in some cases.
           Since this object is not loaded, it should not be used for property access.
         */
        return schemat.stage(this.stub(id, {mutable: true, edits}))
    }

    static _new(categories = [], props, args, {draft, ...opts} = {}) {
        /* Create a newborn web object and execute its __new__(...args) to perform caller-side initialization.
           The object has no ID; it is mutable by default, and its __data is initialized with `props`.
           `categories` (if any) are category objects/IDs to be written to the object's __category property.
           The object is staged in the current transaction and is pending insertion to DB.
         */
        let obj = this.stub(null, {mutable: true, ...opts})
        obj.__data = new Catalog(props)

        if (props) obj.__data.updateAll(props)
        // if (T.isPOJO(props) || props instanceof Catalog) this.__data.updateAll(props)

        for (let cat of categories)
            obj.__data.append('__category', schemat.as_object(cat))

        obj.__new__(...args)

        if (!draft)                     // schemat.tx is missing during boot, that's why draft objects can't be staged
            if (schemat.tx) schemat.stage(obj)
            else throw new Error(`cannot create a newborn object when outside a transaction`)

        return obj
    }

    static async draft(props, ...args) {
        /* Create a temporary object that is initialized via its class's __new__(), plus async __draft__(...args),
           but is NOT intended for insertion to DB: it is not registered in transaction and does NOT have
           any __category assigned, which is undesired in normal circumstances. Such objects are used during bootstrap,
           when categories cannot be loaded yet and draft instances must be created from classes not categories.
         */
        let obj = this._new([], props, args, {draft: true})
        await obj.__draft__(...args)
        obj.__meta.active = true        // draft object is active right after __draft__(), no _initialize/__load__/_activate() needed
        return obj
    }

    static deaf(id, data) {
        /* Create an object that only contains __data, but is not initialized in any other way:
           has no custom class, no loaded __category & __prototype. Only own property values stored in __data
           can be accessed, and no getters, no default values, no imputation, no inheritance, no __schema.
           Deaf object is used for indexing and calculation of derived sequences from the main data sequence.
         */
        let obj = WebObject.stub(id)
        obj._set_data(data)
        obj.__meta.deaf = true
        return obj
    }

    static async inactive(id, data, opts = {}) {
        /* Create an inactive object - with no __load__/_activate() executed - that is seeded with pre-existing `data`,
           typically loaded from storage, or pending write. The ._initialize() is run and for this reason the method is async. */
        return this.from_data(id, data, {...opts, activate: false})
    }

    static async from_data(id, data, {mutable, provisional, ...load_opts} = {}) {
        /* Create a new WebObject instance given the `data` with the object's content (a Catalog or encoded JSONx string). */
        // assert(typeof data === 'string' || data instanceof Catalog)
        let obj = WebObject.stub(id, {mutable, provisional})
        obj._set_data(data)
        return obj.load(load_opts)
    }


    /***  Basic utilities  ***/

    toString() { return this.__label }

    _print(...args) { schemat._print(this.__label, ...args) }
    _print_error(title, ex) { schemat._print_error(`${this.__label} ${title}`, ex) }

    // _print_error(title, ex) {
    //     /* Print an error together with its .cause chain of errors. */
    //     let errors = [], first = true
    //     while (ex) {
    //         errors.push([ex.stack, ex.request, ex.node, ex.worker])
    //         ex = ex.cause
    //     }
    //     for (let [stack, request, node, worker] of errors) {
    //         if (first) schemat._print(this.__label, title, stack)
    //         else print(`  caused at ${node}/#${worker} by`, stack)
    //         if (request) print('    request:\x1b[32m', request, '\x1b[0m')
    //         first = false
    //     }
    // }

    _print_stack(...args) {
        /* Print the current stack trace with detailed header information: node ID, worker process, current object. */
        let stack  = new Error().stack
        let lines  = stack.split('\n').slice(2)
        // let caller = lines[0]?.trim()                   // caller of the current method
        // let fun    = caller?.match(/at (\S+)/)?.[1]     // function name of the caller
        // let label  = `${this.__label}${fun ? '.'+fun+'()' : ''}`
        // let title  = SERVER ? `${schemat.node?.id}/#${schemat.kernel?.worker_id} ${label} context ${schemat.db}` : label
        // console.log(title, '-- debug stack trace:', ...args)
        let label  = `${this.__label} debug stack trace`
        let title  = SERVER ? `${schemat._header} ${label}, context=${schemat.db}:` : label
        console.log(title, ...args)
        console.log(lines.join('\n'))
    }

    collect_items(test = (item) => true) {
        /* Return an array of pairs, [path, item], with all items found in __data tree that satisfy test(item). */
        let items = []
        let collect = (item, path) => {if (test(item)) items.push([path, item])}
        Struct.collect(this.__data, collect)
        return items
    }

    collect_typed(test = (item, type) => true, strict = true) {
        /* Return an array of triples, [path, item, type], with all items found in __data tree that satisfy test(item, type). */
        let items = []
        let collect = (item, path, type) => {
            if (strict && (!type || type === generic_type)) return false    // skip branches without a proper Type
            if (test(item, type)) items.push([path, item, type])
        }
        Struct.collect(this.__data, collect, this.__schema)
        return items
    }


    /***  Loading & initialization  ***/

    async load(opts = {}) {
        /* Load full __data from DB, if not loaded yet, and perform *activation* (initialization) of this object.
           Return self, unless custom DB options (`opts`) enforce creating a new instance, see _load() below.
           If sealed=true and __seal is present in the object, the exact versions of dependencies (prototypes, categories)
           as indicated by __seal are linked. The data is only loaded ONCE for a given WebObject instance due to immutability,
           and repeated .load() calls have no effect. To refresh the data, create a new instance with .reload().
         */
        let {active, loading} = this.__meta

        // data is loaded or being loaded right now? wait for the previous call to complete instead of starting a new one
        if (active || loading) return loading || this
        if (this.__meta.obsolete) throw new Error(`trying to load content to an obsolete instance of ${this}`)

        // keep and return a Promise that will eventually load the data; this is needed to avoid race conditions
        this.__meta.loading = loading = this._load(opts)
            // .catch(err => {
            //     console.warn(`failed to load object [${this.id}]:`, err)
            //     throw err
            // })

        let id = this.id
        if (!id)
            if (this.__provisional_id) throw new Error(`trying to load a newborn object (provisional ID = ${this.__provisional_id})`)
            else throw new Error(`trying to load an object with missing ID (id=${id})`)

        if (schemat.registry.get_object(id) === this)
            schemat._loading.set(id, loading)
            // schemat._loading.set(id, loading.catch(() => {}).then(() => {schemat._loading.delete(id); return this}))

        return loading
    }

    async _load(opts = {}) {
        /* Load this.__data from DB if not loaded yet. Set up the class and prototypes, load related objects with __load__() etc. */

        let {sealed = true, activate = true, custom_opts_allowed = false, ...db_opts} = opts
        let id = this.id

        // this._print(`_load() ...`)
        schemat.before_data_loading(this)
        let data_loaded = false

        try {
            if (!this.__data) {
                // if custom `db_opts` for DB loading are specified, the loaded object would no longer be "clean",
                // and for this reason, another instance must be created, not to pollute `this` which may be already
                // stored in the Registry and referenced by other objects or even by unrelated requests/threads
                // (this problem doesn't affect mutable objects, though, as they never get included in the Registry):
                if (Object.keys(db_opts).length && !this.is_mutable() && !custom_opts_allowed)
                    return WebObject.stub(id).load({...opts, custom_opts_allowed: true})

                if (db_opts.json) this._set_data(db_opts.json)
                else {
                    let rec = schemat.load_record(id, db_opts)
                    if (rec instanceof Promise) rec = await rec
                    let {json, loaded_at} = rec
                    this._set_data(json, loaded_at)
                }
                data_loaded = true
            }

            await this._initialize(sealed)
            if (!activate) return this                      // activation involves both __load__() and _activate(); none of these is executed when activate=false

            let init = this.__load__()                      // loading of related objects after the main __data is loaded (optional)
            if (init instanceof Promise) await init

            this._activate()
            return this

        } catch (ex) {
            if (data_loaded) this.__data = undefined        // on error, clear the data to mark this object as not loaded
            throw ex

        } finally {
            if (schemat._loading.get(id) === this.__meta.loading)
                schemat._loading.delete(id)
            this.__meta.loading = false                     // cleanup to allow another load attempt, even after an error
            schemat.after_data_loading(this)
        }
    }

    _set_data(data, loaded_at = Date.now()) {
        /* Create this.__data using content from `data`. Set related special fields. Extract & drop the temporary data.__meta.
           `data` can be a JSONx string, or a Catalog, or a Catalog's state object.
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
            let {__ring, __block} = meta
            if (__ring) self.__ring = __ring        //schemat.get_object(__ring)
            if (__block) self.__block = __block     //schemat.get_object(__block)
            assert(!__ring || typeof __ring === 'number')
            assert(!__block || typeof __block === 'number')
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
            // if (this.id <= 5) container.load(); else await container.load()   // __container of [Container] must not be awaited

        if (this.__status) this._print_stack(`WARNING: __status == ${this.__status}`)

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
                data.set(loc, await schemat.get_version(ref.id, ver))
        }
    }

    _activate() {
        /* Make the object fully operational: configure expiration time, put the object in the Registry. */
        let __meta = this.__meta
        __meta.expire_at = __meta.loaded_at + this.__ttl * 1000
        __meta.active = true
        delete __meta.deaf

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
        if (this.id === ROOT_ID) return RootCategory
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
           as available in the registry or downloaded from the DB. Can be overridden in subclasses to provide
           deep reload of child objects; the base implementation only reloads the parent object, so any nested
           objects (if present) may still be outdated. */
        return schemat.reload(this.id)
    }


    /***  URLs and URL paths  ***/

    get system_url() {
        /* The internal URL of this object, typically /$/id/<ID> */
        return schemat.app.default_path_of(this)
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
    //     while (!schemat.app) {                                      // wait until the app is created; important for bootstrap objects
    //         await sleep()
    //         if (schemat.terminating) return                         // app is closing? no need to wait any longer
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

        if (this.__meta.deaf) return data.getAll(prop)      // no inheritance/imputation for deaf objects during DB indexing

        // check the Type of the property in this object's __schema; special handling for:
        // 1) __prototype: because it is used at an early stage of loading (_load_prototypes()), before the object's category (and schema) is fully loaded;
        // 2) __category: because the schema is not yet available and reading the type from __schema would create circular dependency.

        let type =
            prop === '__category'  ? new REF() :
            prop === '__prototype' ? new REF({inherited: false}) :
                                     proxy.__schema.get(prop)

        if (!type) {
            console.warn(`trying to read an out-of-schema property '${prop}' of [${this.id}], returning undefined`)
            return []
        }

        // if the property is atomic (non-repeated and non-compound) and an own value is present, skip inheritance to speed up
        if (!type.is_repeated() && !type.is_CATALOG() && data.has(prop)) {
            let values = data.getAll(prop)
            if (values.length > 1) print(`WARNING: multiple values present for a property declared as unique (${prop} in [${this.id}]), using the first value only`)
            return [values[0]]
        }

        let {alias, getter, inherited} = type.options
        if (alias) return this[alias]

        let ancestors = inherited && !getter ? proxy.__ancestors : [proxy]              // `this` included as the first ancestor
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
        /* Check whether this object belongs to `category` or its subcategory.
           All comparisons along the way use IDs, not object identity. The item must be loaded.
        */
        // TODO: use cachable this.__ancestors_ids instead
        if (!this.is_loaded()) throw new Error(`object ${this} is not loaded, cannot perform instanceof()`)
        return this.__category$.some(cat => cat.__ancestors_ids.has(category.id))
        // return this.__category$.some(cat => cat.inherits_from(category))
    }

    // inherits_from(parent) {
    //     /* Return true if `this` inherits from `parent` via __prototype chain (NOT javascript prototypes).
    //        True if parent==this. All comparisons done by ID.
    //      */
    //     if (this.is(parent)) return true
    //     for (const proto of this.__prototype$)
    //         if (proto.inherits_from(parent)) return true
    //     return false
    // }

    validate() {
        /* Check validity of this object's properties before insert/update. */

        let data = this.__data
        let schema = this.__schema

        // validate each individual property; __data._entries may get directly modified here... (!)
        for (let [prop, locs] of data._keys) {

            // make sure the property name is not missing nor reserved: id, __meta, __self, __proxy, __status, etc.
            if (!prop) throw new ValidationError(`missing property name (${prop === '' ? `''` : prop})`)
            if (Intercept.RESERVED.has(prop)) throw new ValidationError(`reserved property name ('${prop}')`)

            let type = schema.get(prop)

            if (!type)                                          // property not in schema? skip or raise error
                if (this.__category.allow_custom_fields) continue
                else throw new ValidationError(`unknown property '${prop}' in ${this}`)

            if (locs.length > 1 && !type.options.repeated)      // single-valued property should have no repetitions
                throw new ValidationError(`multiple occurrences of property '${prop}' declared as single-valued in ${this.id}`)

            // if (type.options.getter) throw new ValueError(`cannot write to a property marked as a "getter" ('${prop}')`)

            try {
                for (let loc of locs) {
                    let entry = data._entries[loc]          // validate the value and possibly replace it IN PLACE with a normalized value
                    entry[1] = type.validate(entry[1])      // ... may raise an exception
                }
            }
            catch (ex) {
                // add name of the property to the exception message
                ex.message = `invalid value of '${prop}' in ${this}: ${ex.message}`
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
        if (SERVER) return schemat.app.logger.$agent.log(msg, args, level)

        if (args) {
            let list = Object.entries(args).map(([k, v]) => k + `=${JSON.stringify(v)}`).join(', ')
            if (list) msg = `${msg} | ${list}`
        }
        console.log(`[${this.id}] ${msg}`)
    }

    get $_wrap() {
        /* RPC mock-up triggers: $_wrap.X() calls $agent.X() as a plain method with this.$state explicitly supplied. For internal use only. */
        let id = this.id
        let obj = this
        return new Proxy({}, {
            get(target, name) {
                if (typeof name === 'string') return (state, ...args) => {
                    Object.defineProperty(obj.__self, '$state', {value: state, writable: true})
                    let method = obj.__self[`$agent.${name}`]
                    return method.call(obj, ...args)
                }
            }
        })
    }


    /***  Hooks  ***/

    __new__(...args) {}
        /* Custom initialization of a newborn object. Called by category.new(props, ...args) after `props` were already
           copied into __data; `args` are the optional arguments (after `props`) that were passed to .new();
           __new__() is allowed to assign to `this`. A newborn object is NOT activated and mainly serves as a container
           for __data. For instance, this.__category is not yet available, despite '__category' field may be written into __data.
           More advanced initialization may have to be moved to __setup__(), which is called on an object with
           initialized dependencies (but NOT yet fully activated!).
         */

    __draft__() {}
        /* Async setup of a temporary object created with static draft(), typically during bootstrap. */

    __setup__() {}      // __insert__()
        /* Server-side setup of the object, launched during insert to a data block, right after the object received
           its final ID. Typically, it creates related sub-objects, esp. when doing this on a client would be too costly.
           __setup__() can be viewed as continuation of __new__(), but asynchronous, executed on a server (inside a data block)
           on a partly initialized object (dependencies are loaded), with access to the final ID. May return a Promise.
           All child objects created in __setup__() are inserted to the same data block as the parent, which improves
           performance of insertions and future read access. NOTE: the objects created during __setup__() are not staged
           in the transaction, but inserted immediately to the block, with their own __setup__() being executed right away.
           For this reason, it is unnecessary and disallowed to save them explicitly with obj.save() or schemat.save(...).
         */

    __delete__() {}    // __destroy__/__teardown__/__finalize__()
        /* Custom cleanup executed when this object is to be permanently deleted from the database.
           Typically, this method removes related objects and/or local resources.
           IMPORTANT: this method is called on *inactive* object, which means that __data is loaded, prototypes and
           the class are initialized, but __load__() has *not* been executed, so references may not be loaded (!).
         */

    __load__() {}
        /* Loading of selected related objects, so that other methods can use them directly in synchronous calls.
           Launched after __data was read from DB during load(). Can be async in subclasses.
           // Any other form of initialization that modifies the properties or writes to local attributes (this.x = ...)
           // is disallowed as incompatible with immutability, property caching, and object cloning.
         */

    __validate__() {}
        /* Validate this object's own properties during insert/update. Called *after* validation of individual values through their schema.
           Called on a NON-activated object: should NOT require that __load__() or _activate() was called beforehand!
         */

    // __done__() {}
    //     /* Custom clean up to be executed after the item was evicted from the registry cache. Can be async. */


    /***  Networking  ***/

    async _handle_request(request, SEP = '.') {
        /* Handle a web or internal Request by executing the corresponding handler or service from this.__handlers.
           Query parameters are passed in `req.query`, as:
           - a string if there's one occurrence of PARAM in a query string,
           - an array [val1, val2, ...] if PARAM occurs multiple times.
           TODO: move this method to Application.handle_web(request)
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

            try {
                let result = await handler.call(this, request)
                if (result instanceof Service) result = await result.handle(this, request)
                if (typeof result === 'function') result = await result.call(this, request)
                return result
            }
            catch (ex) {
                this._print_error(`${endpoint}() failed with`, ex)      // ${ex.constructor.name}: ${ex.message}
                return
            }
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

    get_stamp({html = true, brackets = true, max_len = null, ellipsis = '...'} = {}) {
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
        let stamp = cat ? `${cat}:${this.id}` : `${this.id}`
        return brackets ? `[${stamp}]` : stamp
    }

    get_breadcrumb(max_len = 10) {
        /* Return an array of containers that lead from the app's root to this object.
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

    /***  Web Triggers  ***/

    get ax() {
        // TODO: rename to server() or remote() ?? ... use as: obj.server.method()
        /* Triggers of server-side actions: obj.ax.X(...args) invokes app.POST.action(id, 'X', args),
           which forwards the call to obj['ax.X'](...args) on server. Inside the 'ax.X'() method,
           `this` object is made mutable, so it can be easily edited. Any modified records are returned to the caller
           and saved in Registry, so the caller can recreate corresponding objects with their most recent content
           by simply refreshing/reloading them. Action triggers can be called on stubs without fully loading the target object.
         */
        let id = this.id
        let obj = this
        assert(id)

        return new Proxy({}, {
            get(target, name) {
                if (typeof name === 'string')
                    if (CLIENT && name[0] === '_') throw new Error(`private ax.${name}() can only be invoked on server`)
                    else return (...args) => SERVER ? schemat.execute_action(obj, name, args, false) : schemat.app.POST.action(id, name, args)
            }
        })
    }

    // GET/POST/LOCAL.*() are isomorphic triggers ({name: trigger_function}) for this object's web endpoints ...

    get GET()   { return this._web_triggers('GET') }        // triggers for HTTP GET endpoints of this object
    get POST()  { return this._web_triggers('POST') }       // triggers for HTTP POST endpoints
    get LOCAL() { return this._web_triggers('LOCAL') }      // triggers for LOCAL endpoints that only accept requests issued by the same process (no actual networking, similar to "localhost" protocol)

    _web_triggers(protocol, SEP = '.') {
        /* Triggers of web endpoints on a given protocol: obj.<protocol>.<endpoint>() redirects to obj['<protocol>.<endpoint>']().
           If the result is a Service, its .client() or .server() is called (via .invoke()), according to the current environment.
         */
        let obj = this
        return new Proxy({}, {
            get(target, name) {
                if (typeof name === 'string') return (...args) => {
                    let endpoint = protocol + SEP + name
                    let result = obj.__self[endpoint]()
                    let invoke = (res) => res instanceof Service ? res.invoke(obj, endpoint, ...args) : res
                    return result instanceof Promise ? result.then(invoke) : invoke(result)
                }
            }
        })
    }

    // static _collect_methods(protocols = ['LOCAL', 'GET', 'POST'], SEP = '.') {
    //     /* Collect all special methods of this class: web handlers + actions + edit operators. */
    //     let is_endpoint = prop => protocols.some(p => prop.startsWith(p + SEP))
    //     let proto = this.prototype
    //     let props = T.getAllPropertyNames(proto)
    //
    //     let handlers = props.filter(is_endpoint).filter(name => proto[name]).map(name => [name, proto[name]])
    //     this.__handlers = new Map(handlers)
    // }
    //


    /***  Database operations on self  ***/

    delete_self() {
        /* Mark this object as to-be-deleted in its mutable copy (in transaction) and return this copy for easy chaining of a .save() call.
           The object can be a stub (no __data), which allows marking an ID for deletion without loading its content.
           This implies, however, that this method should *not* be overridden, because a subclass implementation
           will *not* be detected when invoked on a stub object.
         */
        let obj = this.get_mutable()
        obj.__self.__status = WebObject.Status.DELETED
        return obj
    }

    update_self(props = {}) {
        /* Copy all `props` entries into `this`. */
        // schemat.tx.config({capture: false, atomic: true})
        // schemat.tx.default({capture: false, atomic: true}) -- has effect unless the property was already configured by client
        for (let [key, val] of Object.entries(props))
            this[key] = val
        return this
    }

    async deploy_agent() {
        /* Deploy `this` as an agent somewhere in the cluster. Should only be called on web objects of Agent category.
           This method is defined here instead of Agent class to allow its invocation on stubs.
         */
        return schemat.cluster.$leader.deploy_agent(this)
    }

    async remove_agent() {     // dismiss/discard/expel/expulse/evict/remove/retract/cancel/revoke/recall/withdraw
        /* Stop & uninstall all running instances of this agent across the cluster, typically as a preparation
           before deletion of the object from DB. Reverts the effects of deploy_agent(). */
        return schemat.cluster.$leader.remove_agent(this)
    }


    /***  Versioning  ***/

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
        let rev = await Revision.new({data, target: this})
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

    get edit() {
        /* Triggers of edit operations: obj.edit.X(...args) invokes obj._make_edit('edit.X', ...args).
           Can be called on client and server alike.
         */
        let obj = this
        return new Proxy({}, {
            get(target, name) {
                if (typeof name === 'string') return (...args) => obj._make_edit(name, ...args)
            }
        })
    }

    get_mutable() {
        /* Return the mutable instance of this object as currently recorded in the transaction under this ID;
           or itself if `this` is already mutable (which does NOT imply it is included in the transaction!
           but normally, __meta.obsolete should be true if this instance got excluded from the TX).
         */
        if (this.__meta.mutable) return this
        if (schemat.tx) return schemat.tx.get_mutable(this)
        throw new Error(`cannot create a mutable copy of ${this} outside a transaction`)
    }

    _get_mutable(opts = {}) {
        /* Create synchronously a mutable instance of itself: by cloning this.__data (on server), or by marking itself
           as mutable (on client). The object must be already fully loaded.
           If dependencies of `this` were initialized (this._initialize()), they are still initialized for the clone.
         */
        if (this.__meta.obsolete) throw new Error(`this mutable instance of ${this} is obsolete (was replaced with a newer one) and should not be used`)
        if (this.__meta.mutable) return this

        // if (!this.is_loaded()) throw new Error('only a fully loaded object can be converted to a mutable instance')
        if (CLIENT) return this._make_mutable()
        return this._clone(opts)
    }

    _clone(opts) {
        let obj = WebObject.stub(this.id, {mutable: true, ...opts})
        T.setClass(obj, T.getClass(this))
        if (this.__data) obj._set_data(this.__data.clone(), this.__meta.loaded_at)
        if (this.__meta.active) obj._activate()
        return obj
    }

    _make_mutable() {
        /* Make itself mutable. This removes the property cache, so read access becomes less efficient. Only allowed on client. */
        delete this.__cache
        this.__meta.mutable = true
        this.__meta.edits = []
        return this
    }

    _make_edit(op, ...args) {
        /* Perform an edit locally on the caller and append to __meta.edits so it can be submitted to the DB with save().
           Return `this`, or whatever the mutable version of this object is registered in the current transaction (if `this` is immutable).
         */
        if (this.__meta.obsolete) throw new Error(`this instance of ${this} is obsolete, reload it to edit`)

        let obj = this.get_mutable()            // the edit may go to a different instance (a mutable one), not `this`!
        let edit = [op, ...args]

        obj.__data && obj._apply_edits(edit)    // __data is not present in editable "remote" objects, but appending to `edits` is enough there
        obj.__meta.edits?.push(edit)            // `edits` is not present in newborns, but editing __data is enough there
        return obj
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

    async save({reload = null, ...opts} = {}) {
        /* Send __data (for a newly created object) or __meta.edits (for an existing object) of the *mutable copy*
           of this object (as recorded in the current transaction) to DB. Return the mutated object (from before save());
           or, if reload=true (default for inserted and mutated objects, but not for deleted ones), return a new immutable copy
           of `this` initialized with the new content captured from DB. Some other available options include {ring}.
         */
        let obj = this.get_mutable()
        if (reload === null && !obj.is_deleted()) reload = true
        await schemat.save(opts, obj)
        return reload ? obj.reload() : obj
    }


    /***  Individual edits. Should be called via this.edit.*().
          Edits are methods that manipulate directly on object's __data. They are first applied on the caller (client);
          recorded in __meta.edits; then replayed in the DB block on origin server for permanent update in the database.
          New edit methods can be added in subclasses:
          - they must be synchronous;
          - they must NOT access the content of other web objects except the one being mutated;
          - they must NOT modify their arguments as the same args may need to be sent later from client to DB.
     ***/

    'edit.touch'() {}
        /* No change. Used to enforce a rewrite of the database record, for debugging, etc. */

    'edit.set'(path, ...values) {
        /* Set value of a property or nested element inside a sub-catalog/map/array. */
        this.__data.set(path, ...values)
    }

    'edit.set_at'(path, pos, key, value) {
        /* Insert a new property or a nested element inside a sub-catalog/map/array at a specific position, `pos`. */
        this.__data.insert(path, pos, key, value)
    }

    'edit.unset'(path) {
        /* Remove a property or nested element from a sub-catalog/map/array. */
        this.__data.delete(path)
    }

    'edit.rename'(path, key) {
        /* Change the key of a property or nested element inside a sub-catalog/map. */
        this.__data.setkey(path, key)
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

    // TODO: implement equivalents of MongoDB's operators:
    //
    // 'edit.min'(path, value) {}
    // 'edit.max'(path, value) {}
    // 'edit.mul'(path, factor) {}
    // 'edit.push'(path, elem) {}
    // 'edit.pop'(path) {}
    // // 'edit.pull'(path, condition) {}
    // 'edit.current_date'(path) {}



    /***  Actions  ***/

    async 'ax.move_to'(directory, overwrite = false) {
        /* Move this object from its current __container to `directory`, which must be a Directory object, or its URL. */

        if (typeof directory === 'number') directory = await schemat.get_loaded(directory)
        else if (typeof directory === 'string') directory = await schemat.import(directory)
        assert(directory.instanceof(schemat.std.Directory))

        let ident = this.__ident || this.name || `${this.id}`
        let src = this.__container
        let dst = directory

        if (!overwrite && dst.has_entry(ident)) throw new Error(`entry '${ident}' already exists in the target directory (${dst})`)

        this.__container = dst
        dst.edit.set_entry(ident, this)

        if (src?.has_entry(this.__ident, this))
            src.edit.del_entry(this.__ident)
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
    'GET.inspect'()         { return new ReactPage(InspectView) }

    'LOCAL.self'()          { return this }

    // inspect()         { return react_page(InspectView) }
    // inspect()         { return InspectView.page(this) }
    // inspect()         { return InspectView.page }


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
    //         return schemat.app.import(path)
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


