import {
    React, ReactDOM, e, useState, useRef, delayed_render, NBSP, DIV, A, P, H1, H2, H3, SPAN, FORM, INPUT, LABEL, FIELDSET,
    TABLE, TH, TR, TD, TBODY, BUTTON, STYLE, FRAGMENT, HTML, fetchJson
} from './react-utils.js'
import { print, assert, T, escape_html, ItemNotLoaded, ServerError } from './utils.js'
import { generic_schema, CATALOG, DATA } from './type.js'
import { Catalog, Data } from './data.js'

export const ROOT_CID = 0

// import styles from "./assets/styles.css";
// print("styles:", styles)


/**********************************************************************************************************************
 **
 **  UI COMPONENTS
 **
 */

// function Catalog1({item, path, catalog, schema, schemas, color, start_color}) {
//     /* If `schemas` is provided, it should be a Map or a Catalog, from which a `schema` will be retrieved
//        for each entry using: schema=schemas.get(key); otherwise, the `schema` argument is used for all entries.
//        If `start_color` is undefined, the same `color` is used for all rows.
//      */
//     let entries = catalog.getEntries()
//     let rows    = entries.map(({key, value, id}, i) =>
//     {
//         if (start_color) color = 1 + (start_color + i - 1) % 2
//         if (schemas) schema = schemas.get(key)
//         let props = {item, path: [...path, id]}
//
//         return TR({className: `is-row${color}`},
//                   schema instanceof CATALOG
//                     ? TD({className: 'ct-nested', colSpan: 2},
//                         DIV({className: 'ct-field'}, key),
//                         e(Catalog1, {...props, catalog: value, schema: schema.values, color})
//                     )
//                     : e(Entry, {...props, key_:key, value, schema}))
//     })
//     let depth = 1 + path.length
//     let table = TABLE({className: `catalog${depth}`}, TBODY(...rows))
//     return path.length ? DIV({className: 'wrap-offset'}, table) : table         // nested catalogs need a <div.wrap-offset> wrapper
// }
//
// function Entry({path, key_, value, schema, item}) {
//     /* A table row containing an atomic entry: a key and its value (not a subcatalog).
//        The argument `key_` must have a "_" in its name to avoid collision with React's special prop, "key".
//      */
//     const save = async (newValue) => {
//         // print(`save: path [${path}], value ${newValue}, schema ${schema}`)
//         await item.remote_set({path, value: schema.encode(newValue)})        // TODO: validate newValue
//     }
//     return FRAGMENT(
//               TH({className: 'ct-field'}, key_),
//               TD({className: 'ct-value', suppressHydrationWarning:true}, schema.display({value, save})),
//            )
// }

/**********************************************************************************************************************/

class Changes {
    /* List of changes to item's data that have been made by a user and can be submitted
       to the server and applied in DB. Multiple edits of the same data entry are merged into one.
     */
    constructor(item) {
        this.item = item
    }
    reset() {
        print('Reset clicked')
    }
    submit() {
        print('Submit clicked')
    }

    Buttons() {
        return DIV({style: {textAlign:'right', paddingTop:'20px'}},
            BUTTON({id: 'reset' , className: 'btn btn-secondary', onClick: this.reset,  disabled: false}, 'Reset'), ' ',
            BUTTON({id: 'submit', className: 'btn btn-primary',   onClick: this.submit, disabled: false}, 'Submit'),
        )
    }
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

    cid = null      // CID (Category ID) of this item; cannot be undefined, only "null" if missing
    iid = null      // IID (Item ID within a category) of this item; cannot be undefined, only "null" if missing

    data            // data fields of this item, as a Data object; can hold a Promise, so it always should be awaited for,
                    // or accessed after await load(), or through item.get()
    metadata        // system properties: current version, category's version, status etc.

    category        // parent category of this item, as an instance of Category
    registry        // Registry that manages access to this item
    expiry          // timestamp when this item instance should be considered expired in Ragistry.cache; managed by registry

    temporary = new Map()       // cache of temporary fields and their values; access through temp(); values can be promises

    get id()        { return [this.cid, this.iid] }
    get id_str()    { return `[${this.cid},${this.iid}]` }
    get newborn()   { return this.iid === null }
    get loaded()    { return this.has_data() }

    has_id(id = null) {
        if (id) return this.cid === id[0] && this.iid === id[1]
        return this.cid !== null && this.iid !== null
    }
    has_data()      { return !!this.data }
    assertLoaded()  { if (!this.loaded) throw new ItemNotLoaded(this) }

    isinstance(category) {
        /*
        Check whether this item belongs to a category that inherits from `category` via a prototype chain.
        All comparisons along the way use IDs of category items, not object identity. This item's category must be loaded.
        */
        return this.category.issubcat(category)
    }

    constructor(category = null, data = null) {
        if (data) this.data = data instanceof Data ? data : new Data(data)
        if (category) {
            this.category = category
            this.registry = category.registry
            this.cid      = category.iid
        }
    }

    loadThen(fun) { return this.load().then(fun) }

    async load(field = null, use_schema = true) {
        /* Load full data of this item (this.data) from a DB, if not loaded yet. Load category. Return this.data. */

        // if field !== null && field in this.loaded: return      // this will be needed when partial loading from indexes is available
        if (this.data) return this.data         //field === null ? this.data : T.getOwnProperty(this.data, field)

        if (!this.category) {
            assert(!T.isMissing(this.cid))
            this.category = await this.registry.getCategory(this.cid)
            let itemclass = this.category.getClass()
            T.setClass(this, itemclass)                 // change the actual class of this item from Item to `itemclass`
        }
        if (this.category !== this) await this.category.load()

        // store a Promise that will eventually load this item's data, this is to avoid race conditions;
        // the promise will be replaced in this.data with an actual `data` object when ready
        this.data = this.reload(use_schema)

        return this.data
    }
    afterLoad(data) {
        /* Any extra initialization after the item's data is loaded but NOT yet stored in this.data.
           This initialization could NOT be implemented by overriding load() or reload(),
           because the class may NOT yet be determined and attached to `this` when load() is called (!)
           Subclasses may override this method, either as sync or async method.
         */
    }

    async reload(use_schema = true, record = null) {
        /* Return this item's data object newly loaded from a DB or from a preloaded DB `record`. */
        //print(`${this.id_str}.reload() started...`)
        if (!record) {
            if (!this.has_id()) throw new Error(`trying to reload an item with missing or incomplete ID: ${this.id_str}`)
            record = await this.registry.loadData(this.id)
        }
        let flat   = record.data
        let schema = use_schema ? this.getSchema() : generic_schema
        let state  = (typeof flat === 'string') ? JSON.parse(flat) : flat
        let data   = schema.decode(state)
        let after  = this.afterLoad(data)                   // optional extra initialization after the data is loaded
        if (after instanceof Promise) await after
        this.data  = data

        let ttl_ms  = this.category.get('cache_ttl') * 1000
        this.expiry = Date.now() + ttl_ms
        // print('ttl:', ttl_ms/1000, `(${this.id_str})`)

        return data
        // TODO: initialize item metadata - the remaining attributes from `record`
    }

    async set(path, value, props) {
        await this.load()
        this.data.set(path, value, props)           // TODO: create and use EditableItem instead
        return this.registry.update(this)
    }

    get(path, default_ = undefined) {

        this.assertLoaded()

        // search in this.data
        let value = this.data.get(path)
        if (value !== undefined) return value

        // search in category's defaults
        if (this.category !== this) {
            let cat_default = this.category.getDefault(path)
            if (cat_default !== undefined)
                return cat_default
        }

        return default_
    }
    getAll(key) {
        /* Return an array (possibly empty) of all values assigned to a given `key` in this.data.
           Default value (if defined) is NOT used.
         */
        this.assertLoaded()
        return this.data.getAll(key)
    }
    async getLoaded(path, default_ = undefined) {
        /* Retrieve a related item identified by `path` and load its data, then return this item. Shortcut for get+load. */
        let item = this.get(path, default_)
        if (item !== default_) await item.load()
        return item
    }

    // getEntries(order = 'schema') {
    //     /*
    //     Retrieve a list of this item's fields and their values.
    //     Multiple values for a single field are returned as separate entries.
    //     */
    //     this.assertLoaded()
    //     return this.data.getEntries()
    //
    //     // let fields  = this.category.getFields()
    //     // let entries = []
    //     //
    //     // function push(f, v) {
    //     //     if (v instanceof multiple)
    //     //         for (w of v.values()) entries.push([f, w])
    //     //     else
    //     //         entries.push([f, v])
    //     // }
    //     // // retrieve entries by their order in category's schema
    //     // for (const f in fields) {
    //     //     let v = T.getOwnProperty(data, f)
    //     //     if (v !== undefined) push(f, v)
    //     // }
    //     // // add out-of-schema entries, in their natural order (of insertion)
    //     // for (const f in data)
    //     //     if (!fields.hasOwnProperty(f)) push(f, data[f])
    //     //
    //     // return entries
    // }

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
            let url = this.category.url({raise: false})
            if (url) cat = `<a href="${url}">${cat}</a>`          // TODO: security; {url} should be URL-encoded or injected in a different way
        }
        let stamp = `${cat}:${this.iid}`
        if (!brackets) return stamp
        return `[${stamp}]`
    }
    getSchema() {
        /* Return schema of this item as defined in its category. The schema is an instance of DATA (subclass of Schema). */
        assert(this.category)
        return this.category.temp('schema')                         // calls _temp_schema() of this.category
    }

    temp(field) {
        /* Calculate and return a value of a temporary `field`. For the calculation, method _temp_FIELD() is called
           (can be async). The value (or a promise) is computed once and cached in this.temporary for subsequent
           temp() calls. Whether the result should be awaited depends on a particular _temp_FIELD() method -
           the caller should be aware that a given field returns a promise and handle it appropriately.
         */
        this.assertLoaded()
        if (this.temporary.has(field)) return this.temporary.get(field)
        let fun = this[`_temp_${field}`]
        if (!fun) throw new Error(`method '_temp_${field}' not found for a temporary field`)
        let value = fun.bind(this)()
        this.temporary.set(field, value)        // this may store a promise
        return value                            // this may return a promise
    }

    async getEditable() {
        /* DRAFT. Make a copy of this Item object and extend it with methods from EditableItem. */
        return this.registry.getEditable(this.id)
        // let item = T.clone(this)
        // if (this.data) item.data = new Data(await this.data)
        // return item
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

    url(endpoint = null, params = {}) {
        /* `endpoint` can be a string that will be appended to `params`, or an object that will be used instead of `params`. */
        if (typeof endpoint === "string") params.endpoint = endpoint
        else if (endpoint) params = endpoint

        let {raise = true, warn = true, ...params_} = params
        let  site  = this.registry.site
        try {return site.buildURL(this, params_)}
        catch (ex) {
            if (raise) throw ex
            if (warn) console.log(`WARNING: exception raised in .url() of item ${this}`)
            return null
        }
    }

    /***  Client-server communication protocols (operation chains)  ***/

    // delete = Protocol({
    //     onclient:  async function () {},         // bound to `delete` when called on client
    //     onserver:  async function () {},         // bound to `delete` when called on a web app process, or a db process
    //     onfront:   async function () {},   (web handler)
    //     onback:    ...                     (db handler)
    // })

    /***  Handlers (server side)  ***/

    async handle(session, app = null) {
        /*
        Serve a web request submitted to a given @endpoint of this item.
        Endpoints map to Javascript "handler" functions stored in a category's "handlers" property:

           function handler({item, session, req, res, endpoint})

        or as methods of a particular Item subclass, named `_handle_{endpoint}`.
        In every case, the function's `this` is bound to `item` (this===item).
        A handler function can directly write to the response, and/or return a string that will be appended.
        The function can return a Promise (async function). It can have an arbitrary name, or be anonymous.
        */
        session.item = this
        if (app) session.app = app
        let endpoint = session.getEndpoint()
        await this.load()       // needed to have this.category below initialized

        let handler
        let handlers = this.category.getHandlers()
        let source   = handlers.get(endpoint)

        // get handler's source code from category's properties?
        if (source) {
            handler = eval('(' + source + ')')      // surrounding (...) are required when parsing a function definition
            // TODO: parse as a module with imports, see https://2ality.com/2019/10/eval-via-import.html
        }
        else                                        // fallback: get handler from the item's class
            handler = this[`_handle_${endpoint}`]

        if (!handler) throw new Error(`Endpoint "${endpoint}" not found`)

        let [req, res] = session.channels
        let page = handler.call(this, {item: this, req, res, endpoint, session})
        if (page instanceof Promise) page = await page
        if (typeof page === 'string')
            res.send(page)
    }

    async _handle_set({req, res}) {
        assert(req.method === 'POST')
        let {path, value} = req.body
        // let schema = this.getSchema(path)
        // print(`_handle_set: path ${path}, value ${value}`)
        await this.set(path, value)
        return res.json({})
    }
    async _handle_delete({res}) {
        await this.registry.delete(this)
        return res.json({})
    }
    _handle_json({res}) { res.sendItem(this) }

    _handle_view({session, req, res, endpoint}) {
        let name = this.getName('')
        let ciid = this.getStamp({html: false})
        return this.HTML({
            title: `${name} ${ciid}`,
            body:  this.BOOT({session}),
        })
    }

    async remote(endpoint, data, {args, params} = {}) {
        /* Connect from client to an `endpoint` of an internal API; send `data` if any;
           return a response body parsed from JSON to an object.
         */
        let url = this.url(endpoint)
        let res = await fetchJson(url, data, params)        // Response object
        if (!res.ok) throw new ServerError(res)
        return res.json()
        // let txt = await res.text()
        // return txt ? JSON.parse(txt) : undefined
        // throw new Error(`server error: ${res.status} ${res.statusText}, response ${msg}`)
    }

    async remote_delete()   { return this.remote('delete') }
    async remote_set(args)  { return this.remote('set', args) }

    HTML({title, body}) { return `
        <!DOCTYPE html><html>
        <head>
            <title>${title}</title>
            <script src="https://cdn.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js" integrity="sha256-/xUj+3OJU5yExlq6GSYGSHk7tPXikynS7ogEvDej/m4=" crossorigin="anonymous"></script>

            <!-- Bootstrap should only be used for widgets and in-block layout, not for page layout -->
            <link  href="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-EVSTQN3/azprG1Anm3QDgpJLIm9Nao0Yz1ztcQTwFspd3yD65VohhpuuCOmLASjC" crossorigin="anonymous" />
            <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/js/bootstrap.bundle.min.js" integrity="sha384-MrcW6ZMFYlzcLA8Nl+NtUVF0sA7MsXsP1UyJoMp4YLEuNSfAP+JcXn/tWtIaxVXM" crossorigin="anonymous"></script>
        
            <script src="https://unpkg.com/react@17/umd/react.development.js" crossorigin></script>
            <script src="https://unpkg.com/react-dom@17/umd/react-dom.development.js" crossorigin></script>
        
            <script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/ace.min.js" integrity="sha512-jB1NOQkR0yLnWmEZQTUW4REqirbskxoYNltZE+8KzXqs9gHG5mrxLR5w3TwUn6AylXkhZZWTPP894xcX/X8Kbg==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/mode-javascript.min.js" integrity="sha512-37ta5K4KVYs+MEmIg2xnZxJrdiQmBSKt+JInvyPrq9uz7aF67lMJT/t91EYoYj520jEcGlih41kCce7BRTmE3Q==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
            <!--<script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/worker-base.min.js" integrity="sha512-+nNPckbKGLDhLhi4Gz1Y1Wj5Y+x6l7Qw0EEa7izCznLGTl6CrYBbMUVoIm3OfKW8u82JP0Ow7phPPHdk26Fo5Q==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>-->
            <!--<script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/worker-javascript.min.js" integrity="sha512-hwPBZJdHUlQzk8FedQ6S0eqJw/26H3hQ1vjpdAVJLaZU/AJSkhU29Js3/J+INYpxEUbgD3gubC7jBBr+WDqS2w==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>-->
<!--            <script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/theme-textmate.min.js" integrity="sha512-VE1d8sDypa2IvfFGVnil5k/xdGWtLTlHk/uM0ojHH8b2RRF75UeUBL9btDB8Hhe7ei0TT8NVuHFxWxh5NhdepQ==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>-->
            <script>ace.config.set("basePath", "https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/")</script>
            
            <link href="/files/assets/favicon.ico" rel="icon" type="image/x-icon" />
            <link href="/files/assets/styles.css" rel="stylesheet" />
        </head>
        <body>${body}</body>
        </html>
    `}
    // inlined favicon:  <link href="data:image/x-icon;base64,AAABAAEAEBAQAAEABAAoAQAAFgAAACgAAAAQAAAAIAAAAAEABAAAAAAAgAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAmYh3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQEBAQEBAQEQEBAQEBAQEAEBAQEBAQEBEBAQEBAQEBABAQEBAQEBARAQEBAQEBAQAQEBAQEBAQEQEBAQEBAQEAEBAQEBAQEBEBAQEBAQEBABAQEBAQEBARAQEBAQEBAQAQEBAQEBAQEQEBAQEBAQEAEBAQEBAQEBEBAQEBAQEBCqqgAAVVUAAKqqAABVVQAAqqoAAFVVAACqqgAAVVUAAKqqAABVVQAAqqoAAFVVAACqqgAAVVUAAKqqAABVVQAA" rel="icon" type="image/x-icon" />

    BOOT({session}) { return `
        <p id="data-session" style="display:none">${JSON.stringify(session.dump())}</p>
        <div id="react-root">${this.render()}</div>
        <script type="module">
            import { boot } from "/files/client.js"
            boot()
        </script>
    `}

    /***  Components (server side & client side)  ***/

    render(targetElement = null) {
        /* Render this item into an HTMLElement (client-side) if `targetElement` is given,  or to a string
           (server-side) otherwise. When rendering server-side, useEffect() & delayed_render() do NOT work,
           so only a part of the HTML output is actually rendered. For workaround, see:
            - https://github.com/kmoskwiak/useSSE  (useSSE, "use Server-Side Effect" hook)
            - https://medium.com/swlh/how-to-use-useeffect-on-server-side-654932c51b13
            - https://dev.to/kmoskwiak/my-approach-to-ssr-and-useeffect-discussion-k44
         */
        // TODO: use server-side caching of this function, like with temp() and temporary variables,
        //       to avoid repeated SSR rendering of the same item in consecutive requests
        let elem = e(this.Page.bind(this))
        return targetElement ? ReactDOM.render(elem, targetElement) : ReactDOM.renderToString(elem)
        // might use ReactDOM.hydrate() not render() in the future to avoid full re-render client-side
    }

    Page({extra = null}) {                                  // React functional component
        return DIV(
            e(this.Title.bind(this)),
            H2('Properties'),                               //{style: {color:'blue'}}
            e(this.DataTable.bind(this)),
            extra,
        )
    }

    Title() {
        let name = this.getName()
        let ciid = this.getStamp()
        if (name)
            return H1(name, ' ', SPAN({style: {fontSize:'40%', fontWeight:"normal"}, ...HTML(ciid)}))
        else
            return H1(HTML(ciid))
    }

    DataTable() {
        /* Display this item's data as a Catalog.Table with possibly nested Catalog objects. */
        this.assertLoaded()
        let data = this.data
        let styles = this.getSchema().getStyles()
        let changes = new Changes(this)
        let catalog = e(data.Table.bind(data), {
            item:           this,
            schemas:        this.category.getFields(),
            path:           [],
            start_color:    1,                                      // color of the first row: 1 or 2
        })
        return DIV({className: 'DataTable'},
                    !!styles.size && STYLE(styles.getCSS()),
                    catalog, e(changes.Buttons.bind(changes)))
    }
}

/**********************************************************************************************************************/

class EditableItem extends Item {
    /* A set of methods appended through monkey-patching to an item object to make it editable (see Item.editable()).
       Edit methods should be synchronous. They can assume this.data is already loaded, no need for awaiting.
     */

    actions         // list of edit actions executed on this item so far; submitted to DB on commit for DB-side replay

    edit(action, args) {
        let method = this[`_edit_${action}`]
        if (!method) throw new Error(`edit action "${action}" not found in ${this}`)
        let result = method.bind(this)(args)
        this.edits.push([action, args])
        return result
    }

    push(key, value, {label, comment} = {}) {
        /* Shortcut for edit('push', ...) */
        return this.edit('push', {key, value, label, comment})
    }
    set(path, value, props) { this.data.set(path, value, props) }

    _edit_push(entry) { return this.data.pushEntry(entry) }
    _edit_set (entry) { return this.data.setEntry (entry) }
}

/**********************************************************************************************************************/

export class Category extends Item {
    /*
    A category is an item that describes other items: their schema and functionality;
    also acts as a manager that controls access to and creation of new items within category.
    */

    async afterLoad(data) {
        /* Load all prototypes of this category, so that getDefault() and mergeInherited() can work synchronously later on. */
        let proto = data.getAll('prototype')
        if (proto.length) return Promise.all(proto.map(p => p.load()))
    }

    new(data = null, iid = null) {
        /*
        Create a newborn item of this category (not yet in DB); connect it with this.registry;
        set its IID, or mark as pending for insertion to DB if no `iid` provided.
        */
        let itemclass = this.getClass()
        let item = new itemclass(this, data)
        if (iid !== null) item.iid = iid
        else this.registry.stage(item)              // mark `item` for insertion on the next commit()
        return item
    }
    issubcat(category) {
        /*
        Return true if `this` inherits from `category`, or is `category` (by ID comparison).
        Inheritance means that the ID of `category` is present on an item-prototype chain of `this`.
        */
        if (this.has_id(category.id)) return true
        let prototypes = this.getAll('prototype')
        for (const proto of prototypes)
            if (proto.issubcat(category)) return true
        return false
    }
    getFields()       { return this.temp('fields_all') }            // calls _temp_fields_all()
    getHandlers()     { return this.temp('handlers_all') }          // calls _temp_handlers_all()

    getClass() {
        let name = this.get('class_name')
        let code = this.get('class_code')
        if (code)
            return eval(code)
            // TODO: save the newly created class to registry as a subclass NAME_XXX of Item
            // TODO: check this.data for individual methods & templates to be treated as methods

        assert(name, `no class_name defined for category ${this}: ${name}`)
        return this.registry.getClass(name)
    }
    getItem(iid) {
        /*
        Instantiate a stub of an Item and seed it with IID (the IID being present in DB, presumably, not checked),
        but do NOT load remaining contents from DB (lazy loading).
        */
        return this.registry.getItem([this.iid, iid])
    }
    getDefault(field, default_ = undefined) {
        /* Get default value of a field from category schema. Return `default` if no category default is configured. */
        this.assertLoaded()
        let fields = this.getFields()
        let schema = fields.get(field)
        return schema ? schema.default : default_
    }

    mergeInherited(field) {
        /* Merge all catalogs found at a given `field` in all base categories of this, `this` included.
           It's assumed that the catalogs have unique non-missing keys.
           If a key is present in multiple catalogs, its first occurrence is used (closest to `this`).
           A possibly better method for MRO (Method Resolution Order) is C3 used in Python3:
           https://en.wikipedia.org/wiki/C3_linearization
           http://python-history.blogspot.com/2010/06/method-resolution-order.html
         */
        let catalog    = new Catalog()
        let prototypes = this.getAll('prototype')
        for (const proto of [this, ...prototypes]) {
            let cat = proto.get(field)
            if (!cat) continue
            for (const entry of cat)
                if (entry.key !== undefined && !catalog.has(entry.key))
                    catalog.pushEntry({...entry})
        }
        return catalog
    }

    _temp_schema() {
        let fields = this.getFields()
        return new DATA(fields.asDict())
    }
    _temp_fields_all() {
        /* The 'fields_all' temporary variable: a catalog of all fields of this category including the inherited ones. */
        return this.mergeInherited('fields')
    }
    _temp_handlers_all() {
        /* The 'handlers_all' temporary variable: a catalog of all handlers of this category including the inherited ones. */
        return this.mergeInherited('handlers')
    }

    async _handle_scan({res}) {
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
    async _handle_new({req, res}) {
        /* Web handler to create a new item in this category based on request data. */
        // print('in _handle_new()...')
        // print('request body:  ', req.body)
        assert(req.method === 'POST')

        // req.body is an object representing state of a Data instance, decoded from JSON by middleware
        let data = await (new Data).__setstate__(req.body)
        let item = this.new(data)
        await this.registry.commit()
        // print('new item.id:', item.id)
        // print('new item.data:', item.data)
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
                let url  = item.url({raise: false})
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

        let form  = useRef(null)

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
                this.registry.db.keep(record)
                let item = await this.registry.getItem([record.cid, record.iid])
                itemAdded(item)
                form.current.reset()            // clear input fields
            }
            setFormDisabled(false)
        }

        return FORM({ref: form}, FIELDSET(
            // LABEL('Name: ', INPUT({name: 'name'}), ' '),
            INPUT({name: 'name', placeholder: 'name'}),
            BUTTON({type: 'submit', onClick: submit}, 'Create Item'),
        ))
    }

    Page({extra = null}) {
        const scan = () => this.registry.scanCategory(this)         // returns an async generator that requires "for await"
        const [items, setItems] = useState(scan())                  // existing child items; state prevents re-scan after every itemAdded()

        const [newItems, setNewItems] = useState([])                // newly added items
        const itemAdded   = (item) => { setNewItems(prev => [...prev, item]) }
        const itemRemoved = (item) => { setNewItems(prev => prev.filter(i => i !== item)) }

        return super.Page({item: this, extra: FRAGMENT(
            H2('Items'),
            e(this.Items, {items: items, itemRemoved: () => setItems(scan())}),
            H3('Add item'),
            e(this.Items, {items: newItems, itemRemoved}),
            e(this.NewItem.bind(this), {itemAdded}),
            extra,
        )})
    }
}


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

