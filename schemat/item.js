import {
    print, assert, T, escape_html, ItemDataNotLoaded, ItemNotLoaded,
    ServerError, indent, dedentFull, splitLast, BaseError, NotImplemented, NotFound, concat, unique,
} from './utils.js'
import { e, useState, useRef, delayed_render, NBSP, DIV, A, P, H1, H2, H3, SPAN, FORM, INPUT, FIELDSET,
         TABLE, TH, TR, TD, TBODY, BUTTON, FRAGMENT, HTML } from './react-utils.js'

import { Resources, ReactDOM } from './resources.js'
import { Path, Catalog, Data } from './data.js'
import { HttpProtocol, JsonProtocol, API, ActionsProtocol, InternalProtocol } from "./protocols.js"

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

    static NotFound = class extends NotFound {
        static message = "URL path not found"
    }

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


export class RequestContext {
    /* Wrapper around the contextual information passed to request handlers. */
    constructor({request, req, res, handler, endpoint, item}) {
        Object.assign(this, {request, req, res, handler, endpoint, item})
    }
}

export class Handler {
    /* Utility class that holds function(s) that together implement a web handler for a specific endpoint
       of the items in a particular category.
       All the functions except run() get bound to the target item when called, i.e., to the item that was discovered
       through the routing process and is responsible for handling the request.
       As such, the functions can be viewed as methods of the Item class, with `this` bound to an Item instance.
       All the functions accept a single argument, `context` (`ctx`), of the shape:

                context = {request, req, res, item, handler, endpoint}
     */

    constructor(props = {})      { Object.assign(this, props) }

    run(context) {
        let {request, item} = context
        let httpMethod = request.type
        if (!httpMethod || !this[httpMethod])
            throw new Error(`missing or incorrect request.type (httpMethod): ${httpMethod}, ${this[httpMethod]}`)
        // print('Handler.run():', this, httpMethod, this[httpMethod])
        return this[httpMethod].call(item, context)     // may return a Promise
    }

    // top-level (most generic) handler functions; the default implementations reduce to lower-level function calls;
    // each of the functions may return a Promise (!)

    GET(ctx)    { return ctx.handler.page.call(this, ctx) }
    POST(ctx)   {
        let method = `POST_${ctx.endpoint}`
        if (method in this) return this[method].call(this, ctx)
        ctx.request.throwNotFound(`POST handler not found for '@${ctx.endpoint}'`)
    }
    CALL(ctx)   {
        let method = `CALL_${ctx.endpoint}`
        if (method in this) return this[method].call(this, ctx)
        ctx.request.throwNotFound(`CALL handler not found for '@${ctx.endpoint}'`)
    }

    // lower-level functions for HTML page generation (GET requests) ...

    page(ctx) {
        /* page() defines an HTML frame for the entire page and fills it out with elements
           computed by other, more specific, methods of the handler. */
        let {request, endpoint, handler} = ctx
        if (`VIEW_${endpoint}` in this) return this.page({request, view: endpoint})

        let body   = handler.body.call(this, ctx)
        let title  = handler.title.call(this, ctx)
        let common = handler.common.call(this, ctx)
        let assets = handler.assets.call(this, ctx)

        return dedentFull
        (`
            <!DOCTYPE html><html>
            <head>
                <title>${title}</title>
                ${common}
                ${assets}
            </head>
            <body>\n${body}\n</body></html>
        `)

        // request.throwNotFound(`GET handler/page/view not found for '@${endpoint}'`)
    }

    title(ctx) {
        /* HTML title to be put in the meta section (head/title) of the response page. By default, the item's name & ID is returned. */
        let name = this.getName()
        let ciid = this.getStamp({html: false})
        return `${name} ${ciid}`
    }

    common(ctx) {
        /* Shared global HTML assets: scripts, styles. */
        let globalAssets = Resources.clientAssets
        let staticAssets = this.category.getItemAssets().renderAll()
        let customAssets = this.category.get('html_assets')
        let assets = [globalAssets, staticAssets, customAssets]
        return assets .filter(a => a && a.trim()) .join('\n')
    }

    assets(ctx) {
        /* HTML to be put in the head section of the response page to import global assets: scripts, styles. */
        return ''
    }

    body(ctx) {
        /* Here, `this` is bound to the item being rendered. */
        let {request, endpoint} = ctx

        // let {handler, item} = ctx
        // let view = e(handler.view.bind(item), ctx)
        // let html = targetElement ? ReactDOM.render(view, targetElement) : ReactDOM.renderToString(view)

        let html    = this.render(endpoint)
        let session = btoa(encodeURIComponent(JSON.stringify(request.session.dump())))
        return `
            <div id="react-root">${html}</div>
            <p id="data-session" style="display:none">${session}</p>
            <script async type="module"> import {boot} from "/system/local/client.js"; boot('${endpoint}'); </script>
        `
    }

    view({endpoint}) {
        /* React functional component that renders the actual (visible) content of the HTML response page.
           View function is called through Item.render() and only accepts a part of the full context,
           so that allow client-side hydration (re-rendering).
           Here, `this` is bound to the item being rendered. */
        let method = `VIEW_${endpoint}`
        if (method in this) return e(this[method].bind(this))
        throw new Request.NotFound(`GET/page/view() function missing in the handler for '@${endpoint}'`)
        // throw new Request.NotFound('view() function is missing in a handler')
        // ctx.request.throwNotFound(`GET handler/page/view not found for '@${ctx.endpoint}'`)
    }
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

    static Handler = Handler            // to make Handler acessible in global scope as Item.Handler

    // static Client                       // each Item subclass may have its own Client/Server agents with their own set of actions
    // static Server

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

    action          // collection of triggers for RPC actions exposed by this item's API;
                    // present server-side and client-side, but with a different implementation of triggers

    // editable        // true if this item's data can be modified through .edit(); editable item may contain uncommitted changes,
    //                 // hence it should NOT be used for reading

    cache = new Map()           // cache of values of methods configured for caching in Item.setCaching(); values can be promises

    _dataAll = new Map()        // {field: combined own data + inherited from ancestors + inherited from schema default + imputed}
                                // each field is computed and cached separately, lazily upon request

    static category             // like instance-level `category`, but accessible from the class
    static handlers   = {}      // collection of web handlers, {name: handler}; each handler is a Handler instance
    static components = {}      // collection of standard components for rendering this item's pages (NOT USED)
    static actions    = {}      // specification of action functions (RPC calls), as {action_name: [endpoint, ...fixed_args]}; each action is accessible from a server or a client
    static api        = null    // API instance that defines this item's endpoints and protocols

    static __transient__ = ['cache']

    get id()        { return [this.cid, this.iid] }
    get id_str()    { return `[${this.cid},${this.iid}]` }
    // get schema()    { return this.getSchema() }

    isLoading           // the Promise created at the start of reload() and fulfilled when load() completes; indicates that the item is currently loading
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
    static async createNewborn(category, iid, data) {
        /* A "newborn" item has a category & CID assigned, and is intended for insertion to DB.
           Arguments `data` and `iid` are optional. The item returned is *booted* (this.data initialized).
         */
        return new Item(category, iid).reload({data})
    }
    static async createLoaded(category, iid, jsonData) {
        return new Item(category, iid).reload({jsonData})
    }

    static createAPI(endpoints, actions = {}) {
        /* Create .api and .actions of this Item (sub)class. */
        let base = Object.getPrototypeOf(this)
        if (!T.isSubclass(base, Item)) base = undefined
        this.api = new API(base ? [base.api] : [], endpoints)
        this.actions = base ? {...base.actions, ...actions} : actions
    }


    constructor(category, iid) {
        /* To set this.data, load() or reload() must be called after this constructor. */
        if (category) {
            this.category = category
            this.registry = category.registry
            this.cid      = category.iid
        }
        if (iid !== undefined) this.iid = iid
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

        this.setExpiry(this.category.prop('cache_ttl'))
        this._mod_type = await import('./type.js')          // to allow synchronous access to DATA and generic_schema in other methods later on

        await this._initClass()                             // set the target JS class on this object; stubs only have Item as their class, which must be changed when the item is loaded and linked to its category
        this._initActions()

        let init = this.init()                              // optional custom initialization after the data is loaded
        if (init instanceof Promise) await init             // must be called BEFORE this.data=data to avoid concurrent async code treat this item as initialized

        this.isLoading = false
        return this
    }

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

    async _initClass() {
        /* Initialize this item's class, i.e., substitute the object's temporary Item class with an ultimate subclass. */
        if (this.category === this) return                      // special case for RootCategory: its class is already set up, must prevent circular deps
        T.setClass(this, await this.category.getItemClass())    // change the actual class of this item from Item to the category's proper class
    }

    _initActions() {
        /* Create action triggers (this.action.X()) from the class'es API. */

        let api = this.constructor.api
        this.action = {}

        // create a trigger for each action and store in `this.action`
        for (let [name, spec] of Object.entries(this.constructor.actions)) {
            if (name in this.action) throw new Error(`duplicate action name: '${name}'`)
            // if (typeof spec === 'string') spec = [spec]
            let [endpoint, ...fixed] = spec             // `fixed` are arguments to the call, typically an action name
            let handler  = api.get(endpoint)
            this.action[name] = this.registry.onServer
                ? (...args) => handler.execute(this, {}, ...fixed, ...args)     // may return a Promise
                : (...args) => handler.client(this, ...fixed, ...args)          // may return a Promise
        }
        // print('this.action:', this.action)
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

    // propObject(...paths) -- multiple prop(path) values wrapped up in a single POJO object {path_k: value_k}
    // prop(path)    -- the first value matching a given path; POJO attribute's value as a fallback
    // props(path)   -- stream of values matching a given path
    // entries(prop) -- stream of entries for a given property

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

    prop(path, _default = undefined) {
        /* Read the item's property either from this.data using get(), or (if missing) from this POJO's regular attribute
           - this allows defining attributes through DB or through item's class constructor.
           If there are mutliple values for 'path', the first one is returned.
         */
        if (!this.isShadow) {
            // a "shadow" item doesn't map to a DB record, so its props can't be read with this.props() below
            let value = this.props(path).next().value
            if (value !== undefined) return value

            // before falling back to a default value stored in a POJO attribute,
            // check that 'path' is valid according to schema, to block access to system fields like .data etc
            // - this is done for non-shadow items only, because shadow ones don't have a schema
            let schema = this.getSchema()
            if (!schema.has(path)) throw new Error(`not in schema: ${path}`)
        }

        // POJO attribute value as a default
        let value = this[path]
        if (value !== undefined) return value

        return _default
    }

    *props(path) {
        /* Generate a stream of all (sub)property values that match a given `path`. The path should start with
           a top-level property name, followed by subproperties separated by '/'. Alternatively, the path
           can be an array of subsequent property names, or positions (in a nested array or Catalog).
         */
        let [prop, tail] = Path.splitAll(path)
        for (const entry of this.entries(prop))         // find all the entries for a given `prop`
            yield* Path.walk(entry.value, tail)        // walk down the `tail` path of nested objects
    }

    *entries(prop) {
        /* Generate a stream of valid entries for a given property: own and inherited.
           If the schema doesn't allow multiple entries, only the first one is yielded, for simple types,
           or, for "mergeable" types like CATALOG, the objects (own & inherited) get merged into one
           - a default object as defined in the schema may also be included in the merge.
           Once computed, the list of entries is cached in this._dataAll for future use.
         */
        let entries = this._dataAll.get(prop)                              // array of entries, or undefined
        if (entries) yield* entries
        let fields

        if (this === this.category) {
            // RootCategory is a special case: we have to perform schema inheritance manually to avoid infinite recursion
            let root_fields = this.data.get('fields')
            let default_fields = root_fields.get('fields').props.default
            fields = new Catalog(root_fields, default_fields)
        }
        else fields = this.category.prop('fields')

        let schema = fields.get(prop)
        if (!schema) throw new Error(`not in schema: '${prop}'`)

        let ancestors = this.getAncestors()                                 // includes `this` at the 1st position
        let streams = ancestors.map(proto => proto.entriesRaw(prop))

        entries = schema.combine(streams)
        this._dataAll.set(prop, entries)
        yield* entries
    }

    *entriesRaw(prop = undefined) {
        /* Generate a stream of own entries (from this.data) for a given property(s). No inherited/imputed entries.
           `prop` can be a string, or an array of strings, or undefined. The entries preserve their original order.
         */
        assert(!this.isShadow)
        this.assertData()
        yield* this.data.readEntries(prop)
    }

    get(path, opts = {}) {
        /* Return the first value matching a `path` in this.data or in prototypes. If not found, return a default value
           as configured in the category schema, or undefined.
         */

        assert(!this.isShadow)
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
            let cat_default = this.category.getFieldDefault(path)
            if (cat_default !== undefined)
                return cat_default
        }

        return opts.default
    }

    flat(first = true) {
        /* Return this.data converted to a flat object. For repeated keys, only one value is included:
           the first one if first=true (default), or the last one, otherwise.
          */
        this.assertLoaded()
        return this.data.flat(first)
    }

    // async getLoaded(path) {
    //     /* Retrieve a related item identified by `path` and load its data, then return this item. Shortcut for get+load. */
    //     let item = this.get(path)
    //     if (item !== undefined) await item.load()
    //     return item
    // }

    getMany(key, {inherit = true, reverse = true} = {}) {
        /* Return an array (possibly empty) of all values assigned to a given `key` in this.data.
           Default value (if defined) is NOT included. Values from prototypes are included if inherit=true,
           in such case, the order of prototypes is preserved, with `this` included at the beginning (reverse=false);
           or the order is reversed, with `this` included at the end of the result array (reverse=true, default).
           The `key` can be an array of keys.
         */
        this.assertLoaded()

        if (typeof key === 'string') key = [key]
        let own = this.data.getValues(key)
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
        /* Default import path of this item. Starts with '/' (absolute path). */
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

    getHandlers()   { return T.inheritedMerge(this.constructor, 'handlers') }

    mergeSnippets(key, params) {
        /* Calls getMany() to find all entries with a given `key` including the environment-specific
           {key}_client OR {key}_server keys; assumes the values are strings.
           Returns \n-concatenation of the strings found. Used internally to retrieve & combine code snippets. */
        let env = this.registry.onServer ? 'server' : 'client'
        let snippets = this.getMany([key, `${key}_${env}`], params)
        return snippets.join('\n')
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

        Each handler MUST be declared in the `handlers` property of this item's category,
        otherwise it won't be recognized. The default list of handlers for an Item is defined below,
        after Item class definition.
        */
        request.item = this
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

        let api = this.constructor.api
        let httpMethod = request.type

        for (let endpoint of methods) {
            let context = new RequestContext({request, req, res, endpoint, item: this})

            let handler2 = this.getHandlers()[endpoint]
            if (handler2) return handler2.run({...context, handler: handler2})

            let handler = api.findHandler(endpoint, httpMethod)
            if (handler) return handler.server(this, context)
        }

        // for (let endpoint of methods) {
        //     let hdl_name = `${request.type}_${endpoint}`
        //     let handler  = this[hdl_name]
        //     if (handler) return handler.call(this, {request, req, res})
        //
        //     if (`VIEW_${endpoint}` in this)
        //         return this.page({request, view: endpoint})
        // }

        request.throwNotFound(`no handler found for [${methods}] access method(s)`)
    }


    /***  Page rendering  ***/

    page({title, assets, body, request, view} = {}) {
        /* Generate an HTML page to be sent as a response to a GET request;
           fill the page with HTML contents rendered from a view function (React functional component).
           The `view` name should point to a method VIEW_{view} of the current Item's subclass.
         */
        if (title  === undefined) title = this._htmlTitle({request, view})
        if (assets === undefined) assets = this._htmlAssets()
        body = (body || '') + this._htmlBody({request, view})
        return dedentFull(`
            <!DOCTYPE html><html>
            <head>
                <title>${title}</title>
                ${assets}
            </head>`) +
            `<body>\n${body}\n</body></html>`
    }
    _htmlTitle({request, view}) {
        /* Get/compute a title for an HTML response page for a given request & view name. */
        let title = this.prop('html_title')
        if (title instanceof Function) title = title({request, view})           // this can still return undefined
        if (title === undefined) {
            let name = this.getName()
            let ciid = this.getStamp({html: false})
            title = `${name} ${ciid}`
        }
        return title
    }
    _htmlAssets() {
        let globalAssets = Resources.clientAssets
        let staticAssets = this.category.getItemAssets().renderAll()
        let customAssets = this.category.prop('html_assets')
        let assets = [globalAssets, staticAssets, customAssets]
        return assets .filter(a => a && a.trim()) .join('\n')
    }
    _htmlBody({request, view}) {
        let component = this.render(view)
        let session = btoa(encodeURIComponent(JSON.stringify(request.session.dump())))
        return `
            <p id="data-session" style="display:none">${session}</p>
            <div id="react-root">${component}</div>
            <script async type="module"> import {boot} from "/system/local/client.js"; boot('${view}'); </script>
        `
    }

    render(endpoint, targetElement = null) {
        /* Render this item's `view` (name) into an HTMLElement (client-side) if `targetElement` is given,
           or to a string (server-side) otherwise. When rendering server-side, useEffect() & delayed_render() do NOT work,
           so only a part of the HTML output is actually rendered. For workaround, see:
            - https://github.com/kmoskwiak/useSSE  (useSSE, "use Server-Side Effect" hook)
            - https://medium.com/swlh/how-to-use-useeffect-on-server-side-654932c51b13
            - https://dev.to/kmoskwiak/my-approach-to-ssr-and-useeffect-discussion-k44
         */
        this.assertLoaded()
        if (!targetElement) print(`SSR render('${endpoint}') of ${this.id_str}`)

        let handler = this.getHandlers()[endpoint]
        let view    = e(handler.view.bind(this), {endpoint})

        // let method = `VIEW_${endpoint}`
        // if (!(method in this)) throw new Request.NotFound(`GET handler/page/view not found for '@${endpoint}'`)
        // let view = e(this[method].bind(this))

        return targetElement ? ReactDOM.render(view, targetElement) : ReactDOM.renderToString(view)
        // might use ReactDOM.hydrate() not render() in the future to avoid full re-render client-side ?? (but render() seems to perform hydration checks as well)
    }

    /***  Handlers & Components  ***/

    VIEW_default()      { return this.VIEW_admin() }
    VIEW_admin()        { return this.view_admin() }

    view_admin({extra = null} = {}) {
        /* Detailed (admin) view of an item. */
        return DIV(
            // e(MaterialUI.Box, {component:"span", sx:{ fontSize: 16, mt: 1 }}, 'MaterialUI TEST'),
            // e(this._mui_test),
            e(this.Title.bind(this)),
            H2('Properties'),
            e(this.Properties.bind(this)),
            extra,
        )
    }
    // _mui_test() {
    //     return e(MaterialUI.Box, {component:"span", sx:{ fontSize: 16, mt: 1 }}, 'MaterialUI TEST')
    //     // WARN: when _mui_test() is used repeatedly in Page, a <style> block is output EACH time (!!!)
    //     //       A class name of the form .css-HASH is assigned, where HASH is a stable 6-letter hash of the styles
    // }

    // standard components for rendering this item's pages...

    Title() {
        /* <H1> element to be displayed as a page title. */
        let name = this.getName()
        let ciid = this.getStamp()
        if (name)
            return H1(name, ' ', SPAN({style: {fontSize:'40%', fontWeight:"normal"}, ...HTML(ciid)}))
        else
            return H1(HTML(ciid))
    }

    Properties() {
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

    // static cached_methods = ['getPrototypes', ...]
}

/**********************************************************************************************************************/

Item.setCaching('getPrototypes', 'getAncestors', 'getPath', 'getActions', 'getEndpoints', 'getSchema', 'render')

Item.handlers = {
    default: new Handler(),
    // item:    new Handler(),
    admin:   new Handler(),
}


// When action functions (below) are called, `this` is always bound to the Item instance, so actions execute
// in the context of their item, like if they were regular methods of the Item (sub)class.
// The first argument, `ctx`, is a RequestContext instance, followed by action-specific list
// of arguments. In a special case when an action is called directly on the server through item.action.XXX(),
// `ctx` is {}, which can be a valid argument for some actions - supporting this type
// of calls is NOT mandatory, though.

Item.createAPI(
    {
        // http endpoints...
        // 'GET/default':  new HtmlPage({title: '', assets: '', body: ''}),
        'CALL/default': new InternalProtocol(function() { return this }),
        'CALL/item':    new InternalProtocol(function() { return this }),
        'GET/json':     new JsonProtocol(function() { return this.encodeSelf() }),

        // internal actions called by UI
        'POST/action':  new ActionsProtocol({

            delete_self(ctx)   { return this.registry.delete(this) },

            insert_field(ctx, path, pos, entry) {
                if (entry.value !== undefined) entry.value = this.getSchema([...path, entry.key]).decode(entry.value)
                this.data.insert(path, pos, entry)
                return this.registry.update(this)
            },

            delete_field(ctx, path) {
                this.data.delete(path)
                return this.registry.update(this)
            },

            update_field(ctx, path, entry) {
                if (entry.value !== undefined) entry.value = this.getSchema(path).decode(entry.value)
                this.data.update(path, entry)
                return this.registry.update(this)
            },

            move_field(ctx, path, pos1, pos2) {
                this.data.move(path, pos1, pos2)
                return this.registry.update(this)
            },

        }),
    },
    {
        // actions...
        // the list of 0+ arguments after the endpoint should match the ...args arguments accepted by execute() of the protocol
        'get_json':         ['GET/json'],
        'delete_self':      ['POST/action', 'delete_self'],
        'insert_field':     ['POST/action', 'insert_field'],
        'delete_field':     ['POST/action', 'delete_field'],
        'update_field':     ['POST/action', 'update_field'],
        'move_field':       ['POST/action', 'move_field'],
    }
)
// print(`Item.api.endpoints:`, Item.api.endpoints)


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
        return Item.createNewborn(this, iid, data)
    }

    async getItemClass() {
        /* Return the dynamically created class to be used for items of this category. */
        // below, module.Class is subclassed to allow safe addition of a static .category attribute,
        // even when several categories share the `base` class, so each one needs a different value of .category
        let module = await this.getModule()
        let base = module.Class
        let name = `${base.name}`
        let cls = {[name]: class extends base {}}[name]
        // assert(cls.category === undefined || cls.category === this, this, cls.category)
        cls.category = this
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
        return splitLast(this.get('class_path') || '', ':')
    }

    getSource() {
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
        let views = this._codeViewsHandlers()
        let hdlrs = this._codeHandlers()
        let cache = this._codeCache()
        return [def, views, hdlrs, cache] .filter(Boolean) .join('\n')
    }
    _codeBody() {
        /* Source code of this category's dynamic Class body. */
        let body = this.mergeSnippets('class_body')
        let methods = []
        let views = this.prop('views')                              // extend body with VIEW_* methods
        for (let {key: vname, value: vbody} of views || [])
            methods.push(`VIEW_${vname}(props) {\n${vbody}\n}`)
        return body + methods.join('\n')
    }
    _codeViewsHandlers() {
        let views = this.prop('views')
        if (!views?.length) return
        let names = views.map(({key}) => key)
        let hdlrs = names.map(name => `${name}: new Item.Handler()`)
        let code  = `Class.handlers = {...Class.handlers, ${hdlrs.join(', ')}}`
        print('_codeViewsHandlers():', code)
        return code
    }
    _codeHandlers() {
        let entries = this.prop('handlers')
        if (!entries?.length) return
        let catg = `${this.cid}_${this.iid}`
        let className = (name) => `Handler_${catg}_${name}`
        let handlers = entries.map(({key: name, value: code}) =>
            `  ${name}: new class ${className(name)} extends Item.Handler {\n${indent(code, '    ')}\n  }`
        )
        return `Class.handlers = {...Class.handlers, \n${handlers.join(',\n')}\n}`
        // print('_codeHandlers():', code)
        // return code
    }
    _codeCache() {
        /* Source code of setCaching() statement for selected methods of a custom Class. */
        let cached = this.getMany('cached_methods')
        cached = cached.join(' ').replaceAll(',', ' ').trim()
        if (!cached) return ''
        cached = cached.split(/\s+/).map(m => `'${m}'`)
        print('_codeCache().cached:', cached)
        return `Class.setCaching(${cached.join(',')})`
    }

    getItem(iid) {
        /*
        Instantiate a stub of an Item and seed it with IID (the IID being present in DB, presumably, not checked),
        but do NOT load remaining contents from DB (lazy loading).
        */
        return this.registry.getItem([this.iid, iid])
    }

    // getFields() {
    //     /* Catalog of all the fields allowed for items of this category, including the global-default and inherited ones. */
    //     return this.prop('fields')
    // }

    getFieldDefault(field) {
        /* Get default value for an item's field as configured in the schema. Return undefined if no default is configured. */
        this.assertLoaded()
        let schema = this.getItemSchema().get(field)
        return schema ? schema.props.default : undefined
    }

    getItemSchema() {
        /* Get schema of items in this category (not the schema of self, which is returned by getSchema()). */
        let fields = this.prop('fields')
        return new this._mod_type.DATA({fields: fields.flat()})
    }
    getItemAssets() {
        /* Dependencies: css styles, libraries, ... required by HTML pages of items of this category. Instance of Assets. */
        return this.getItemSchema().getAssets()
    }

    _checkPath(request) {
        /* Check if the request's path is compatible with the default path of this item. Throw an exception if not. */
        let path  = request.pathFull
        let dpath = this.getPath()              // `path` must be equal to the default path of this item
        if (path !== dpath)
            throw new Error(`code of ${this} can only be imported through '${dpath}' path, not '${path}'; create a derived item/category on the desired path, or use an absolute import, or set the "path" property to the desired path`)
    }

    Items({items, itemRemoved}) {
        /* A list (table) of items. */
        if (!items || items.length === 0) return null
        const remove = (item) => item.action.delete_self().then(() => itemRemoved && itemRemoved(item))

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

            let record = await this.action.create_item(data.__getstate__())      // TODO: validate & encode `data` through category's schema
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

    VIEW_admin() {
        const scan = () => this.registry.scan(this)         // returns an async generator that requires "for await"
        const [items, setItems] = useState(scan())                  // existing child items; state prevents re-scan after every itemAdded()

        const [newItems, setNewItems] = useState([])                // newly added items
        const itemAdded   = (item) => { setNewItems(prev => [...prev, item]) }
        const itemRemoved = (item) => { setNewItems(prev => prev.filter(i => i !== item)) }

        return this.view_admin({extra: FRAGMENT(
            H2('Items'),
            e(this.Items, {items: items, itemRemoved: () => setItems(scan())}),
            H3('Add item'),
            e(this.Items, {items: newItems, itemRemoved}),
            e(this.NewItem.bind(this), {itemAdded}),
        )})
    }

    // VIEW_admin({extra = null}) {
    //     const scan = () => this.registry.scan(this)         // returns an async generator that requires "for await"
    //     const [items, setItems] = useState(scan())                  // existing child items; state prevents re-scan after every itemAdded()
    //
    //     const [newItems, setNewItems] = useState([])                // newly added items
    //     const itemAdded   = (item) => { setNewItems(prev => [...prev, item]) }
    //     const itemRemoved = (item) => { setNewItems(prev => prev.filter(i => i !== item)) }
    //
    //     return super.VIEW_admin({item: this, extra: FRAGMENT(
    //         H2('Items'),
    //         e(this.Items, {items: items, itemRemoved: () => setItems(scan())}),
    //         H3('Add item'),
    //         e(this.Items, {items: newItems, itemRemoved}),
    //         e(this.NewItem.bind(this), {itemAdded}),
    //         extra,
    //     )})
    // }
}

Category.setCaching('getItemClass', 'getSource', 'getItemSchema', 'getAssets')   //'getHandlers'

Category.createAPI(
    {
        // http endpoints...

        'GET/import':   new HttpProtocol(function ({request, res})
        {
            /* Send JS source code of this category with a proper MIME type to allow client-side import(). */
            this._checkPath(request)
            res.type('js')
            res.send(this.getSource())
        }),

        'GET/scan':     new HttpProtocol(async function ({res})
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
            res.sendItems(items)
        }),

        'POST/create':  new JsonProtocol(async function (ctx, dataState)
        {
            /* Create a new item in this category based on request data. */
            let data = await (new Data).__setstate__(dataState)
            let item = await this.new(data)
            await this.registry.insert(item)
            // await category.registry.commit()
            return item.encodeSelf()
            // TODO: check constraints: schema, fields, max lengths of fields and of full data - to close attack vectors
        }),
    },
    {
        // actions...
        'create_item':      ['POST/create'],
    }
)


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
    getItemClass() { return Category }
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
