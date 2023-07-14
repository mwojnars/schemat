import { print, assert, T, escape_html, splitLast, concat, unique } from './utils.js'
import { NotFound, ItemDataNotLoaded, ItemNotLoaded } from './errors.js'

import { JSONx } from './serialize.js'
import { Path, Catalog, Data } from './data.js'
import {DATA, DATA_GENERIC, generic_schema} from "./type.js"
import {HttpService, JsonService, API, TaskService, InternalService, Network} from "./services.js"
import {CategoryAdminPage, ItemAdminPage} from "./pages.js";

export const ROOT_ID = 0
export const SITE_ID = 1


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
    /* Custom representation of a web request (.session defined) or internal request (no .session). */

    static SEP_ROUTE  = '/'         // separator of route segments in URL paths
    static SEP_METHOD = '@'         // separator of a method name within a URL path

    static PathNotFound = class extends NotFound {
        static message = "URL path not found"
    }

    get req()       { return this.session?.req }
    get res()       { return this.session?.res }

    type            // CALL, GET, POST, (SOCK in the future); request type; there are different handler functions for different request types
    session         // Session object; only for top-level web requests (not for internal requests)
    pathFull        // initial path, trailing @method removed; stays unchanged during routing (no truncation)
    path            // remaining path to be consumed by subsequent nodes along the route;
                    // equal pathFull at the beginning, it gets truncated while the routing proceeds

    args            // dict of arguments for the handler function; taken from req.query (if a web request) or passed directly (internal request)
    methods = []    // names of access methods to be tried for a target item; the 1st method that's present on the item will be used, or 'default' if `methods` is empty

    item            // target item responsible for actual handling of the request, as found by the routing procedure

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
        this.type =
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

    throwNotFound(msg, args)  { throw new Request.PathNotFound(msg, args || {'path': this.pathFull, 'remaining': this.path}) }
}


export class RequestContext {
    /* Wrapper around the contextual information passed to request handlers. */
    constructor({request, endpoint}) {
        Object.assign(this, {request, endpoint})
    }
}


/**********************************************************************************************************************
 **
 **  ITEM & CATEGORY
 **
 */

export class Item {

    /*
    An item is an object that lives in a database, is potentially accessible by a URL and maps to
    a Javascript object (can be loaded, used, modified, saved in JS code).
    All items of a cluster form an "item space".

    >> meta fields are accessible through this.get('#FIELD') or '.FIELD' ?
    >> item.getName() uses a predefined data field (name/title...) but falls back to '#name' when the former is missing
    - ver      -- current version 1,2,3,...; increased +1 after each modification of the item; null if no versioning
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

    id              // Item ID (IID) of this item; globally unique (for a persisted item) or undefined (for a newly created item)

    data            // data fields of this item, as a Data object; can hold a Promise, so it always should be awaited for,
                    // or accessed after await load(), or through item.get()

    dataJson        // JSON string containing encoded .data as loaded from DB during last load(); undefined in a newborn item

    // _db          // the origin database of this item; undefined in newborn items
    // _ring        // the origin ring of this item; updates are first sent to this ring and only moved to an outer one if this one is read-only

    //metadata      // system properties: current version, category's version, status etc.

    get db() { return globalThis.schemat.db }

    registry        // Registry that manages access to this item
    expiry          // timestamp [ms] when this item should be evicted from Registry.cache; 0 = NEVER, undefined = immediate

    net             // Network adapter that connects this item to its network API as defined in this.constructor.api
    action          // collection of triggers for RPC actions exposed by this item's API; every action can be called from a server or a client

    // editable        // true if this item's data can be modified through .edit(); editable item may contain uncommitted changes,
    //                 // hence it should NOT be used for reading

    _dataAll = new Map()        // map of computed entries per field, {field: array_of_entries}; for repeated fields,
                                // each array consists of own data (from item.data) + inherited from ancestors, or schema default / imputed;
                                // for non-repeated fields, the arrays are singletons
                                // each field is computed and cached separately, lazily upon request;

    _methodCache = new Map()    // cache of outputs of the methods wrapped up in Item.setCaching(); values can be Promises!

    static actions    = {}      // specification of action functions (RPC calls), as {action_name: [endpoint, ...fixed_args]}; each action is accessible from a server or a client
    static api        = null    // API instance that defines this item's endpoints and protocols

    static __transient__ = ['_methodCache']

    get id_str()    { return `[${this.id}]` }
    get category()  { return this.prop('__category__', {schemaless: true}) }

    isLoading           // the Promise created at the start of reload() and fulfilled when load() completes; indicates that the item is currently loading
    get isLoaded()      { return this.data && !this.isLoading }         // false if still loading, even if .data has already been created (but not fully initialized)
    get isCategory()    { return this.instanceof(this.registry.root) }

    has_id(id = null) {
        return id !== null ? id === this.id : this.id !== undefined
    }

    assertData()    { if (!this.data) throw new ItemDataNotLoaded(this) }   // check that .data is loaded, but maybe not fully initialized yet
    assertLoaded()  { if (!this.isLoaded) throw new ItemNotLoaded(this) }

    // get newborn()   { return this.iid === null }
    // has_data()      { return !!this.data }

    static orderAscID(item1, item2) {
        /* Ordering function that can be passed to array.sort() to sort items, stubs, or {id, ...} records by ascending ID. */
        return item1.id - item2.id
    }

    constructor(registry, id = undefined) {
        /* Creates an item stub, `id` can be undefined. To set this.data, load() or reload() must be called afterwards. */
        this.registry = registry
        this.id = id
    }

    static async createBooted(registry, id, {data, dataJson} = {}) {
        /* Create a new item instance: either a newborn one (intended for insertion to DB, no IID yet);
           or an instance loaded from DB and filled out with `data` (object) or `dataJson` (encoded json string).
           The item returned is *booted* (this.data is initialized).
         */
        let item = new Item(registry, id)
        assert(data || dataJson)
        data = data || item._decodeData(dataJson)
        return item.reload(data)
    }

    static createAPI(endpoints, actions = {}) {
        /* Create .api and .actions of this Item (sub)class. */
        let base = Object.getPrototypeOf(this)
        if (!T.isSubclass(base, Item)) base = undefined
        this.api = new API(base ? [base.api] : [], endpoints)
        this.actions = base ? {...base.actions, ...actions} : actions
    }

    async load() {
        /* Load full data of this item (this.data) if not loaded yet. Return this object. */
        // if field !== null && field in this.isLoaded: return      // this will be needed when partial loading from indexes is available
        // if (this.data) return this.data         //field === null ? this.data : T.getOwnProperty(this.data, field)
        if (this.isLoaded) return this
        if (this.isLoading) return this.isLoading       // loading has already started, should wait rather than load again
        return this.reload()                            // keep a Promise that will eventually load this item's data to avoid race conditions
    }

    async reload(data = null) {
        if (this.isLoading) await this.isLoading        // wait for a previous reload to complete; this is only needed when called directly, not through load()
        return this.isLoading = this.boot(data)         // keep a Promise that will eventually load this item's data to avoid race conditions
    }

    async refresh() {
        /* Get the most current instance of this item from the registry - can differ from `this` (!) - and make sure it's loaded. */
        return this.registry.getItem(this.id).load()
    }

    async boot(data = null) {
        /* (Re)initialize this item. Load this.data from a DB if data=null, or from a `data` object (POJO or Data).
           Set up the class and prototypes. Call init().
         */
        try {
            data = data || await this._loadData()
            this.data = data instanceof Data ? data : new Data(data)

            let proto = this.initPrototypes()                   // load prototypes
            if (proto instanceof Promise) await proto

            let category = this.category                        // this.data is already loaded, so __category__ should be available
            // assert(category)

            if (category && !category.isLoaded && category !== this)
                await category.load()

            await this._initClass()                             // set the target JS class on this object; stubs only have Item as their class, which must be changed when the item is loaded and linked to its category
            this._initNetwork()

            let init = this.init()                              // optional custom initialization after the data is loaded
            if (init instanceof Promise) await init             // must be called BEFORE this.data=data to avoid concurrent async code treat this item as initialized

            this.setExpiry(category?.prop('cache_ttl'))

            return this

        } finally {
            this.isLoading = false                              // cleanup to allow another load attempt, even after an error
        }
    }

    async _loadData() {
        if (!this.has_id()) throw new Error(`trying to load item's data with missing or incomplete ID: ${this.id_str}`)
        let json = await this.registry.loadData(this.id)
        return this._decodeData(json)
    }
    _decodeData(json) {
        /* Decode a JSON-encoded data string into an object and save the original string in this.dataJson. */
        return JSONx.parse(this.dataJson = json)
    }

    setExpiry(ttl) {
        /* Time To Live (ttl) is expressed in seconds. */
        if (ttl === undefined) return                           // leave the expiry date unchanged
        if (ttl === 'never' || ttl < 0) this.expiry = 0         // never evict
        else if (ttl === 0) delete this.expiry                  // immediate eviction at the end of web session
        else this.expiry = Date.now() + ttl * 1000
    }

    initPrototypes() {
        /* Load all prototypes and check that they belong to the same category (exactly) as this item,
           otherwise the schema of some fields may be incompatible or missing.
         */
        let prototypes = this.data.getValues('prototype')
        // for (const p of prototypes)        // TODO: update the code below to verify .category instead of CIDs
            // if (p.cid !== this.cid) throw new Error(`item ${this} belongs to a different category than its prototype (${p})`)
        prototypes = prototypes.filter(p => !p.isLoaded)
        if (prototypes.length === 1) return prototypes[0].load()            // performance: trying to avoid unnecessary awaits or Promise.all()
        if (prototypes.length   > 1) return Promise.all(prototypes.map(p => p.load()))
    }

    async _initClass() {
        /* Initialize this item's class, i.e., substitute the object's temporary Item class with an ultimate subclass. */
        // if (this.category === this) return                      // special case for RootCategory: its class is already set up, must prevent circular deps
        // T.setClass(this, await this.category.getItemClass())    // change the actual class of this item from Item to the category's proper class
        T.setClass(this, await this.getClass() || Item)    // change the actual class of this item from Item to the category's proper class
    }

    _initNetwork() {
        /* Create a .net connector and .action triggers for this item's network API. */
        let role = this.registry.onServer ? 'server' : 'client'
        this.net = new Network(this, role, this.constructor.api, this.constructor.actions)
        this.action = this.net.action
    }

    init() {}
        /* Optional item-specific initialization after this.data is loaded.
           Subclasses may override this method as either sync or async.
         */
    end() {}
        /* Custom clean up to be executed after the item was evicted from the Registry cache. Can be async. */

    instanceof(category) {
        /* Check whether this item belongs to a `category`, or its subcategory.
           All comparisons along the way use item IDs, not object identity. The item must be loaded.
        */
        return this.category.inherits(category)
    }
    inherits(parent) {
        /* Return true if `this` inherits from a `parent` item through the item prototype chain (NOT javascript prototypes).
           True if parent==this. All comparisons by item ID.
         */
        if (this.has_id(parent.id)) return true
        for (const proto of this.getPrototypes())
            if (proto.inherits(parent)) return true
        return false
    }

    /***  Dynamic loading of source code  ***/

    async getClass()    { return this.category?.getItemClass() }

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
        /* Read the item's property either from this.data using get(), or (if missing) from this POJO's regular attribute
           - this allows defining attributes either through DB or item's class constructor.
           If there are multiple values for 'path', the first one is returned.
           `opts` are {default, schemaless}.
         */
        if (this.data) {
            // this.data: a property can be read before the loading completes (!), e.g., for use inside init();
            // a "shadow" item doesn't map to a DB record, so its props can't be read with this.props() below
            let value = this.props(path, opts).next().value
            if (value !== undefined) return value

            // before falling back to a default value stored in a POJO attribute,
            // check that 'path' is valid according to schema, to block access to system fields like .data etc
            if (!opts.schemaless) {
                let schema = this.getSchema()
                let [prop] = Path.split(path)
                if (!schema.isValidKey(prop)) throw new Error(`not in schema: ${prop}`)
            }
        }

        // POJO attribute value as a default
        let value = this[path]
        if (value !== undefined) return value

        return opts.default
    }

    propObject(...paths) {
        /* Read multiple prop(path) properties and combine the result into a single POJO object {path_k: value_k}.
           The result may include a default or POJO value if defined for a particular field.
         */
        let subset = {}
        for (let path of paths) {
            let value = this.prop(path)
            if (value !== undefined) subset[path] = value
        }
        return subset
    }

    *props(path, opts) {
        /* Generate a stream of all (sub)property values that match a given `path`. The path should start with
           a top-level property name, followed by subproperties separated by '/'. Alternatively, the path
           can be an array of subsequent property names, or positions (in a nested array or Catalog).
         */
        let [prop, tail] = Path.splitAll(path)
        for (const entry of this.entries(prop, opts))       // find all the entries for a given `prop`
            yield* Path.walk(entry.value, tail)             // walk down the `tail` path of nested objects
    }

    propsList(path)         { return [...this.props(path)] }
    propsReversed(path)     { return [...this.props(path)].reverse() }

    *entries(prop, {schemaless= false} = {}) {
        /* Generate a stream of valid entries for a given property: own entries followed by inherited ones;
           or the default entry (if own/inherited are missing), or an imputed entry.
           If the schema doesn't allow multiple entries for `prop`, the first one is yielded (for atomic types),
           or the objects (own, inherited & default) get merged into one (for "mergeable" types like CATALOG).
           Once computed, the list of entries is cached in this._dataAll for future use.
           If schemaless=true, a concatenated stream of all matching entries is returned without caching -
           for system properties, like __category__, which are processed when the schema is not yet available.
         */
        let entries = this._dataAll.get(prop)                               // array of entries, or undefined
        if (entries) yield* entries

        // below, `this` is included at the 1st position among ancestors;
        // `streams` is a function so its evaluation can be omitted if a non-repeated value is already available in this.data
        let streams = () => this.getAncestors().map(proto => proto.entriesRaw(prop))

        if (schemaless) entries = concat(streams().map(stream => [...stream]))
        else {
            let schema = this.getSchema().get(prop)
            if (!schema) throw new Error(`not in schema: '${prop}'`)

            if (!schema.isRepeated() && !schema.isCompound() && this.data.has(prop))
                entries = [this.data.getEntry(prop)]                        // non-repeated value is present in `this`, can skip inheritance to speed up
            else
                entries = schema.combineStreams(streams(), this)            // `default` or `impute` property of the schema may be applied here

            this._dataAll.set(prop, entries)
        }
        yield* entries
    }

    *entriesRaw(prop = undefined) {
        /* Generate a stream of own entries (from this.data) for a given property(s). No inherited/imputed entries.
           `prop` can be a string, or an array of strings, or undefined. The entries preserve their original order.
         */
        this.assertData()
        yield* this.data.readEntries(prop)
    }

    object(first = true) {
        /* Return this.data converted to a plain object. For repeated keys, only one value is included:
           the first one if first=true (default), or the last one, otherwise.
           TODO: for repeated keys, return a sub-object: {first, last, all} - configurable in schema settings
          */
        this.assertLoaded()
        let obj = this.data.object(first)
        obj.__item__ = this
        return obj
    }

    getAncestors() {
        /* Linearized list of all ancestors, with `this` at the first position.
           TODO: use C3 algorithm to preserve correct order (MRO, Method Resolution Order) as used in Python:
           https://en.wikipedia.org/wiki/C3_linearization
           http://python-history.blogspot.com/2010/06/method-resolution-order.html
         */
        let ancestors = this.getPrototypes().map(proto => proto.getAncestors())
        return [this, ...unique(concat(ancestors))]
    }

    getPrototypes()     { return this.data.getValues('prototype') }


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
        let cat = this.category?.getName() || ""
        if (max_len && cat.length > max_len) cat = cat.slice(max_len-3) + ellipsis
        if (html) {
            cat = escape_html(cat)
            let url = this.category?.url()
            if (url) cat = `<a href="${url}">${cat}</a>`          // TODO: security; {url} should be URL-encoded or injected in a different way
        }
        let stamp = cat ? `${cat}:${this.id}` : `${this.id}`
        if (!brackets) return stamp
        return `[${stamp}]`
    }

    getSchema() {
        /* Return schema of this item (instance of DATA), or of a particular `field`. */
        // return this.prop('schema')
        return this.category?.getItemSchema() || new DATA_GENERIC()
        // return field !== undefined ? schema.get(field) : schema
    }

    // getSchema(path = null) {
    //     /* Return schema of this item (instance of DATA), or of a given `path` inside nested catalogs,
    //        as defined in this item's category's `fields` property. */
    //     let schema = this.category.getItemSchema()
    //     if (!path?.length) return schema
    //
    //     assert(false, 'getSchema() is never used with an argument')
    //
    //     this.assertLoaded()
    //     let keys = [], data = this.data
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

    // getHandlers()   { return T.inheritedMerge(this.constructor, 'handlers') }

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
        /* Dump this.data to a JSON string using schema-aware (if schema=true) encoding of nested values. */
        return JSONx.stringify(this.data)
    }
    record() {
        /* JSON-serializable representation of the item's content as {id, data: encoded(data)}. */
        assert(this.has_id())
        return {id: this.id, data: this.data}
    }
    recordEncoded() {
        return JSONx.encode(this.record())
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
            app.assertLoaded()
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
        if (!node.isLoaded) await node.load()
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
            if (!node.isLoaded) await node.load()
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
        // ;[entry, subpath] = this.data.route(request.path)
        // if (subpath) throw new Error(`path not found: ${subpath}`)
        //     // if (entry.value instanceof Item) return entry.value.handle(request.move(subpath), session)
        //     // else throw new Error(`path not found: ${subpath}`)
    }

    handle(request) {
        /*
        Serve a web or internal `request` by executing a handler method of `this` that implements
        a given web method (request.method). A default web method is selected if request.method is missing.

        The handler's name has a form of:    `{request.type}_{request.method}`
        and is called with the arguments:    function handler({request, req, res, args}),
        `this` is bound to the target item.

        Query parameters are passed in `req.query`, as:
        - a string if there's one occurrence of PARAM in a query string,
        - an array [val1, val2, ...] if PARAM occurs multiple times.
        A handler function can directly write to the response, and/or return a string that will be appended.
        The function can return a Promise (async function). It can have an arbitrary name, or be anonymous.

        Each handler MUST be declared in the `handlers` property of this item's category,
        otherwise it won't be recognized. The default list of handlers for an Item is defined below,
        after Item class definition.
        */
        request.item = this
        if (request.path) return this.handlePartial(request)

        let httpMethod = request.type
        let {session, methods: endpoints} = request
        if (!endpoints.length) endpoints = ['default']

        endpoints = endpoints.map(p => `${httpMethod}/${p}`)        // convert short endpoints to full endpoints
        // print('methods:', methods)

        if (session) {
            session.item = this
            if (request.app) session.app = request.app
        }

        for (let endpoint of endpoints) {
            let context = new RequestContext({request, endpoint})
            let service = this.net.resolve(endpoint)
            if (service) return service.server(this, context)
        }

        request.throwNotFound(`no service found for [${endpoints}]`)
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
                let cache = this._methodCache                       // here, `this` is an Item instance
                while (args.length && args[args.length-1] === undefined)
                    args.pop()                                      // drop trailing `undefined` arguments
                if (args.length) return fun.call(this, ...args)     // here and below, `this` is an Item instance
                if (cache.has(name)) return cache.get(name)         // print(`${name}() from _methodCache`)

                let value = fun.call(this)
                if (value instanceof Promise)                       // for async methods store the final value when available
                    value.then(v => cache.set(name, v))             // to speed up subsequent access (no waiting for promise)

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
// The first argument, `ctx`, is a RequestContext instance, followed by action-specific list
// of arguments. In a special case when an action is called directly on the server through item.action.XXX(),
// `ctx` is {}, which can be a valid argument for some actions - supporting this type
// of calls is NOT mandatory, though.

Item.createAPI(
    {
        // http endpoints...

        'GET/default':  new ItemAdminPage(),            // TODO: add explicit support for aliases
        'GET/item':     new ItemAdminPage(),

        'CALL/default': new InternalService(function() { return this }),
        'CALL/item':    new InternalService(function() { return this }),
        'GET/json':     new JsonService(function() { return this.recordEncoded() }),

        // item's edit actions for use in the admin interface...
        'POST/edit':  new TaskService({

            delete_self(ctx)   { return this.registry.db.delete(this) },

            insert_field(ctx, path, pos, entry) {
                // if (entry.value !== undefined) entry.value = this.getSchema([...path, entry.key]).decode(entry.value)
                if (entry.value !== undefined) entry.value = JSONx.decode(entry.value)
                this.data.insert(path, pos, entry)
                return this.registry.db.update_full(this)
            },

            delete_field(ctx, path) {
                this.data.delete(path)
                return this.registry.db.update_full(this)
            },

            update_field(ctx, path, entry) {
                // if (entry.value !== undefined) entry.value = this.getSchema(path).decode(entry.value)
                if (entry.value !== undefined) entry.value = JSONx.decode(entry.value)
                this.data.update(path, entry)
                return this.registry.db.update_full(this)
            },

            move_field(ctx, path, pos1, pos2) {
                this.data.move(path, pos1, pos2)
                return this.registry.db.update_full(this)
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

    init() { return this._initSchema() }

    async _initSchema() {
        // initialize schema objects inside `fields`; in particular, SchemaWrapper class requires
        // explicit async initialization to load sublinked items

        // TODO: move initialization somewhere else; here, we don't have a guarantee that the
        //       initialized schema object won't get replaced with a new one at some point

        for (const entry of this.entriesRaw('fields')) {
            let fields = entry.value
            let calls  = fields.map(({value: schema}) => schema.init()).filter(res => res instanceof Promise)
            if (calls.length) await Promise.all(calls)
        }
    }

    async new(data, iid) {
        /*
        Create a newborn item of this category (not yet in DB) and set its `data`; connect it with this.registry;
        set its IID if given. The order of `data` and `iid` arguments can be swapped.
        */
        if (typeof data === 'number') [data, iid] = [iid, data]
        assert(data)
        if (!(data instanceof Data)) data = new Data(data)
        data.set('__category__', this)
        return Item.createBooted(this.registry, iid, {data})
    }

    async getItemClass() {
        /* Return the dynamically created class to be used for items of this category. */
        // below, module.Class is subclassed to allow safe addition of a static .category attribute,
        // even when several categories share the `base` class, so each one needs a different value of .category
        let module = await this.getModule()
        let base = module.Class
        let name = `${base.name}`
        let cls = {[name]: class extends base {}}[name]
        let _category = T.getOwnProperty(cls, 'category')
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
            if (!classPath) throw new Error(`missing 'class_path' property for a core category: ${this.id_str}`)
            if (this._hasCustomCode()) throw new Error(`dynamic code not allowed for a core category: ${this.id_str}`)
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
            print(`ERROR when parsing dynamic code for category ${this.id_str}, will use a default class instead. Cause:\n`, ex)
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
        let name = this.prop('class_name') || `Class_${this.id}`
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
    //     let className = (name) => `Handler_${this.id}_${name}`
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

Category.createAPI(
    {
        'GET/default':  new CategoryAdminPage(),            // TODO: add explicit support for aliases
        'GET/item':     new CategoryAdminPage(),

        'GET/import':   new HttpService(function ({request})
        {
            /* Send JS source code of this category with a proper MIME type to allow client-side import(). */
            this._checkPath(request)
            request.res.type('js')
            request.res.send(this.getSource())
        }),

        'GET/scan':     new HttpService(async function ({request})
        {
            /* Retrieve all children of this category and send to client as a JSON array.
               TODO: set a size limit & offset (pagination).
               TODO: let declare if full items (loaded), or meta-only, or naked stubs should be sent.
             */
            let items = []
            for await (const item of this.registry.scan(this)) {
                await item.load()
                items.push(item)
            }
            let records = items.map(item => item.recordEncoded())
            request.res.json(records)
        }),

        'POST/edit':  new TaskService({
            async create_item(ctx, dataState) {
                /* Create a new item in this category based on request data. */
                let data = await (new Data).__setstate__(dataState)
                let item = await this.new(data)
                await this.registry.db.insert(item)
                return item.recordEncoded()
                // TODO: check constraints: schema, fields, max lengths of fields and of full data - to close attack vectors
            },
        }, //{encodeResult: false}    // avoid unnecessary JSONx-decoding by the client before putting the record in client-side DB
        ),
    },
    {
        // actions...
        create_item:    ['POST/edit', 'create_item'],
    }
)


/**********************************************************************************************************************/

export class RootCategory extends Category {

    id = ROOT_ID
    expiry = 0                                  // never evict from Registry

    get category() { return this }              // root category is a category for itself

    _initClass() {}                             // RootCategory's class is already set up, no need to do anything more

    getItemSchema() {
        /* In RootCategory, this == this.category, and to avoid infinite recursion we must perform
           schema inheritance manually (without this.prop()).
         */
        let root_fields = this.data.get('fields')
        let default_fields = root_fields.get('fields').props.default
        let fields = new Catalog(root_fields, default_fields)
        let custom = this.data.get('allow_custom_fields')
        return new DATA({fields: fields.object(), strict: custom !== true})
    }
}

RootCategory.setCaching('getItemSchema')


/**********************************************************************************************************************/

globalThis.Item = Item              // Item class is available globally without import, for dynamic code
