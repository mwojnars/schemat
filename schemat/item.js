import { Resources, ReactDOM } from './resources.js'
import {
    e, useState, useRef, delayed_render, NBSP, DIV, A, P, H1, H2, H3, SPAN, FORM, INPUT, FIELDSET,
    TABLE, TH, TR, TD, TBODY, BUTTON, FRAGMENT, HTML, fetchJson
} from './react-utils.js'
import {print, assert, T, escape_html, ItemNotLoaded, ServerError, dedentFull, splitLast, BaseError} from './utils.js'
import { generic_schema, CATALOG, DATA } from './type.js'
import { Catalog, Data } from './data.js'

export const ROOT_CID = 0
export const SITE_CID = 1

// import * as utils from 'http://127.0.0.1:3000/local/utils.js'
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
//             BUTTON({id: 'reset' , className: 'btn btn-secondary', onClick: this.reset,  disabled: false}, 'Reset'), ' ',
//             BUTTON({id: 'submit', className: 'btn btn-primary',   onClick: this.submit, disabled: false}, 'Submit'),
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

    method          // optional name of a handler method to execute on the target item; configured by the caller
    args            // dict of arguments for the handler function; taken from req.query (if a web request) or passed directly (internal request)

    defaultMethods = []     // names of suggested handler methods to use if `method` is missing in the request,
                            // in the order of INCREASING priority (most important suggestions at the end);
                            // this array is only collected and used for requests of type=GET (!)

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
        this.path   = this.pathFull
        this.method = this._prepare(method) || meth
    }

    copy() {
        let req = T.clone(this)
        req.defaultMethods = [...this.defaultMethods]
        return req
    }

    _prepare(method) {
        if (!method) return method
        assert(method[0] === Request.SEP_METHOD, `method name must start with '${Request.SEP_METHOD}' (${method})`)
        return method.slice(1)
    }

    setDefaultMethod(...methods) {
        /* Append one or more method names to `defaultMethods`. The methods at the beginning have higher priority.
           Each name must start with '@' for easier detection of method names in a source code -
           this prefix is truncated when assigning to this.defaultMethods.
         */
        if (this.type !== 'GET') return
        for (const method of methods.reverse())
            this.defaultMethods.push(this._prepare(method))
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

    throwNotFound(msg, args) { throw new Request.NotFound(msg, args || {'remaining path': this.path}) }
}


/**********************************************************************************************************************
 **
 **  ITEM & CATEGORY
 **
 */

export class Item {

    /*
    TODO: Item.metadata
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


    cid = null      // CID (Category ID) of this item; cannot be undefined, only "null" if missing
    iid = null      // IID (Item ID within a category) of this item; cannot be undefined, only "null" if missing

    data            // data fields of this item, as a Data object; can hold a Promise, so it always should be awaited for,
                    // or accessed after await load(), or through item.get()
    metadata        // system properties: current version, category's version, status etc.

    category        // parent category of this item, as an instance of Category
    registry        // Registry that manages access to this item
    expiry          // timestamp when this item instance should be considered expired in Ragistry.cache; managed by registry

    editable        // true if this item's data can be modified through .edit(); editable item may contain uncommitted changes,
                    // hence it should NOT be used for reading

    cache = new Map()       // cache of values of methods configured for caching in Item.setCaching(); values can be promises

    get id()        { return [this.cid, this.iid] }
    get id_str()    { return `[${this.cid},${this.iid}]` }
    get newborn()   { return this.iid === null }
    get loaded()    { return this.has_data() && !(this.data instanceof Promise) }   // false if `data` is still loading (a Promise) !!

    has_id(id = null) {
        if (id) return this.cid === id[0] && this.iid === id[1]
        return this.cid !== null && this.iid !== null
    }
    has_data()      { return !!this.data }
    assertLoaded()  { if (!this.loaded) throw new ItemNotLoaded(this) }

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

    constructor(category = null, data = null) {
        if (data) this.data = data instanceof Data ? data : new Data(data)
        if (category) {
            this.category = category
            this.registry = category.registry
            this.cid      = category.iid
        }
    }

    async load(field = null, use_schema = true) {
        /* Load full data of this item (this.data) from a DB, if not loaded yet. Load category. Return this.data. */

        // if field !== null && field in this.loaded: return      // this will be needed when partial loading from indexes is available
        // if (this.data) return this.data         //field === null ? this.data : T.getOwnProperty(this.data, field)

        if (this.loaded) return this
        if (this.data) return this.data.then(() => this)    // loading has already started, must wait rather than load again (`data` is a Promise)

        if (!this.category) {
            // load the category and set a proper class for this item - stubs only have Item as their class,
            // which must be changed when an item gets loaded and linked to its category
            assert(!T.isMissing(this.cid))
            this.category = await this.registry.getCategory(this.cid)
        }
        else if (!this.category.loaded && this.category !== this) 
            await this.category.load()

        // store a Promise that will eventually load this item's data, this is to avoid race conditions;
        // the promise will be replaced in this.data with an actual `data` object when ready
        this.data = this.reload(use_schema)

        return this.data.then(() => this)
    }

    async reload(use_schema = true, record = null) {
        /* Return this item's data object newly loaded from a DB or from a preloaded DB `record`. */
        //print(`${this.id_str}.reload() started...`)
        if (!record) {
            if (!this.has_id()) throw new Error(`trying to reload an item with missing or incomplete ID: ${this.id_str}`)
            record = await this.registry.loadData(this.id)
        }
        let flat   = record.data
        let schema = use_schema ? this.category.getItemSchema() : generic_schema
        let state  = (typeof flat === 'string') ? JSON.parse(flat) : flat
        let data   = schema.decode(state)

        let proto  = this.initPrototypes(data)
        if (proto instanceof Promise) await proto

        this.initClass(data)

        let init = this.init(data)                      // optional custom initialization after the data is loaded
        if (init instanceof Promise) await init

        this.data   = data
        let ttl_ms  = this.category.get('cache_ttl') * 1000
        this.expiry = Date.now() + ttl_ms
        // print('ttl:', ttl_ms/1000, `(${this.id_str})`)

        return data
        // TODO: initialize item metadata - the remaining attributes from `record`
    }

    initPrototypes(data) {
        /* Load all prototypes and check that they belong to the same category (exactly) as this item,
           otherwise the schema of some fields may be incompatible or missing.
         */
        let prototypes = data.getValues('prototype')
        for (const p of prototypes)
            if (p.cid !== this.cid) throw new Error(`item ${this} belongs to a different category than its prototype (${p})`)
        prototypes = prototypes.filter(p => !p.loaded)
        if (prototypes.length === 1) return prototypes[0].load()            // performance: trying to avoid unnecessary awaits or Promise.all()
        if (prototypes.length   > 1) return Promise.all(prototypes.map(p => p.load()))
    }

    initClass(data) {
        /* Initialize this item's class, i.e., substitute the object's temporary Item class with an ultimate subclass. */
        if (this.category === this) return
        let itemclass = this.getClass()
        T.setClass(this, itemclass)                 // change the actual class of this item from Item to `itemclass`
    }

    init(data) {}
        /* Optional category-specific initialization after the item's `data` is loaded but NOT yet stored in this.data.
           This can't be implemented by overriding load/reload(), because the ultimate class is not yet determined
           and attached to `this` at these stages. Subclasses may override this method as either sync or async.
         */

    /***  Dynamic loading of source code  ***/

    getClass() {
        /* Create/parse/load a JS class for this item. If `custom_class` property is true, the item may receive
           a custom subclass (different from the category's default) built from this item's own & inherited `code*` snippets.
         */
        let base = this.category.parseClass()
        let custom = this.category.get('custom_class')
        return custom ? this.parseClass(base) : base
    }

    parseClass(base = Item) {
        /* Concatenate all the relevant `code_*` and `code` snippets of this item into a class body string,
           and dynamically parse them into a new class object - a subclass of `base` or the base class identified
           by the `class` property. Return the base if no code snippets found. Inherited snippets are included in parsing.
         */
        let init = this.get('init')
        if (init) {

        }

        let name = this.get('class')
        if (name) base = this.registry.getClass(name)
        let env  = this.registry.onServer ? 'server' : 'client'
        let spec = this.getMany(`code_${env}`)          // environment-specific code extensions
        let code = this.getMany('code')
        let body = [...code, ...spec].join('\n')        // full class body from concatenated `code` and `code_*` snippets
        if (!body) return base

        // let asyn = body.match(/\bawait\b/)              // if `body` contains "await" word, even if it's in a comment (!),
        // let func = asyn ? AsyncFunction : Function      // an async function is created instead of a synchronous one

        let url = this.sourceURL('code')
        let import_ = (path) => {
            if (path[0] === '.') throw Error(`relative import not allowed in dynamic code of a category (${url}), path='${path}'`)
            return this.registry.site.import(path)
        }
        let source = `return class extends base {${body}}` + `\n//# sourceURL=${url}`
        return new Function('base', 'import_', source) (base, import_)
    }

    parseMethod(path, ...args) {
        let source = this.get(path)
        let url = this.sourceURL(path)
        return source ? new Function(...args, source + `\n//# sourceURL=${url}`) : undefined
    }

    sourceURL(path) {
        /* Build a sourceURL string for the code parsed dynamically from a data element, `path`, of this item. */
        function clean(s) {
            if (typeof s !== 'string') return ''
            return s.replace(/\W/, '')                  // keep ascii-alphanum characters only, drop all others
        }
        let domain   = Item.CODE_DOMAIN
        let cat_name = clean(this.get('name'))
        let fil_name = `${cat_name}_${this.id_str}`
        return `${domain}:///items/${fil_name}/${path}`
        // return `\n//# sourceURL=${url}`
    }


    /***  READ access to item's data  ***/

    getPrototypes()     { return this.data.getValues('prototype') }

    get(path, default_ = undefined) {

        this.assertLoaded()

        // search in this.data
        let value = this.data.findValue(path)
        if (value !== undefined) return value

        // search in prototypes
        for (const proto of this.getPrototypes()) {
            value = proto.get(path)
            if (value !== undefined) return value
        }

        // search in category's defaults
        if (this.category !== this) {
            let cat_default = this.category.getDefault(path)
            if (cat_default !== undefined)
                return cat_default
        }

        return default_
    }

    getMany(key, {inherit = true, reverse = true} = {}) {
        /* Return an array (possibly empty) of all values assigned to a given `key` in this.data.
           Default value (if defined) is NOT included. Values from prototypes are included if inherit=true,
           in such case, the order of prototypes is preserved, with `this` included at the beginning (reverse=false);
           or the order is reversed, with `this` included at the end of the result array (reverse=true, default).
         */
        this.assertLoaded()
        let own = this.data.getValues(key)
        if (!inherit) return own

        let inherited = this.getPrototypes().map(p => p.getMany(key))
        if (!inherited.length) return own

        // WARN: this algorithm produces duplicates when multiple prototypes inherit from a common base object
        let values = []
        inherited = [own, ...inherited]
        if (reverse) inherited.reverse()
        for (const vals of inherited) values.push(...vals)
        return values
    }

    async getLoaded(path, default_ = undefined) {
        /* Retrieve a related item identified by `path` and load its data, then return this item. Shortcut for get+load. */
        let item = this.get(path, default_)
        if (item !== default_) await item.load()
        return item
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
        let default_ = schemas.get(field).prop('default')
        catalogs.push(default_)
        return Catalog.merge(...catalogs)
    }

    getName(default_)   { return this.get('name', default_) }

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
        let schema = use_schema ? this.getSchema() : generic_schema
        return schema.encode(this.data)
    }
    dumpData(use_schema = true, compact = true) {
        /* Dump this.data to a JSON string using schema-aware (if schema=true) encoding of nested values. */
        let state = this.encodeData(use_schema)
        return JSON.stringify(state)
    }
    encodeSelf(use_schema = true) {
        /* Encode this item's data & metadata into a JSON-serializable dict; `registry` and `category` excluded. */
        let state = (({cid, iid}) => ({cid, iid}))(this)    // pull selected properties from `this`, others are not serializable
        state.data = this.encodeData(use_schema)
        return state
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
        /* Web endpoint for all types of edits of this.data. */
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

    async remote(method, data, {args, params} = {}) {
        /* Connect from client to a @method endpoint of an internal API using HTTP POST by default;
           send `data` if any; return a response body parsed from JSON to an object.
         */
        let url = this.url(method)
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
        if (!node.loaded) await node.load()
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
            if (!node.loaded) await node.load()
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
        let session  = request.session
        let method   = request.method || this.defaultMethod(request) || 'default'

        if (session) {
            session.item = this
            if (request.app) session.app = request.app
            ;[req, res] = session.channels
        }

        // // get handler's source code from category's properties?
        // if (source) {
        //     handler = new AsyncFunction('context', `"use strict";` + source)
        //     // handler = eval('(' + source + ')')      // surrounding (...) are required when parsing a function definition
        // }

        let hdl_name = `${request.type}_${method}`
        let handler  = this[hdl_name]
        if (handler) return handler.call(this, {request, req, res})

        if (`VIEW_${method}` in this) {
            session.view = method
            return this.page({request, view: method})
        }

        request.throwNotFound(`no handler found for @${method} endpoint`)
    }

    defaultMethod(request) {
        /* Subclasses may override this method to decide what default @method should be used by handle()
           for a particular `request` when no method name was supplied by the client.
           By default, suggestions from request.defaultMethods are used, but only if request.type='GET'.
         */
        if (request.type !== 'GET') return
        for (const method of request.defaultMethods.reverse())
            if (`GET_${method}` in this) return method
    }

    page({title, head, body, request, view} = {}) {
        /* Generate an HTML page to be sent as a response for a GET request;
           fill the page with HTML contents rendered from a view function (React functional component).
           The `view` name should point to a method VIEW_{view} of the current Item's subclass.
         */
        if (title === undefined) {
            let name = this.getName('')
            let ciid = this.getStamp({html: false})
            title = `${name} ${ciid}`
        }
        if (head === undefined) head = this.category.getAssets().renderAll()
        if (body === undefined) body = `
            <p id="data-session" style="display:none">${btoa(encodeURIComponent(JSON.stringify(request.session.dump())))}</p>
            <div id="react-root">${this.render(view)}</div>
            <script async type="module"> import {boot} from "/local/client.js"; boot('${view}'); </script>
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

    VIEW_default(props) { return this.VIEW_full(props) }

    VIEW_full({extra = null}) {
        /* Detailed (admin) view of an item, as a React functional component. */
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
                if (args.length) return fun.call(this, ...args)         // here and below, `this` is an Item instance
                if (this.cache.has(name)) return this.cache.get(name)   // print(`${name}() from cache`)
                let value = fun.call(this)
                this.cache.set(name, value)             // may store a promise
                return value                            // may return a promise
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

Item.setCaching('getPrototypes', 'getClass', 'parseClass', 'render')


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

    new(data = null, iid = null) {
        /*
        Create a newborn item of this category (not yet in DB); connect it with this.registry;
        set its IID, or mark as pending for insertion to DB if no `iid` provided.
        The order of `data` and `iid` arguments can be swapped.
        */
        if (typeof data === 'number') [data, iid] = [iid, data]
        let itemclass = this.parseClass()
        let item = new itemclass(this, data)
        if (iid !== null) item.iid = iid
        // else this.registry.stage(item)                  // mark `item` for insertion on the next commit()
        return item
    }

    // getItemClass() {
    //     // let proto = this.get('prototype')                // will use the FIRST prototype's class as the (base) class
    //     // if (proto) base = proto.getItemClass()
    //     return this.parseClass()
    // }

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
    getDefault(field, default_ = undefined) {
        /* Get default value of a field from category schema. Return `default` if no category default is configured. */
        this.assertLoaded()
        let fields = this.getFields()
        let schema = fields.get(field)
        return schema ? schema.prop('default') : default_
    }

    getItemSchema() {
        /* Get schema of items in this category (not the schema of self, which is returned by getSchema()). */
        let fields = this.getFields()
        return new DATA(fields.asDict())
    }
    getAssets() {
        /* Dependencies: css styles, libraries, ... required by HTML pages of items of this category. Instance of Assets. */
        return this.getItemSchema().getAssets()
    }

    async GET_scan({res}) {
        /* Retrieve all children of this category and send to client as a JSON.
           TODO: set a size limit & offset (pagination).
           TODO: let declare if full items (loaded), or meta-only, or naked stubs should be sent.
         */
        let items = []
        for await (const item of this.registry.scanCategory(this)) {
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
        let item = this.new(data)
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
                let item = await this.registry.getItem([record.cid, record.iid])
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

    VIEW_full({extra = null}) {
        const scan = () => this.registry.scanCategory(this)         // returns an async generator that requires "for await"
        const [items, setItems] = useState(scan())                  // existing child items; state prevents re-scan after every itemAdded()

        const [newItems, setNewItems] = useState([])                // newly added items
        const itemAdded   = (item) => { setNewItems(prev => [...prev, item]) }
        const itemRemoved = (item) => { setNewItems(prev => prev.filter(i => i !== item)) }

        return super.VIEW_full({item: this, extra: FRAGMENT(
            H2('Items'),
            e(this.Items, {items: items, itemRemoved: () => setItems(scan())}),
            H3('Add item'),
            e(this.Items, {items: newItems, itemRemoved}),
            e(this.NewItem.bind(this), {itemAdded}),
            extra,
        )})
    }
}

Category.setCaching('getItemClass', 'getFields', 'getItemSchema', 'getAssets')   //'getHandlers'


/**********************************************************************************************************************/

export class RootCategory extends Category {
    cid = ROOT_CID
    iid = ROOT_CID

    constructor(registry, data = null) {
        super(null, data)
        this.registry = registry
        this.category = this                    // root category is a category for itself
    }
    encodeData(use_schema = false) {
        /* Same as Item.encodeData(), but use_schema is false to avoid circular dependency during deserialization. */
        return super.encodeData(false)
    }
    async reload(use_schema = false, record = null) {
        /* Same as Item.reload(), but use_schema is false to avoid circular dependency during deserialization. */
        return super.reload(false, record)
    }
}

