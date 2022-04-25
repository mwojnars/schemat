import { Resources, ReactDOM } from './resources.js'
import {
    e, useState, useRef, delayed_render, NBSP, DIV, A, P, H1, H2, H3, SPAN, FORM, INPUT, FIELDSET,
    TABLE, TH, TR, TD, TBODY, BUTTON, FRAGMENT, HTML, fetchJson
} from './react-utils.js'
import {print, assert, T, escape_html, ItemDataNotLoaded, ItemNotLoaded, ServerError, dedentFull, splitLast, BaseError} from './utils.js'
import { Catalog, Data } from './data.js'
// import { generic_schema, DATA } from './type.js'

export const ROOT_CID = 0
export const SITE_CID = 1

// import * as utils from 'http://127.0.0.1:3000/system/local/utils.js'
// import * as utils from 'file:///home/marcin/Documents/priv/catalog/src/schemat/utils.js'
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
    /* Custom representation of a web request (.session defined) or internal request (no .session).
       The "web method" (.method) is mapped to a "class method" (a "handler") of a target item
       by prepending the {request.type}_ to its name.
     */

    static SEP_ROUTE  = '/'         // separator of route segments in URL paths
    static SEP_METHOD = '@'         // separator of a method name within a URL path

    static NotFound = class extends BaseError {
        static message = "URL path not found"
    }

    type            // CALL, GET, POST, (SOCK in the future); request type; there are different handler functions for different request types
    session         // Session object; only for top-level web requests (not for internal requests)
    pathFull        // initial path, trailing @method removed; stays unchanged during routing (no truncation)
    path            // remaining path to be consumed by subsequent nodes along the route;
                    // equal pathFull at the beginning, it gets truncated while the routing proceeds

    args            // dict of arguments for the handler function; taken from req.query (if a web request) or passed directly (internal request)
    methods = []    // names of access methods to be tried for a target item; the 1st method that's present on the item will be used, or 'default' if `methods` is empty

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
        let req = T.clone(this)
        req.methods = [...this.methods]
        return req
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

    throwNotFound(msg, args)  { throw new Request.NotFound(msg, args || {'path': this.pathFull, 'remaining': this.path}) }
}


/**********************************************************************************************************************
 **
 **  ITEM & CATEGORY
 **
 */

export class Item {

    /*
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

    static CODE_DOMAIN = 'schemat'      // domain name to be prepended in source code identifiers of dynamically loaded code


    cid             // CID (Category ID) of this item; can be undefined, null not allowed
    iid             // IID (Item ID within a category) of this item; can be undefined, null not allowed

    data            // data fields of this item, as a Data object; can hold a Promise, so it always should be awaited for,
                    // or accessed after await load(), or through item.get()

    jsonData        // JSON string containing encoded .data as loaded from DB during last load(); undefined in a newborn item

    // db           // database, element of a DB stack, where this item was read from; undefined in newborn items;
    //              // updates are first sent to this DB, and only propagated to a higher-level DB if necessary

    //metadata      // system properties: current version, category's version, status etc.

    category        // parent category of this item, as an instance of Category
    registry        // Registry that manages access to this item
    expiry          // timestamp [ms] when this item should be evicted from Registry.cache; 0 = NEVER, undefined = immediate

    editable        // true if this item's data can be modified through .edit(); editable item may contain uncommitted changes,
                    // hence it should NOT be used for reading

    cache = new Map()       // cache of values of methods configured for caching in Item.setCaching(); values can be promises

    static __transient__ = ['cache']

    get id()        { return [this.cid, this.iid] }
    get id_str()    { return `[${this.cid},${this.iid}]` }
    get schema()    { return this.getSchema() }

    isLoading           // holds the Promise created at the start of reload() and fulfilled when load() completes
    get isLoaded()      { return this.data && !this.isLoading }         // false if still loading, even if .data has already been created (but not fully initialized)
    get isShadow()      { return this.cid === undefined }
    get isCategory()    { return this.cid === ROOT_CID }

    has_id(id = null) {
        if (id) return this.cid === id[0] && this.iid === id[1]
        return (this.cid || this.cid === 0) && (this.iid || this.iid === 0)
    }

    assertData()    { if (!this.data) throw new ItemDataNotLoaded(this) }   // check that .data is loaded, but maybe not fully initialized yet
    assertLoaded()  { if (!this.isLoaded) throw new ItemNotLoaded(this) }

    // get newborn()   { return this.iid === null }
    // has_data()      { return !!this.data }

    static orderAscID(item1, item2) {
        /* Ordering function that orders items by ascending ID. Can be passed to array.sort() to sort items, stubs,
           OR {id, ...} records, OR {cid, iid, ...} records. */
        let {id: id1, cid: cid1, iid: iid1} = item1
        let {id: id2, cid: cid2, iid: iid2} = item2
        if (id1) [cid1, iid1] = id1
        if (id2) [cid2, iid2] = id2
        if ((cid1 < cid2) || (cid1 === cid2 && iid1 < iid2)) return -1
        if (cid1 === cid2 && iid1 === iid2) return 0
        return 1
    }

    static createStub(id, registry) {
        /* Create a "stub" item of a given ID whose content can be loaded later on from DB with load().
           The item is unloaded and usually NO specific class is attached yet.
         */
        let item = new this()
        let [cid, iid] = id
        item.cid = cid
        item.iid = iid
        item.registry = registry
        return item
    }
    // static async createShadow(data) {
    //     /* Create an "unlinked" item that has `data` but no ID. The item has limited functionality: no load/save/transfer,
    //        no category, registry etc. The item returned is always *booted* (this.data is present, can be empty).
    //      */
    //     let item = new this()
    //     await item.boot(data)
    //     return item
    // }
    static async createNewborn(category, data, iid) {
        /* Create a "newborn" item that has a category & CID assigned, and is intended for insertion to DB.
           Arguments `data` and `iid` are optional. The item returned is *booted* (this.data is present, can be empty).
         */
        let item = new Item(category)
        if (iid !== null) item.iid = iid
        return item.reload({data})
    }
    static async createLoaded(category, iid, jsonData) {
        let item = new Item(category)
        item.iid = iid
        return item.isLoading = item.reload({jsonData})
    }

    constructor(category = null) {
        /* To set this.data, boot() must be called and awaited (!) separately after this constructor. */
        if (category) {
            this.category = category
            this.registry = category.registry
            this.cid      = category.iid
        }
    }

    async load(opts = {}) {
        /* Load full data of this item (this.data) if not loaded yet. Return this object. */
        // if field !== null && field in this.isLoaded: return      // this will be needed when partial loading from indexes is available
        // if (this.data) return this.data         //field === null ? this.data : T.getOwnProperty(this.data, field)
        if (this.isLoaded) return this
        if (this.isLoading) return this.isLoading       // loading has already started, should wait rather than load again
        return this.reload(opts)                        // keep a Promise that will eventually load this item's data to avoid race conditions
    }

    async reload(opts = {}) {
        if (this.isLoading) await this.isLoading        // wait for a previous reload to complete; this is only needed when called directly, not through load()
        return this.isLoading = this.boot(opts)         // keep a Promise that will eventually load this item's data to avoid race conditions
    }

    async boot(opts = {}) {
        /* (Re)initialize this item. Load this.data from a DB, or from a JSON-encoded string, opts.jsonData, or take from opts.data.
           Set up the class and prototypes. Call init().
           Boot options (opts): {use_schema, jsonData, data}
         */
        if (!this.category) {                               // initialize this.category
            assert(!T.isMissing(this.cid))
            this.category = await this.registry.getCategory(this.cid)
        }
        else if (!this.category.isLoaded && this.category !== this)
            await this.category.load()

        this.data = opts.data || await this._loadData(opts)
        if (!(this.data instanceof Data)) this.data = new Data(this.data)

        let proto = this.initPrototypes()                   // load prototypes
        if (proto instanceof Promise) await proto

        this.setExpiry(this.category.get('cache_ttl'))
        this._mod_type = await import('./type.js')          // to allow synchronous access to DATA and generic_schema in other methods later on

        await this.initClass()                              // set the target JS class on this object; stubs only have Item as their class, which must be changed when the item is loaded and linked to its category

        let init = this.init()                              // optional custom initialization after the data is loaded
        if (init instanceof Promise) await init             // must be called BEFORE this.data=data to avoid concurrent async code treat this item as initialized

        this.isLoading = false
        return this
    }
    // async boot() {
    //     /* Initialize item's data (this.data) from `data`. If `data` is missing, this.data is set to empty.
    //        In any case, the item and its .data is initialized ("booted") after this method completes.
    //      */
    //     this._mod_type = await import('./type.js')      // to allow synchronous access to DATA and generic_schema in other methods
    //
    //     await this.initClass()
    //
    //     let init = this.init()                          // optional custom initialization after the data is loaded
    //     if (init instanceof Promise) await init         // must be called BEFORE this.data=data to avoid concurrent async code treat this item as initialized
    //     return this
    // }

    async _loadData({use_schema = true, jsonData} = {}) {
        if (jsonData === undefined) jsonData = await this._loadDataJson()
        let schema = use_schema ? this.category.getItemSchema() : (await import('./type.js')).generic_schema
        let state = JSON.parse(this.jsonData = jsonData)
        return schema.decode(state)
    }
    async _loadDataJson() {
        if (!this.has_id()) throw new Error(`trying to reload an item with missing or incomplete ID: ${this.id_str}`)
        return this.registry.loadData(this.id)
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
        for (const p of prototypes)
            if (p.cid !== this.cid) throw new Error(`item ${this} belongs to a different category than its prototype (${p})`)
        prototypes = prototypes.filter(p => !p.isLoaded)
        if (prototypes.length === 1) return prototypes[0].load()            // performance: trying to avoid unnecessary awaits or Promise.all()
        if (prototypes.length   > 1) return Promise.all(prototypes.map(p => p.load()))
    }

    async initClass() {
        /* Initialize this item's class, i.e., substitute the object's temporary Item class with an ultimate subclass. */
        if (this.category === this) return          // special case for RootCategory: its class is already set up, prevent circular deps
        let module = await this.category.getModule()
        T.setClass(this, module.Class)              // change the actual class of this item from Item to the category's proper class
    }

    init() {}
        /* Optional category-specific initialization after this.data is loaded.
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

    get(path, opts = {}) {
        /* If opts.pure is true, the `path` is first searched for in `this` and `this.constructor`, only then in this.data. */

        if (this.isShadow) {     // if (opts.pure) {
            assert(!this.data, 'this.data not allowed in a shadow item')
            if (this[path] !== undefined) return this[path]
            if (this.constructor[path] !== undefined) return this.constructor[path]
            return opts.default
            // if (this.isShadow && !this.has_data()) return opts.default
        }

        this.assertData()

        // search in this.data
        let value = this.data.findValue(path)
        if (value !== undefined) return value

        // search in prototypes
        for (const proto of this.getPrototypes()) {
            value = proto.get(path)
            if (value !== undefined) return value
        }

        // search in category's defaults
        if (this.category && this.category !== this) {
            let cat_default = this.category.getDefault(path)
            if (cat_default !== undefined)
                return cat_default
        }

        return opts.default
    }

    getPrototypes()     { return this.data.getValues('prototype') }

    async getLoaded(path) {
        /* Retrieve a related item identified by `path` and load its data, then return this item. Shortcut for get+load. */
        let item = this.get(path)
        if (item !== undefined) await item.load()
        return item
    }

    getMany(key, {inherit = true, reverse = true} = {}) {
        /* Return an array (possibly empty) of all values assigned to a given `key` in this.data.
           Default value (if defined) is NOT included. Values from prototypes are included if inherit=true,
           in such case, the order of prototypes is preserved, with `this` included at the beginning (reverse=false);
           or the order is reversed, with `this` included at the end of the result array (reverse=true, default).
           The `key` can be an array of keys.
         */
        this.assertLoaded()

        if (typeof key === 'string') key = [key]
        let own = this.data.getValues(...key)
        if (!inherit) return own

        let inherited = this.getPrototypes().map(p => p.getMany(key, {inherit, reverse}))
        if (!inherited.length) return own

        // WARN: this algorithm produces duplicates when multiple prototypes inherit from a common base object
        let values = []
        inherited = [own, ...inherited]
        if (reverse) inherited.reverse()
        for (const vals of inherited) values.push(...vals)
        return values
    }

    getSubset(...paths) {
        /* Call .get() for multiple fields/paths, combine the results and return as an object with paths as keys.
           The result may include a default value if one was defined for a particular field.
         */
        let subset = {}
        for (let path of paths) {
            let value = this.get(path)
            if (value !== undefined) subset[path] = value
        }
        return subset
    }

    mergeSnippets(key, params) {
        /* Calls getMany() to find all entries with a given `key` including the environment-specific
           {key}_client OR {key}_server keys; assumes the values are strings.
           Returns \n-concatenation of the strings found. Used internally to retrieve & combine code snippets. */
        let env = this.registry.onServer ? 'server' : 'client'
        let snippets = this.getMany([key, `${key}_${env}`], params)
        return snippets.join('\n')
    }

    getInherited(field) {
        /* Like .get(field), but for a field holding a Catalog that needs to be merged with the catalogs inherited
           from prototypes + the schema's default catalog for this field.
           It's assumed that the catalogs have unique non-missing keys.
           If a key occurs multiple times, its FIRST occurrence is used (closest to `this`).
           A possibly better method for MRO (Method Resolution Order) is C3 used in Python3:
           https://en.wikipedia.org/wiki/C3_linearization
           http://python-history.blogspot.com/2010/06/method-resolution-order.html
         */
        let catalogs = [this, ...this.getPrototypes()].map(proto => proto.get(field))
        let schemas  = (this === this.category) ? this.get('fields') : this.category.getFields()    // special case for RootCategory to avoid infinite recursion: getFields() calls getInherited()
        let default_ = schemas.get(field).get('default')
        catalogs.push(default_)
        return Catalog.merge(...catalogs)
    }

    getName() { return this.get('name') || '' }
    getPath() {
        /* Default import path of this item. Starts with '/' (absolute path). */
        return this.get('path') || this.registry.site.systemPath(this)
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
        let cat = this.category.getName(this.cid.toString())
        if (max_len && cat.length > max_len) cat = cat.slice(max_len-3) + ellipsis
        if (html) {
            cat = escape_html(cat)
            let url = this.category.url()
            if (url) cat = `<a href="${url}">${cat}</a>`          // TODO: security; {url} should be URL-encoded or injected in a different way
        }
        let stamp = `${cat}:${this.iid}`
        if (!brackets) return stamp
        return `[${stamp}]`
    }
    getSchema(path = null) {
        /* Return schema of this item (instance of DATA), or of a given `path` inside nested catalogs,
           as defined in this item's category's `fields` property. */
        let schema = this.category.getItemSchema()
        if (!path || !path.length) return schema

        this.assertLoaded()
        let keys = [], data = this.data
        for (let step of path) {
            assert(data instanceof Catalog)
            let entry = data.getEntry(step)                     // can be undefined for the last step of `path`
            keys.push(typeof step === 'number' ? entry.key : step)
            data = entry?.value
        }
        return schema.find(keys)
    }

    encodeData(use_schema = true) {
        /* Encode this.data into a JSON-serializable dict composed of plain JSON objects only, compacted. */
        this.assertLoaded()
        let schema = use_schema ? this.getSchema() : this._mod_type.generic_schema
        return schema.encode(this.data)
    }
    dumpData(use_schema = true, compact = true) {
        /* Dump this.data to a JSON string using schema-aware (if schema=true) encoding of nested values. */
        let state = this.encodeData(use_schema)
        return JSON.stringify(state)
    }
    encodeSelf(use_schema = true) {
        /* Encode this item's data & metadata into a JSON-serializable dict; `registry` and `category` excluded. */
        assert(this.has_id())
        return {id: this.id, data: this.encodeData(use_schema)}
    }

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

    /***  Editing item's data  ***/

    async getEditable() {
        /* DRAFT. Make a copy of this Item object and extend it with methods from EditableItem. */
        return this.registry.getEditable(this.id)
        // let item = T.clone(this)
        // if (this.data) item.data = new Data(await this.data)
        // return item
    }

    edit(...edits) {
        this.editable = true    // TODO...
        if (!this.editable) throw new Error("this item is not editable")
        for (let [edit, args] of edits) {
            print('edit: ', [edit, args])
            this[`_edit_${edit}`].call(this, ...args)
        }
    }

    _edit_insert(path, pos, entry) {
        if (entry.value !== undefined) entry.value = this.getSchema([...path, entry.key]).decode(entry.value)
        this.data.insert(path, pos, entry)
    }
    _edit_delete(path) {
        this.data.delete(path)
    }
    _edit_update(path, entry) {
        if (entry.value !== undefined) entry.value = this.getSchema(path).decode(entry.value)
        this.data.update(path, entry)
    }
    _edit_move(path, pos1, pos2) {
        this.data.move(path, pos1, pos2)
    }

    async POST_edit({req, res}) {
        /* Web handler for all types of edits of this.data. */
        let edits = req.body
        assert(edits instanceof Array)
        this.edit(...edits)
        let out = await this.registry.update(this)
        return res.json(out || {})
    }

    async remote_edit_insert(path, pos, entry)   {
        /* `entry.value` must have been schema-encoded already (!) */
        // if (entry.value !== undefined) entry.value = this.getSchema([...path, pos]).encode(entry.value)
        return this.remote('edit', [['insert', [path, pos, entry]]])
    }
    async remote_edit_delete(path)   {
        return this.remote('edit', [['delete', [path]]])
    }
    async remote_edit_update(path, entry)   {
        /* `entry.value` must have been schema-encoded already (!) */
        // if (entry.value !== undefined) entry.value = this.getSchema(path).encode(entry.value)
        return this.remote('edit', [['update', [path, entry]]])
    }
    async remote_edit_move(path, pos1, pos2) {
        return this.remote('edit', [['move', [path, pos1, pos2]]])
    }

    async POST_delete({res}) {
        await this.registry.delete(this)
        return res.json({})
    }

    async remote_delete()       { return this.remote('delete') }

    async remote(endpoint, data, {args, params} = {}) {
        /* Connect from client to an @endpoint of an internal API using HTTP POST by default;
           send `data` if any; return a response body parsed from JSON to an object.
         */
        let url = this.url(endpoint)
        let res = await fetchJson(url, data, params)        // Response object
        if (!res.ok) throw new ServerError(res)
        return res.json()
        // let txt = await res.text()
        // return txt ? JSON.parse(txt) : undefined
        // throw new Error(`server error: ${res.status} ${res.statusText}, response ${msg}`)
    }

    /***  Client-server communication protocols (operation chains)  ***/

    // delete = Protocol({
    //     onclient:  async function () {},         // bound to `delete` when called on client
    //     onserver:  async function () {},         // bound to `delete` when called on a web app process, or a db process
    //     onfront:   async function () {},   (web handler)
    //     onback:    ...                     (db handler)
    // })

    /***  Routing & handling requests (server side)  ***/

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
            if (ex instanceof Request.NotFound && strategy === 'last')
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
        */
        if (request.path) return this.handlePartial(request)

        let req, res
        let {session, methods} = request
        if (!methods.length) methods = ['default']   // methods = this.category.getMany('default_view', {reverse:false})
        // print('methods:', methods)

        if (session) {
            session.item = this
            if (request.app) session.app = request.app
            ;[req, res] = session.channels
        }

        for (let method of methods) {
            let hdl_name = `${request.type}_${method}`
            let handler  = this[hdl_name]
            if (handler) return handler.call(this, {request, req, res})

            if (`VIEW_${method}` in this) {
                session.view = method
                return this.page({request, view: method})
            }
        }

        request.throwNotFound(`no handler found for the @-access method(s): ${methods}`)
    }

    page({title, head, body, request, view} = {}) {
        /* Generate an HTML page to be sent as a response for a GET request;
           fill the page with HTML contents rendered from a view function (React functional component).
           The `view` name should point to a method VIEW_{view} of the current Item's subclass.
         */
        if (title === undefined) {
            let name = this.getName()
            let ciid = this.getStamp({html: false})
            title = `${name} ${ciid}`
        }
        if (head === undefined) head = this.category.getAssets().renderAll()
        if (body === undefined) body = `
            <p id="data-session" style="display:none">${btoa(encodeURIComponent(JSON.stringify(request.session.dump())))}</p>
            <div id="react-root">${this.render(view)}</div>
            <script async type="module"> import {boot} from "/system/local/client.js"; boot('${view}'); </script>
        `
        return dedentFull(`
            <!DOCTYPE html><html>
            <head>
                <title>${title}</title>
                ${Resources.clientAssets}
                ${head}
            </head>`) +
            `<body>${body}</body></html>`
    }

    render(view, targetElement = null) {
        /* Render this item's `view` (name) into an HTMLElement (client-side) if `targetElement` is given,
           or to a string (server-side) otherwise. When rendering server-side, useEffect() & delayed_render() do NOT work,
           so only a part of the HTML output is actually rendered. For workaround, see:
            - https://github.com/kmoskwiak/useSSE  (useSSE, "use Server-Side Effect" hook)
            - https://medium.com/swlh/how-to-use-useeffect-on-server-side-654932c51b13
            - https://dev.to/kmoskwiak/my-approach-to-ssr-and-useeffect-discussion-k44
         */
        this.assertLoaded()
        if (!targetElement) print(`SSR render() of ${this.id_str}`)
        view = this[`VIEW_${view}`]
        view = view.bind(this)
        return targetElement ? ReactDOM.render(e(view), targetElement) : ReactDOM.renderToString(e(view))
        // might use ReactDOM.hydrate() not render() in the future to avoid full re-render client-side ?? (but render() seems to perform hydration checks as well)
    }

    /***  Handlers & Components  ***/

    CALL_default()      { return this }         // internal url-calls return the target item (an object) by default
    CALL_item()         { return this }
    GET_json({res})     { res.sendItem(this) }

    VIEW_default(props) { return this.VIEW_admin(props) }

    VIEW_admin({extra = null}) {
        /* Detailed (admin) view of an item. */
        return DIV(
            // e(MaterialUI.Box, {component:"span", sx:{ fontSize: 16, mt: 1 }}, 'MaterialUI TEST'),
            // e(this._mui_test),
            e(this.Title.bind(this)),
            H2('Properties'),
            e(this.DataTable.bind(this)),
            extra,
        )
    }
    // _mui_test() {
    //     return e(MaterialUI.Box, {component:"span", sx:{ fontSize: 16, mt: 1 }}, 'MaterialUI TEST')
    //     // WARN: when _mui_test() is used repeatedly in Page, a <style> block is output EACH time (!!!)
    //     //       A class name of the form .css-HASH is assigned, where HASH is a stable 6-letter hash of the styles
    // }

    Title() {
        let name = this.getName()
        let ciid = this.getStamp()
        if (name)
            return H1(name, ' ', SPAN({style: {fontSize:'40%', fontWeight:"normal"}, ...HTML(ciid)}))
        else
            return H1(HTML(ciid))
    }

    DataTable() {
        /* Display this item's data as a DATA.Widget table with possibly nested Catalog objects. */
        // let changes = new Changes(this)
        return FRAGMENT(
                this.getSchema().displayTable({item: this}),
                // e(changes.Buttons.bind(changes)),
            )
    }

    static setCaching(...methods) {
        /* In the class'es prototype, replace each method from `methods` with cached(method) wrapper.
           The wrapper utilizes the `cache` property of an Item instance to store cached values.
           NOTE: the value is cached and re-used only when the method was called without arguments;
                 otherwise, the original method is executed on each and every call.
         */
        const cached = (name, fun) => {
            function cachedMethod(...args) {
                while (args.length && args[args.length-1] === undefined)
                    args.pop()                                          // drop trailing `undefined` arguments
                if (args.length) return fun.call(this, ...args)         // here and below, `this` is an Item instance
                if (this.cache.has(name)) return this.cache.get(name)   // print(`${name}() from cache`)
                let value = fun.call(this)
                this.cache.set(name, value)             // may store a promise (!)
                return value                            // may return a promise (!), the caller should be aware
            }
            Object.defineProperty(cachedMethod, 'name', {value: `${name}_cached`})
            cachedMethod.isCached = true                // for detection of an existing wrapper, to avoid repeated wrapping
            return cachedMethod
        }
        for (const name of methods) {
            let fun = this.prototype[name]              // here, `this` is the Item class or its subclass
            if (fun && !fun.isCached)
                this.prototype[name] = cached(name, fun)
        }
    }
}

Item.setCaching('getPrototypes', 'getPath', 'render')


/**********************************************************************************************************************/

// class EditableItem extends Item {
//     /* A set of methods appended through monkey-patching to an item object to make it editable (see Item.editable()).
//        Edit methods should be synchronous. They can assume this.data is already loaded, no need for awaiting.
//      */
//
//     actions         // list of edit actions executed on this item so far; submitted to DB on commit for DB-side replay
//
//     edit(action, args) {
//         let method = this[`_edit_${action}`]
//         if (!method) throw new Error(`edit action "${action}" not found in ${this}`)
//         let result = method.bind(this)(args)
//         this.edits.push([action, args])
//         return result
//     }
//
//     push(key, value, {label, comment} = {}) {
//         /* Shortcut for edit('push', ...) */
//         return this.edit('push', {key, value, label, comment})
//     }
//     set(path, value, props) { this.data.set(path, value, props) }
//
//     _edit_push(entry) { return this.data.pushEntry(entry) }
//     _edit_set (entry) { return this.data.setEntry (entry) }
// }

/**********************************************************************************************************************/

export class Category extends Item {
    /*
    A category is an item that describes other items: their schema and functionality;
    also acts as a manager that controls access to and creation of new items within category.
    */

    async new(data = null, iid = null) {
        /*
        Create a newborn item of this category (not yet in DB); connect it with this.registry;
        set its IID if given. The order of `data` and `iid` arguments can be swapped.
        */
        if (typeof data === 'number') [data, iid] = [iid, data]
        return Item.createNewborn(this, data, iid)
        // let module = await this.getModule()
        // return module.Class.createNewborn(this, data, iid)
    }

    async getModule() {
        /* Parse the source code of this item (from getCode()) and return the module's namespace object.
           Set `path` as the module's path for the linking of nested imports in parseModule().
           If `path` is missing, the item's `path` property is used instead (if present),
           or the default path built from the item's ID on the site's system path.
         */
        let site = this.registry.site
        let onClient = this.registry.onClient

        if (!site) {
            // when booting up, a couple of core items must be created before registry.site becomes available
            let [path, name] = this.getClassPath()
            if (!path) throw new Error(`missing 'class_path' property for a core category: ${this.id_str}`)
            if (this._hasCustomCode()) throw new Error(`dynamic code not allowed for a core category: ${this.id_str}`)
            return {Class: await this.registry.importDirect(path, name || 'default')}
        }

        let path = this.getPath()
        if (onClient) return this.registry.import(path)

        let source = this.getCode()
        return site.parseModule(source, path)
    }

    getCode() {
        /* Combine all code snippets of this category, including inherited ones, into a module source code.
           Import the base class, create a Class definition from `class_body`, append view methods, export the new Class.
         */
        let name = this.get('class_name') || `Class_${this.cid}_${this.iid}`
        let base = this._codeBaseClass()
        let init = this._codeInit()
        let code = this._codeClass(name)
        let expo = `export {Base, Class, Class as ${name}, Class as default}`

        let snippets = [base, init, code, expo].filter(Boolean)
        return snippets.join('\n')
    }

    _hasCustomCode() { return this._codeInit() || this._codeBody() }  //this.get('class_body') || this.get('views')

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
        if (!body) return 'let Class = Base'
        let code = `class ${name} extends Base {\n${body}\n}`
        if (name !== 'Class') code += `\nlet Class = ${name}`
        let cache = this._codeCache()
        if (cache) code += '\n' + cache
        return code
    }
    _codeBody() {
        /* Source code of this category's dynamic Class body. */
        let body = this.mergeSnippets('class_body')

        // extend body with VIEW_* methods (`views`)
        let methods = []
        let views = this.getInherited('views')
        for (let {key: vname, value: vbody} of views)
            methods.push(`VIEW_${vname}(props) {\n${vbody}\n}`)

        return body + methods.join('\n')
    }
    _codeCache() {
        /* Source code of setCaching() statement for selected methods of a custom Class. */
        let cached = this.getMany('cached_methods')
        cached = cached.join(' ').replaceAll(',', ' ').trim()
        if (!cached) return ''
        cached = cached.split(/\s+/).map(m => `'${m}'`)
        return `Class.setCaching(${cached.join(',')})`
    }
    getClassPath() { return splitLast(this.get('class_path') || '', ':') }   // [path, name]

    getItem(iid) {
        /*
        Instantiate a stub of an Item and seed it with IID (the IID being present in DB, presumably, not checked),
        but do NOT load remaining contents from DB (lazy loading).
        */
        return this.registry.getItem([this.iid, iid])
    }

    getFields() {
        /* Catalog of all the fields allowed for items of this category, including the global-default and inherited ones. */
        return this.getInherited('fields')
    }
    // getHandlers() {
    //     /* Catalog of all the handlers available for items of this category, including the global-default and inherited ones. */
    //     return this.getInherited('handlers')
    // }
    getDefault(field) {
        /* Get default value of a field from category schema. Return undefined if no category default is configured. */
        this.assertLoaded()
        let fields = this.getFields()
        let schema = fields.get(field)
        return schema ? schema.get('default') : undefined
    }

    getItemSchema() {
        /* Get schema of items in this category (not the schema of self, which is returned by getSchema()). */
        let fields = this.getFields()
        return new this._mod_type.DATA(fields.asDict())
    }
    getAssets() {
        /* Dependencies: css styles, libraries, ... required by HTML pages of items of this category. Instance of Assets. */
        return this.getItemSchema().getAssets()
    }

    _checkPath(request) {
        /* Check if the request's path is compatible with the default path of this item. Throw an exception if not. */
        let path  = request.pathFull
        let dpath = this.getPath()              // `path` must be equal the default path of this item
        if (path !== dpath)
            throw new Error(`code of ${this} can only be imported through '${dpath}' path, not '${path}'; create a derived item/category on the desired path, or use an absolute import, or set the "path" property to the desired path`)
    }
    // CALL_import({request}) {
    //     /* Return this category's module object in response to an internal call. */
    //     this._checkPath(request)
    //     return this.getModule()
    // }
    GET_import({request, res}) {
        /* Send JS source code of this category with a proper MIME type configured. */
        this._checkPath(request)
        res.type('js')
        res.send(this.getCode())
    }

    async GET_scan({res}) {
        /* Retrieve all children of this category and send to client as a JSON.
           TODO: set a size limit & offset (pagination).
           TODO: let declare if full items (loaded), or meta-only, or naked stubs should be sent.
         */
        let items = []
        for await (const item of this.registry.scan(this)) {
            await item.load()
            items.push(item)
        }
        res.sendItems(items)
    }
    async POST_new({req, res}) {
        /* Web handler to create a new item in this category based on request data. */
        // print('request body:  ', req.body)
        // req.body is an object representing state of a Data instance, decoded from JSON by middleware
        let data = await (new Data).__setstate__(req.body)
        let item = await this.new(data)
        await this.registry.insert(item)
        // await this.registry.commit()
        res.sendItem(item)
        // TODO: check constraints: schema, fields, max lengths of fields and of full data - to close attack vectors
    }
    async remote_new(data)  { return this.remote('new', data) }

    Items({items, itemRemoved}) {
        /* A list (table) of items. */
        if (!items || items.length === 0) return null
        const remove = (item) => item.remote_delete().then(() => itemRemoved && itemRemoved(item))

        return delayed_render(async () => {
            let rows = []
            for await (const item of items) {
                await item.load()
                let name = item.getName() || item.getStamp({html:false})
                let url  = item.url()
                rows.push(TR(
                    TD(`${item.iid} ${NBSP}`),
                    TD(url !== null ? A({href: url}, name) : `${name} (no URL)`, ' ', NBSP),
                    TD(BUTTON({onClick: () => remove(item)}, 'Delete')),
                ))
            }
            return TABLE(TBODY(...rows))
        }, [items])
    }
    NewItem({itemAdded}) {

        let form = useRef(null)

        const setFormDisabled = (disabled) => {
            let fieldset = form.current?.getElementsByTagName('fieldset')[0]
            if (fieldset) fieldset.disabled = disabled
        }

        const submit = async (e) => {
            e.preventDefault()                  // not needed when button type='button', but then Enter still submits the form (!)
            let fdata = new FormData(form.current)
            setFormDisabled(true)               // this must not preceed FormData(), otherwise fdata is empty
            // fdata.append('name', 'another name')
            // let name = input.current.value
            // let json = JSON.stringify(Array.from(fdata))

            let data = new Data()
            for (let [k, v] of fdata) data.push(k, v)

            let record = await this.remote_new(data.__getstate__())      // TODO: validate & encode `data` through category's schema
            if (record) {
                form.current.reset()            // clear input fields
                this.registry.db.keep(record)
                let item = await this.registry.getItem(record.id)
                itemAdded(item)
            }
            setFormDisabled(false)
        }

        return FORM({ref: form}, FIELDSET(
            // LABEL('Name: ', INPUT({name: 'name'}), ' '),
            INPUT({name: 'name', placeholder: 'name'}),
            BUTTON({type: 'submit', onClick: submit}, 'Create Item'),
        ))
    }

    VIEW_admin({extra = null}) {
        const scan = () => this.registry.scan(this)         // returns an async generator that requires "for await"
        const [items, setItems] = useState(scan())                  // existing child items; state prevents re-scan after every itemAdded()

        const [newItems, setNewItems] = useState([])                // newly added items
        const itemAdded   = (item) => { setNewItems(prev => [...prev, item]) }
        const itemRemoved = (item) => { setNewItems(prev => prev.filter(i => i !== item)) }

        return super.VIEW_admin({item: this, extra: FRAGMENT(
            H2('Items'),
            e(this.Items, {items: items, itemRemoved: () => setItems(scan())}),
            H3('Add item'),
            e(this.Items, {items: newItems, itemRemoved}),
            e(this.NewItem.bind(this), {itemAdded}),
            extra,
        )})
    }
}

Category.setCaching('getModule', 'getCode', 'getFields', 'getItemSchema', 'getAssets')   //'getHandlers'


/**********************************************************************************************************************/

export class RootCategory extends Category {
    cid = ROOT_CID
    iid = ROOT_CID
    expiry = 0                                  // never evict from Registry

    constructor(registry) {
        super(null)
        this.registry = registry
        this.category = this                    // root category is a category for itself
    }
    encodeData(use_schema = false) {
        /* Same as Item.encodeData(), but use_schema is false to avoid circular dependency during deserialization. */
        return super.encodeData(false)
    }
    async reload(opts) {
        /* Same as Item.reload(), but use_schema is false to avoid circular dependency during deserialization. */
        return super.reload({...opts, use_schema: false})
    }
    async getModule() { return {Class: Category} }
}

/**********************************************************************************************************************/

// export class BuiltinItem extends Item {
//     /* Base class for builtin classes whose instances must behave like plain JS objects and like items at the same time. */
//
//     // __setstate__(state) {
//     //     Object.assign(this, state)
//     //     // this.data = new Data()
//     //     // await this.boot()
//     //     return this
//     // }
//
//     get(path, opts = {}) {
//         let {pure = true, ...rest} = opts               // set pure=true as a default in the options
//         return super.get(path, {pure, ...rest})
//     }
// }

/**********************************************************************************************************************/

globalThis.Item = Item              // Item class is available globally without import, for dynamic code
