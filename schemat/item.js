import {e, delayed_render, NBSP, DIV, A, P, H1, H2, SPAN, TABLE, TH, TR, TD, TBODY, BUTTON, FRAGMENT, HTML} from './utils.js'
import { print, assert, T, escape_html } from './utils.js'
import { generic_schema, OBJECT, CATALOG, DATA } from './types.js'
import { JSONx } from './serialize.js'
import { Data, Catalog } from './data.js'

export const ROOT_CID = 0


/**********************************************************************************************************************
 **
 **  UI COMPONENTS
 **
 */

function Catalog1({item}) {
    return delayed_render(async () => {
        let start_color = 0                                   // color of the first row: 0 or 1
        let category = item.category
        let entries = await item.getEntries()
        let schemas = await category.get_fields()

        let rows = entries.map(({key:field, value}, i) => {
            let schema = schemas.get(field)
            let color  = (start_color + i) % 2
            return TR({className: `ct-color${color}`},
                      schema instanceof CATALOG
                        ? TD({className: 'ct-nested', colSpan: 2},
                            DIV({className: 'ct-field'}, field),
                            e(Catalog2, {data: value, schema: schema.values, color})
                        )
                        : e(Entry, {field, value, schema})
            )
        })
        return TABLE({className: 'catalog-1'}, TBODY(...rows))
    })
}

function Catalog2({data, schema, color = 0}) {
    return DIV({className: 'wrap-offset'},
            TABLE({className: 'catalog-2'},
              TBODY(...data.getEntries().map(({key:field, value}) =>
                TR({className: `ct-color${color}`}, e(Entry, {field, value, schema})))
           )))
}

function Entry({field, value, schema = generic_schema}) {
    /* A table row containing an atomic value of a data field (not a subcatalog). */
    return FRAGMENT(
                TH({className: 'ct-field'}, field),
                TD({className: 'ct-value'}, schema.Widget({value})),
           )
}

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

    Buttons = ({changes}) =>
        DIV({style: {textAlign:'right', paddingTop:'20px'}},
            BUTTON({id: 'reset' , className: 'btn btn-secondary', onClick: changes.reset,  disabled: false}, 'Reset'), ' ',
            BUTTON({id: 'submit', className: 'btn btn-primary',   onClick: changes.submit, disabled: false}, 'Submit'),
        )
}


/**********************************************************************************************************************
 **
 **  ITEM & CATEGORY
 **
 */

export class Item {

    /*
    TODO: Item's metadata, in this.data.__meta__ OR this.meta (?)
    >> meta fields are accessible through this.get('#FIELD')
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
    ? status   -- enum, "deleted" for tombstone items
    ? name     -- for fast generation of lists of hyperlinks without loading full data for each item; length limit ~100
    ? info     -- a string like `name`, but longer ~300-500 ??
    */

    cid = null      // CID (Category ID) of this item; cannot be undefined, only "null" if missing
    iid = null      // IID (Item ID within a category) of this item; cannot be undefined, only "null" if missing

    /*
    data            - data fields of this item, as a plain object {..}; in the future, MultiDict can be used instead;
                      `data` can hold a Promise, so it always should be awaited or accessed directly after await load();
                      callers should rather use item.get() to access individual fields
    category        - parent category of this item, as an instance of Category
    registry        - Registry that manages access to this item (should refer to the unique global registry)
    */

    //loaded = null;    // names of fields that have been loaded so far

    get id()        { return [this.cid, this.iid] }
    get id_str()    { return `[${this.cid},${this.iid}]` }

    has_id(id = null) {
        if (id) return this.cid === id[0] && this.iid === id[1]
        return this.cid !== null && this.iid !== null
    }
    has_data() { return !!this.data }

    async isinstance(category) {
        /*
        Check whether this item belongs to a category that inherits from `category` via a prototype chain.
        All comparisons along the way use IDs of category items, not object identity.
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

    // static async fromDump(state, category = null, use_schema = true) {
    //     /* Recreate an item that was encoded at the server with Item.encodeSelf(). */
    //     let schema = use_schema ? await category.get_schema() : generic_schema
    //     let data = await schema.decode(state['data'])
    //     delete state['data']
    //
    //     let item = new Item(category, data)
    //     Object.assign(item, state)                  // copy remaining metadata from `state` to `item`
    //     return item
    // }

    async load(field = null, use_schema = true) {
        /* Load this item's data (this.data) from a DB, if not loaded yet. Return this object. */

        // if field !== null && field in this.loaded: return      // this will be needed when partial loading from indexes is available

        if (this.data) {
            await this.data
            return this         //field === null ? this.data : T.getOwnProperty(this.data, field)
        }

        // store and return a Promise that will eventually load this item's data;
        // the promise will be replaced in this.data with an actual `data` object when ready
        this.data = this.reload(use_schema)
        // this.bind()

        await this.data
        return this
        // if (field !== null && data.hasOwnProperty(field)) return this.data[field]
    }
    async reload(use_schema = true, record = null) {
        /* Return this item's data object newly loaded from a DB or from a preloaded DB `record`. */
        print(`${this.id_str}.reload() started...`)
        if (!record) {
            if (!this.has_id()) throw new Error(`trying to reload an item with missing or incomplete ID: ${this.id_str}`)
            record = await this.registry.load_record(this.id)
        }
        let flat   = record.data
        let schema = use_schema ? await this.category.get_schema() : generic_schema
        let state  = (typeof flat === 'string') ? JSON.parse(flat) : flat
        this.data  = await schema.decode(state).then(d => new Data(d))
        // TODO: initialize item metadata - the remaining attributes from `record`

        print(`${this.id_str}.reload() done`)
        return this.data
    }

    async ciid({html = true, brackets = true, max_len = null, ellipsis = '...'} = {}) {
        /*
        "Category-Item ID" (CIID) string (stamp, emblem) having the form:
        - [CATEGORY-NAME:IID], if the category of this has a "name" property; or
        - [CID:IID] otherwise.
        If html=true, the first part (CATEGORY-NAME or CID) is hyperlinked to the category's profile page
        (unless URL failed to generate) and the CATEGORY-NAME is HTML-escaped. If max_len is not null,
        CATEGORY-NAME gets truncated and suffixed with '...' to make its length <= max_len.
        */
        let cat = await this.category.get('name', this.cid.toString())
        if (max_len && cat.length > max_len) cat = cat.slice(max_len-3) + ellipsis
        if (html) {
            cat = escape_html(cat)
            let url = await this.category.url('')
            if (url) cat = `<a href=${url}>${cat}</a>`
        }
        let stamp = `${cat}:${this.iid}`
        if (!brackets) return stamp
        return `[${stamp}]`
    }

    async push(key, value, {label, comment} = {}) {
        await this.load()
        this.data.pushEntry({key, value, label, comment})
    }
    async set(key, value, {label, comment} = {}) {
        await this.load()
        if (this.data instanceof Data)
            this.data.set(key, value, {label, comment})
        else
            this.data[key] = value
    }
    async get(field, default_ = undefined) {
        // if (!this.data) await this.load()           // TODO: expect explicit pre-loading by caller; remove "async" in this and related methods
        await this.load()

        if (this.data instanceof Data) {
            let value = this.data.get(field)
            if (value !== undefined) return value
        }
        else if (this.data.hasOwnProperty(field))
            return this.data[field]

        if (this.category !== this) {
            let cat_default = await this.category.get_default(field)
            if (cat_default !== undefined)
                return cat_default
        }
        return default_
    }

    async getEntries(order = 'schema') {
        /*
        Retrieve a list of this item's fields and their values.
        Multiple values for a single field are returned as separate entries.
        */
        await this.load()
        return this.data.getEntries()

        // let fields  = await this.category.get_fields()
        // let entries = []
        //
        // function push(f, v) {
        //     if (v instanceof multiple)
        //         for (w of v.values()) entries.push([f, w])
        //     else
        //         entries.push([f, v])
        // }
        // // retrieve entries by their order in category's schema
        // for (const f in fields) {
        //     let v = T.getOwnProperty(data, f)
        //     if (v !== undefined) push(f, v)
        // }
        // // add out-of-schema entries, in their natural order (of insertion)
        // for (const f in data)
        //     if (!fields.hasOwnProperty(f)) push(f, data[f])
        //
        // return entries
    }

    async encodeData(use_schema = true) {
        /* Encode this.data into a JSON-serializable dict composed of plain JSON objects only, compacted. */
        let schema = use_schema ? await this.category.get_schema() : generic_schema
        return schema.encode(await this.data)
    }
    async dumpData(use_schema = true, compact = true) {
        /* Dump this.data to a JSON string using schema-aware (if schema=true) encoding of nested values. */
        let state = await this.encodeData(use_schema)
        return JSON.stringify(state)
    }
    async encodeSelf(use_schema = true, load = true) {
        /* Encode this item's data & metadata into a JSON-serializable dict; `registry` and `category` excluded. */
        if (load) await this.load()
        let {registry, category, ...state} = this               // Registry is not serializable, must be removed now and imputed after deserialization
        state.data = await this.encodeData(use_schema)
        return state
    }
    async bootItems() {
        /* List of state-encoded items to be sent over to a client to bootstrap client-side item cache. */
        let items = [this, this.category, this.registry.root]
        items = [...new Set(items)].filter(Boolean)                 // remove duplicates and nulls
        return T.amap(items, async i => i.encodeSelf())
    }
    async bootData() {
        /* Request and configuration data to be embedded in HTML response; .request is state-encoded. */
        // let req = this.registry.current_request
        // let request  = {item: this, app, state}
        let {item, app, state} = this.registry.current_request
        let request  = {item, app, state}
        let ajax_url = await (await this.registry.site).ajax_url()
        return {'ajax_url': ajax_url, 'request': JSONx.encode(request)}
    }
    
    async url(route = null, {raise = false, args = null} = {}) {
        /*
        Return a *relative* URL of this item as assigned by the current Application (if route=null),
        that is, by the one that's processing the current web request; or an *absolute* URL
        assigned by an application anchored at a given route.
        route=null should only be used during request processing, when a current app is defined.
        */
        try {
            if (route === null) {
                let app  = this.registry.current_request.app
                let path = await app.url_path(this, args)
                return './' + path      // ./ informs the browser this is a relative path, even if dots and ":" are present similar to a domain name with http port
            }
            let site = await this.registry.site
            return await site.get_url(this, route, args)
        }
        catch (ex) { if (raise) {throw ex} else return null }
    }


    /***  Handlers (server side)  ***/

    async serve(req, res, app, endpoint = null) {
        /*
        Serve a web request submitted to a given @endpoint of this item.
        Endpoints map to Javascript "handler" functions stored in a category's "handlers" property:

           function handler({item, req, res, app, endpoint})

        or as methods of a particular Item subclass, named `_handler_{endpoint}`.
        In every case, the function's `this` is bound to `item` (this===item).
        A handler function can directly write to the response, and/or return a string that will be appended.
        The function can return a Promise (async function). It can have an arbitrary name, or be anonymous.
        */
        req.item = this
        req.app  = app
        endpoint = endpoint || 'view'

        // get handler's source code from category's data
        // let source = await this.category.get(`handlers/${endpoint}`)
        let handlers = await this.category.get('handlers', new Catalog())   // TODO: get(`handlers/${endpoint}`)
        let source   = handlers.get(endpoint)
        let handler

        if (source) {
            handler = eval('(' + source + ')')      // surrounding (...) are required when parsing a function definition
            // TODO: parse as a module with imports, see https://2ality.com/2019/10/eval-via-import.html
        }
        else                                        // fallback: get handler from the item's class
            handler = this[`_handler_${endpoint}`]

        if (!handler) throw new Error(`Endpoint "${endpoint}" not found`)

        handler = handler.bind(this)
        let page = handler({item: this, req, res, endpoint, app})
        if (page instanceof Promise) page = await page
        if (typeof page === 'string')
            res.send(page)
    }

    async _handler_json({res}) {
        /* Send JSON representation of this item: its data (encoded) and metadata. */
        let state = await this.encodeSelf()
        res.json(state)
    }

    async _handler_view({req, res, app, endpoint}) {

        let name = await this.get('name', '')
        let ciid = await this.ciid({html: false})
        return this.HTML({
            title: `${name} ${ciid}`,
            body:  await this.BOOT(),
        })
    }

    HTML({title, body}) { return `
        <!DOCTYPE html><html>
        <head>
            <title>${title}</title>
            <script src="https://cdn.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js" integrity="sha256-/xUj+3OJU5yExlq6GSYGSHk7tPXikynS7ogEvDej/m4=" crossorigin="anonymous"></script>
            <link  href="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-EVSTQN3/azprG1Anm3QDgpJLIm9Nao0Yz1ztcQTwFspd3yD65VohhpuuCOmLASjC" crossorigin="anonymous" />
            <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/js/bootstrap.bundle.min.js" integrity="sha384-MrcW6ZMFYlzcLA8Nl+NtUVF0sA7MsXsP1UyJoMp4YLEuNSfAP+JcXn/tWtIaxVXM" crossorigin="anonymous"></script>
        
            <script src="https://unpkg.com/react@17/umd/react.development.js" crossorigin></script>
            <script src="https://unpkg.com/react-dom@17/umd/react-dom.development.js" crossorigin></script>
        
            <script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.12/ace.js" integrity="sha512-GZ1RIgZaSc8rnco/8CXfRdCpDxRCphenIiZ2ztLy3XQfCbQUSCuk8IudvNHxkRA3oUg6q0qejgN/qqyG1duv5Q==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
        
            <link href="data:image/x-icon;base64,AAABAAEAEBAQAAEABAAoAQAAFgAAACgAAAAQAAAAIAAAAAEABAAAAAAAgAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAmYh3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQEBAQEBAQEQEBAQEBAQEAEBAQEBAQEBEBAQEBAQEBABAQEBAQEBARAQEBAQEBAQAQEBAQEBAQEQEBAQEBAQEAEBAQEBAQEBEBAQEBAQEBABAQEBAQEBARAQEBAQEBAQAQEBAQEBAQEQEBAQEBAQEAEBAQEBAQEBEBAQEBAQEBCqqgAAVVUAAKqqAABVVQAAqqoAAFVVAACqqgAAVVUAAKqqAABVVQAAqqoAAFVVAACqqgAAVVUAAKqqAABVVQAA" rel="icon" type="image/x-icon" />
            <link href="/files/style.css" rel="stylesheet" />
        </head>
        <body>${body}</body>
        </html>
    `}

    async BOOT() { return `
        <p id="data-items" style="display:none">${JSON.stringify(await this.bootItems())}</p>
        <p id="data-data" style="display:none">${JSON.stringify(await this.bootData())}</p>
        <div id="react-root"></div>
        <script type="module">
            import { boot } from "/files/client.js"
            boot()
        </script>
    `}


    /***  Components (server side & client side)  ***/

    display(target) {
        /* Render this item into a `target` HTMLElement. Client side. */
        ReactDOM.render(e(this.Page, {item: this}), target)
    }

    Title({item}) {
        return delayed_render(async () => {
            let name = await item.get('name', null)
            let ciid = await item.ciid()
            if (name)
                return H1(name, ' ', SPAN({style: {fontSize:'40%', fontWeight:"normal"}, ...HTML(ciid)}))
            else
                return H1(HTML(ciid))
        })
    }

    Page({item, extra = null}) {                                  // React functional component
        let changes = new Changes(item)
        return DIV(
            e(item.Title, {item}),
            H2('Properties'),                               //{style: {color:'blue'}}
            e(Catalog1, {item, changes}),
            e(changes.Buttons, {changes}),
            extra,
        )
    }

    // box model of a catalog of item properties:
    /*
        hw-item-properties
            table .catalog-1
                tr .ct-colorX                              // X = 0 or 1
                    // field with an atomic value:
                    th .ct-field
                    td .ct-value
                tr .ct-colorX
                    // field with a catalog of sub-fields:
                    td .ct-nested colspan=2
                        div .ct-field
                        div .wrap-offset : table .catalog-2
                            tr .ct-colorX
                                th .ct-field
                                td .ct-value
    */
}

/**********************************************************************************************************************/

export class Category extends Item {
    /*
    A category is an item that describes other items: their schema and functionality;
    also acts as a manager that controls access to and creation of new items within category.
    */

    async new(data = null, stage = true) {
        /*
        Create a newborn item of this category (not yet in DB); connect it with this.registry;
        mark it as pending for insertion to DB if stage=true (default).
        */
        let itemclass = await this.get_class()
        let item = new itemclass(this, data)
        if (stage) this.registry.stage(item)                    // mark `item` for insertion on the next commit()
        return item
    }
    async issubcat(category) {
        /*
        Return true if `this` is `category` (by item ID comparison) or inherits from it, i.e.,
        if ID of `category` is present on an item prototype chain(s) of `this`.
        */
        if (this.has_id(category.id)) return true
        let prototype = await this.get('prototype')        // TODO: support multiple prototypes (multibase inheritance)
        if (!prototype) return false
        return prototype.issubcat(category)
        // for (let base in prototypes)
        //     if (await base.issubcat(category)) return true
        // return false
    }
    async get_fields() { return await this.get('fields') }

    async get_class() {
        let name = await this.get('class_name')
        let code = await this.get('class_code')
        if (code)
            return eval(code)
            // TODO: save the newly created class to registry as a subclass NAME_XXX of Item
            // TODO: check this.data for individual methods & templates to be treated as methods

        assert(name, `no class_name defined for category ${this}: ${name}`)
        return this.registry.get_class(name)
    }
    async get_item(iid) {
        /*
        Instantiate an Item (a stub) and seed it with IID (the IID being present in DB, presumably, not checked),
        but do NOT load remaining contents from DB (lazy loading).
        */
        return this.registry.get_item([this.iid, iid])
    }
    async get_default(field, default_ = undefined) {
        /* Get default value of a field from category schema. Return `default` if no category default is configured. */
        let fields = await this.get_fields()
        let schema = fields.get(field)
        return schema ? schema.default : default_
    }
    async get_schema(field = null) {
        /* Return schema of a given `field` (if present), or an OBJECT schema of all fields. */
        let fields = await this.get_fields()
        if (!field)                                     // create and return a schema for the entire Item.data
            return new DATA(fields.asDict())
            // return new OBJECT(fields.asDict(), {strict: true})
        else                                            // return a schema for a selected field only
            return fields.get(field) || generic_schema
    }

    async _handler_scan({res}) {
        /* Retrieve all children of this category and return as a JSON.
           TODO: set a size limit & offset (pagination).
           TODO: let declare if full items (loaded), or meta-only, or naked stubs should be sent.
         */
        let items = []
        for await (const item of this.registry.scan_category(this))
            items.push(await item.encodeSelf())
        res.json(items)
    }

    Page({item}) {
        return delayed_render(async () => {
            let category = item
            let items = category.registry.scan_category(category)       // this is an async generator, requires "for await"
            let rows = []
            for await (const it of items) {
                let name = await it.get('name') || it.toString()
                let url  = await it.url()
                rows.push(TR(
                    TD(`#${it.iid} ${NBSP}`),
                    TD(url !== null ? A({href: url}, name) : `${name} (no URL)`),
                ))
            }
            return Item.prototype.Page({item, extra: FRAGMENT(H2('Items'), TABLE(TBODY(...rows)))})
        })
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

/**********************************************************************************************************************
 **
 **  SUBCLASSES
 **
 */

export class Site extends Item {
    /* Global configuration of all applications that comprise this website, with URL routing etc. */

    async get_url(item, route = '', opts = {}) {
        /* Return an absolute or relative URL of `item` as assigned by the application anchored at `route`.
         * `opts` may include: args (null), relative (false), no_base (false) */
        let app  = await this.get('application')
        let base = await this.get('base_url')
        let no_base = T.pop(opts, 'no_base')

        // relative URL
        let path = await app.url_path(item, route, opts)
        if (opts.relative) return path
        
        path = '/' + path
        if (no_base) return path                        // absolute URL without base

        if (base.endsWith('/')) base = base.slice(-1)
        return base + path                              // absolute URL with base
    }

    async handle(request, response) {
        /* Forward the request to a root application configured in the `app` property. */
        let app = await this.get('application')
        await app.execute(request.path, request, response)
    }

    async ajax_url() {
        /* Absolute base URL for AJAX calls originating at a client UI. */
        return (await this.get('base_url')) + '/ajax'
    }
}

export class Application extends Item {
    /*
    An application implements a mapping of URL paths to item methods, and the way back.
    Some application classes may support nested applications.
    INFO what characters are allowed in URLs: https://stackoverflow.com/a/36667242/1202674
    */
    static SEP_ROUTE    = '/'      // separator of route segments in URL, each segment corresponds to another (sub)application
    static SEP_ENDPOINT = '@'
    
    async url_path(item, route = '', opts = {}) {
        /*
        Generate URL path (URL fragment after route) for `item`, possibly extended with a non-default
        endpoint designation and/or arguments to be passed to a handler function or a template.
        If relative=true, the path is relative to a given application `route`; otherwise,
        it is absolute, i.e., includes segments for all intermediate applications;
        the path does NOT have a leading separator, or it has a different meaning -
        in any case, a leading separator should be appended by caller if needed.
        `opt` may include: endpoint (null), relative (true), args (null)
        */
        throw new Error()
    }
    _set_endpoint(url, {endpoint = null, args = null}) {
        if (endpoint) url += `${Application.SEP_ENDPOINT}${endpoint}`
        if (args) url += '?' + new URLSearchParams(args).toString()
        return url
    }

    async execute(action, request, response) {
        /*
        Execute an `action` that originated from a web `request` and emit results to a web `response`.
        Typically, `action` is a URL path or subpath that points to an item and its particular view
        that should be rendered in response; this is not a strict rule, however.

        When spliting an original request.path on SEP_ROUTE, parent applications should ensure that
        the separatoror (if present) is preserved in a remaining subpath, so that sub-applications
        can differentiate between URLs of the form ".../PARENT/" and ".../PARENT".
        */
        throw new Error('method not implemented in a subclass')
    }
    _split_endpoint(path) {
        /* Decode @endpoint from the URL path. Return [subpath, endpoint]. */
        // if ('?' in path)
        //     path = path.split('?')[0]
        if (path.includes(Application.SEP_ENDPOINT)) {
            let parts = path.split(Application.SEP_ENDPOINT)
            if (parts.length !== 2) throw new Error(`unknown URL path: ${path}`)
            return parts
        }
        else return [path, '']
    }
}

export class AppRoot extends Application {
    /* A set of sub-applications, each bound to a different URL prefix. */

    async _route(path) {
        /*
        Make one step forward along a URL `path`. Return the extracted route segment (step),
        the associated application object, and the remaining subpath.
        */
        let lead = 0, step

        // consume leading '/' (lead=1) when it's followed by text, but treat it as terminal
        // and preserve in a returned subpath otherwise
        if (path.startsWith(Application.SEP_ROUTE)) {
            lead = (path.length >= 2)
            step = path.slice(1).split(Application.SEP_ROUTE)[0]
        } else
            step = path.split(Application.SEP_ROUTE)[0]
        
        let apps = await this.get('apps')
        let app  = apps.get(step)
        
        if (step && app)                        // non-default (named) route can be followed with / in path
            return [step, app, path.slice(lead + step.length)]
        
        if (apps.has(''))                      // default (unnamed) route has special format, no "/"
            return ['', apps.get(''), path]
        
        throw new Error(`URL path not found: ${path}`)
    }

    async url_path(item, route = '', opts = {}) {

        let [step, app, path] = await this._route(route)
        let subpath = await app.url_path(item, path, opts)
        if (opts.relative) return subpath                           // path relative to `route`
        let segments = [step, subpath].filter(Boolean)              // only non-empty segments
        return segments.join(Application.SEP_ROUTE)                 // absolute path, empty segments excluded
    }

    async execute(path, request, response) {
        /*
        Find an application in 'apps' that matches the requested URL path and call its execute().
        `path` can be an empty string; if non-empty, it starts with SEP_ROUTE character.
        */
        let [route, app, subpath] = await this._route(path)
        await app.execute(subpath, request, response)
    }
}

export class AppAdmin extends Application {
    /* Admin interface. All items are accessible through the 'raw' routing pattern: .../CID:IID */
    
    async url_path(item, route = '', opts = {}) {
        assert(item.has_id())
        let [cid, iid] = item.id
        let url = `${cid}:${iid}`
        return this._set_endpoint(url, opts)
    }
    async execute(path, request, response) {
        let [item, endpoint] = await this._find_item(path, request)
        await item.serve(request, response, this, endpoint)
    }
    async _find_item(path) {
        /* Extract (CID, IID, endpoint) from a raw URL of the form CID:IID@endpoint, return an item, save endpoint to request. */
        let id, endpoint
        try {
            [path, endpoint] = this._split_endpoint(path.slice(1))
            id = path.split(':').map(Number)
        } catch (ex) {
            throw new Error(`URL path not found: ${path}`)
        }
        return [await this.registry.get_item(id), endpoint]
    }
}

export class AppAjax extends AppAdmin {
    async execute(path, request, response) {
        let [item, endpoint] = await this._find_item(path, request)
        endpoint = endpoint || "json"
        await item.serve(request, response, this, endpoint)
    }
}

export class AppFiles extends Application {
    /*
    Filesystem application. Folders and files are accessible through the hierarchical
    "file path" routing pattern: .../dir1/dir2/file.txt
    */
    async url_path(item, route = '', opts = {}) {
        // TODO: convert folder-item relationship to bottom-up to avoid using current_request.state
        let state = this.registry.current_request.state
        return state['folder'].get_name(item)
    }
    async execute(path, request, response) {
        if (!path.startsWith('/'))
            return response.redirect(request.path + '/')

        // TODO: make sure that special symbols, e.g. "$", are forbidden in file paths
        let [filepath, endpoint] = this._split_endpoint(path.slice(1))
        request.state = {'filepath': filepath}
        
        let root = await this.get('root_folder') || await this.registry.files
        let item = await root.search(filepath)
        assert(item, `item not found: ${filepath}`)

        let files = await this.registry.files
        let File_ = await files.search('system/File')
        let Folder_ = await files.search('system/Folder')
        
        let default_endpoint = 'view'
        if (await item.isinstance(File_))
            default_endpoint = 'download'
        else if (await item.isinstance(Folder_))
            // if not filepath.endswith('/'): raise Exception("folder URLs must end with '/'") #return redirect(request.path + '/')       // folder URLs must end with '/'
            request.state['folder'] = item          // leaf folder, for use when generating file URLs (url_path())
            // default_endpoint = ('browse',)
        
        return item.serve(request, response, this, endpoint || default_endpoint)
    }
}

export class AppSpaces extends Application {
    /*
    Application for accessing individual objects (items) through verbose paths of the form: .../SPACE:IID,
    where SPACE is a text identifier assigned to a category in `spaces` property.
    */

    async url_path(item, route = '', opts = {}) {
        let space = await this._find_space(item.category)
        let url   = `${space}:${item.iid}`
        return this._set_endpoint(url, opts)
    }

    //@cached(ttl = 10)
    async _find_space(category) {
        let id = category.id
        let spaces = await this.get('spaces')
        for (const {key:space, value:cat} of spaces.entries())
            if (cat.has_id(id)) return space
        throw new Error(`URL path not found for items of category ${category}`)
    }
    async execute(path, request, response) {
        let space, item_id, category, endpoint
        try {
            [path, endpoint] = this._split_endpoint(path.slice(1));
            [space, item_id] = path.split(':')              // decode space identifier and convert to a category object
            let spaces = await this.get('spaces')   // TODO: `spaces/${space}`
            category = spaces.get(space)
        } catch (ex) {
            throw new Error(`URL path not found: ${path}`)
        }
        let item = await category.get_item(Number(item_id))
        return item.serve(request, response, this, endpoint)
    }
}

/**********************************************************************************************************************
 **
 **  FILES & FOLDERS
 **
 */

export class Folder extends Item {
    static SEP_FOLDER = '/'          // separator of folders in a file path

    exists(path) {
        /* Check whether a given path exists in this folder. */
    }
    async search(path) {
        /*
        Find an item pointed to by a `path`. The path may start with '/', but this is not obligatory.
        The search is performed recursively in subfolders.
        */
        if (path.startsWith(Folder.SEP_FOLDER)) path = path.slice(1)
        let item = this
        while (path) {
            let name = path.split(Folder.SEP_FOLDER)[0]
            let files = await item.get('files')     // TODO: `files/${name}`
            item = files.get(name)
            path = path.slice(name.length+1)
        }
        return item
    }
    async read(path) {
        /* Search for a File/FileLocal pointed to by a given `path` and return its content as a utf8 string. */
        let f = await this.search(path)
        if (f instanceof File) return f.read()
        throw new Error(`not a file: ${path}`)
    }
    async get_name(item) {
        /* Return a name assigned to a given item. If the same item is assigned multiple names,
        the last one is returned. */
        let names = await this._names()
        return names.get(item.id, null)
    }
    // @cached(ttl=10)
    async _names() {
        /* Take `files` property and compute its reverse mapping: item ID -> name. */
        let files = await this.get('files')
        return files.getEntries().map(({key:name, value:file}) => [file.id, name])
    }
}

export class File extends Item {
    async read() {
        return this.get('content')
    }
    async _handler_download() {
        /* Return full content of this file, either as <str> or a Response object. */
        return this.read()
    }
}

export class FileLocal extends File {
    async read(encoding = 'utf8') {
        let fs = import('fs')
        let path = await this.get('path', null)
        if (path === null) return null
        return fs.readFileSync(path, {encoding})
    }

    async _handler_download({res}) {
        
        let content = await this.get('content', null)
        if (typeof content === 'string')
            return res.send(content)
        
        let path = await this.get('path', null)
        if (!path) res.sendStatus(404)

        res.sendFile(path, {}, (err) => {if(err) res.sendStatus(err.status)})

        // let [content_type, encoding] = mimetypes.guess_type(path)
        // content_type = content_type || 'application/octet-stream'
        //
        // content = open(path, 'rb')
        // let response = FileResponse(content, content_type = content_type)
        //
        // if (encoding)
        //     response.headers["Content-Encoding"] = encoding
            
        // TODO respect the "If-Modified-Since" http header like in django.views.static.serve(), see:
        // https://github.com/django/django/blob/main/django/views/static.py
    }
}

