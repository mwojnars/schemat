import {e, delayed_render, DIV, P, H1, H2, SPAN, TABLE, TH, TR, TD, TBODY, BUTTON, FRAGMENT, HTML} from './utils.js'
import { print, assert, T, escape_html } from './utils.js'
import { generic_schema, multiple, RECORD } from './types.js'

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
        let entries = await item.get_entries()
        let schemas = await category.get_fields()

        let rows = entries.map(([field, value], i) => {
            let schema = schemas[field]  //await category.get_schema(field)
            let color  = (start_color + i) % 2
            return TR({className: `ct-color${color}`},
                      schema.is_catalog
                        ? TD({className: 'ct-nested', colSpan: 2},
                            DIV({className: 'ct-field'}, field),
                            e(Catalog2, {data: value, schema: schema.values, color: color})
                        )
                        : e(Entry, {field: field, value: value, schema: schema})
            )
        })
        return TABLE({className: 'catalog-1'}, TBODY(...rows))
    })
}

function Catalog2({data, schema, color = 0}) {
    return DIV({className: 'wrap-offset'},
            TABLE({className: 'catalog-2'},
              TBODY(...Object.entries(data).map(([field, value]) =>
                TR({className: `ct-color${color}`}, e(Entry, {field: field, value: value, schema: schema})))
           )))
}

function Entry({field, value, schema = generic_schema}) {
    /* A table row containing an atomic value of a data field (not a subcatalog). */
    return FRAGMENT(
                TH({className: 'ct-field'}, field),
                TD({className: 'ct-value'}, schema.Widget({value: value})),
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

    cid = null      // CID (Category ID) of this item; cannot be undefined, only "null" if missing
    iid = null      // IID (Item ID within a category) of this item; cannot be undefined, only "null" if missing

    // data            // properties of this item, as a plain object {..}; in the future, MultiDict can be used instead
    // category        // parent category of this item, as an instance of Category
    // registry        // Registry that manages access to this item (should refer to the unique global registry)

    //loaded = null;    // names of fields that have been loaded so far

    get id()        { return [this.cid, this.iid] }
    get id_str()    { return `[${this.cid},${this.iid}]` }

    has_id(id = null) {
        if (id) return this.cid === id[0] && this.iid === id[1]
        return this.cid !== null && this.iid !== null
    }
    has_data() { return !!this.data }

    constructor(category = null, data = null) {
        if (data) this.data = data
        if (category) {
            this.category = category
            this.registry = category.registry
            this.cid      = category.iid
        }
    }

    static async from_dump(state, category = null, use_schema = true) {
        /* Recreate an item that was serialized with Item.dump_item(), possibly at the server. */
        let schema = use_schema ? await category.get_schema() : generic_schema
        let data = await schema.decode(state['data'])
        delete state['data']

        let item = new Item(category, data)
        Object.assign(item, state)                  // copy remaining metadata from `state` to `item`
        return item
    }

    async load(field = null, use_schema = true) {
        /* Return this item's data (this.data). The data is loaded from a DB, if not loaded yet. */

        // if field !== null && field in this.loaded: return      // this will be needed when partial loading from indexes is available
        // if (this.category && this.category !== this)
        //     this.category.load()

        if (this.data) return this.data   //field === null ? this.data : T.getOwnProperty(this.data, field)
        if (this.iid === null) throw Error(`trying to load() a newborn item with no IID`)

        // store and return a Promise that will eventually load this item's data;
        // for efficiency, replace in this the proxy promise with an actual `data` object when it's ready
        this.data = this.reload(use_schema).then(data => {this.data = data; return data})
        // this.bind()

        // if (field !== null && data.hasOwnProperty(field))
        //     return this.data[field]
        return this.data
    }
    async reload(use_schema = true, data_json = null) {
        /* Return this item's data object newly loaded from a DB or from `data_json`. */
        print(`${this.id_str}.reload() started...`)
        if (!data_json) {
            let record = await this.registry.load_record(this.id)
            data_json = record['data']          // TODO: initialize item metadata - the remaining attributes from `record`
        }
        let schema = use_schema ? await this.category.get_schema() : generic_schema
        let state  = (typeof data_json === 'string') ? JSON.parse(data_json) : data_json
        let data   = await schema.decode(state)
        print(`${this.id_str}.reload() done`)
        return data
    }
    // bind() {
    //     /*
    //     Override this method in subclasses to provide initialization after this item is retrieved from DB.
    //     Typically, this method initializes transient properties and performs cross-item initialization.
    //     Only after bind(), the item is a fully functional element of a graph of interconnected items.
    //     When creating new items, bind() should be called manually, typically after all related items
    //     have been created and connected.
    //     */
    // }

    async ciid({html = true, brackets = true, max_len = null, ellipsis = '...'} = {}) {
        /*
        "Category-Item ID" (CIID) string (stamp, emblem) having the form:
        - [CATEGORY-NAME:IID], if the category of this has a "name" property; or
        - [CID:IID] otherwise.
        If html=true, the first part (CATEGORY-NAME or CID) is hyperlinked to the category's profile page
        (unless URL failed to generate) and the CATEGORY-NAME is HTML-escaped. If max_len is not null,
        CATEGORY-NAME gets truncated and suffixed with '...' to make its length <= max_len.
        */
        // return `Item [${this.id}]`

        let cat = await this.category.get('name', this.cid.toString())
        if (max_len && cat.length > max_len) cat = cat.slice(max_len-3) + ellipsis
        if (html) {
            cat = escape_html(cat)
            let url = await this.category.url('', false)
            if (url) cat = `<a href=${url}>${cat}</a>`
        }
        let stamp = `${cat}:${this.iid}`
        if (!brackets) return stamp
        return `[${stamp}]`
    }

    async get(field, default_ = undefined) {
        // if (!this.data) await this.load()           // TODO: expect explicit pre-loading by caller; remove "async" in this and related methods
        let data = await this.load()

        if (data.hasOwnProperty(field))
            return data[field]

        if (this.category !== this) {
            let cat_default = await this.category.get_default(field)
            if (cat_default !== undefined)
                return cat_default
        }
        return default_
    }

    async get_entries(order = 'schema') {
        /*
        Retrieve a list of this item's fields and their values.
        Multiple values for a single field are returned as separate entries.
        */
        // await this.load()
        let data = await this.load()
        return Object.entries(data)

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
    
    async url(route = null, raise = true, args = {}) {
        /*
        Return a *relative* URL of this item as assigned by the current Application (if route=null),
        that is, by the one that's processing the current web request; or an *absolute* URL
        assigned by an application anchored at a given route.
        route=null should only be used during request processing, when a current app is defined.
        */
        try {
            if (route === null) {
                let app = this.registry.current_request.app
                return './' + await app.url_path(this, args)      // ./ informs the browser this is a relative path, even if dots and ":" are present similar to a domain name with http port
            }
            let site = await this.registry.site
            return await site.get_url(this, route, args)
        }
        catch (ex) { if (raise) {throw ex} else return '' }
    }

    async serve(request, response, app, endpoint = 'view') {
        /*
        Serve a web request submitted to a given @endpoint of this item.
        Endpoints map to Javascript "handler" functions stored in a category's "handlers" property:

           function handler(item, {request, response, endpoint, app})

        A handler function can directly write to `response`, and/or return a string that will be appended
        to the response. The function can return a Promise (async function). It can have arbitrary name, or be anonymous.
        */
        let handlers = await this.category.get('handlers', {})
        let source   = handlers.get(endpoint)

        if (source) {
            let handler = eval('(' + source + ')')     // surrounding (...) are added automatically, required when parsing a function definition
            let page = handler(this, {request, response, endpoint, app})
            if (page instanceof Promise) page = await page
            if (typeof page === 'string')
                response.send(page)
        }

        throw new Error(`Endpoint "${endpoint}" not found`)
    }
    
    display(target) {
        /* Render this item into a `target` HTMLElement. */
        ReactDOM.render(e(this.Page, {item: this}), target)
    }

    /***  React components  ***/

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

    Page({item}) {                                  // React functional component
        let changes = new Changes(item)
        return DIV(
            e(item.Title, {item}),
            H2('Properties'),                               //{style: {color:'blue'}}
            e(Catalog1, {item, changes}),
            e(changes.Buttons, {changes}),
        )
    }
}

/**********************************************************************************************************************/

export class Category extends Item {

    async get_fields() { return await this.get('fields') }

    async get_class() {
        let name = await this.get('class_name')
        let code = await this.get('class_code')
        if (code)
            return eval(code)
            // TODO: save the newly created class to registry as a subclass NAME_XXX of Item
            // TODO: check this.data for individual methods & templates to be treated as methods

        assert(name, `no class_name defined for category ${this}: ${name}`)
        return globalThis.registry.get_class(name)
    }
    async get_default(field, default_ = undefined) {
        /* Get default value of a field from category schema. Return `default` if no category default is configured. */
        let fields = await this.get_fields()
        let schema = T.getOwnProperty(fields, field)
        return schema ? schema.default : default_
    }
    async get_schema(field = null) {
        /* Return schema of a given `field` (if present), or a RECORD schema of all fields. */
        let fields = await this.get_fields()
        if (!field)                                     // create and return a schema for the entire Item.data
            return new RECORD(fields, {strict: true})
        else {                                          // return a schema for a selected field only
            let schema = (field in fields) ? fields[field] : null
            return schema || generic_schema
        }
    }
}

/**********************************************************************************************************************/

export class RootCategory extends Category {
    cid = ROOT_CID
    iid = ROOT_CID

    constructor(registry) {
        super()
        this.registry = registry
        this.category = this                    // root category is a category for itself
    }
    encode_data(use_schema = false) {
        /* Same as Item.encode_data(), but use_schema is false to avoid circular dependency during deserialization. */
        return super.encode_data(false)
    }
    async reload(use_schema = false, data_json = null) {
        /* Same as Item.reload(), but use_schema is false to avoid circular dependency during deserialization. */
        return await super.reload(data_json, false)
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
        `opt` may include: endpoint (null), relative (True), args (null)
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
        throw Error('method not implemented in a subclass')
    }
    _split_endpoint(path) {
        /* Decode @endpoint from the URL path. Return [subpath, endpoint]. */
        // if ('?' in path)
        //     path = path.split('?')[0]
        if (Application.SEP_ENDPOINT in path) {
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
        let app  = T.getOwnProperty(apps, step)
        
        if (step && app)                        // non-default (named) route can be followed with / in path
            return [step, app, path.slice(lead + step.length)]
        
        if ('' in apps)                         // default (unnamed) route has special format, no "/"
            return ['', apps[''], path]
        
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
        let item = await this._find_item(path, request)
        await item.serve(this, request, response)
    }
    async _find_item(path, request) {
        /* Extract (CID, IID, endpoint) from a raw URL of the form CID:IID@endpoint, return an item, save endpoint to request. */
        let id
        try {
            [path, request.endpoint] = this._split_endpoint(path.slice(1))
            id = path.split(':').map(Number)
        } catch (ex) {
            throw new Error(`URL path not found: ${path}`)
        }
        return this.registry.get_item(id)
    }
}

export class AppAjax extends Application {
    async execute(path, request, response) {
        let item = await this._find_item(path, request)
        request.endpoint = "json"
        await item.serve(this, request, response)
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
        let filepath
        [filepath, request.endpoint] = this._split_endpoint(path.slice(1))
        request.state = {'filepath': filepath}
        
        let root = await this.get('root_folder') || this.registry.files
        let item = root.search(filepath)

        let files = await this.registry.files
        let File_ = files.search('system/File')
        let Folder_ = files.search('system/Folder')
        
        let endpoint = 'view'
        if (item.isinstance(File_))
            endpoint = 'download'
        else if (item.isinstance(Folder_))
            // if not filepath.endswith('/'): raise Exception("folder URLs must end with '/'") #return redirect(request.path + '/')       // folder URLs must end with '/'
            request.state['folder'] = item          // leaf folder, for use when generating file URLs (url_path())
            // default_endpoint = ('browse',)
        
        return item.serve(this, request, response, endpoint)
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
        for (const [space, cat] of Object.entries(spaces))
            if (cat.has_id(id)) return space
        throw new Error(`URL path not found for items of category ${category}`)
    }
    async execute(path, request, response) {
        let space, item_id, category
        try {
            [path, request.endpoint] = this._split_endpoint(path.slice(1))
            [space, item_id] = path.split(':')        // decode space identifier and convert to a category object
            category = (await this.get('spaces'))[space]
        } catch (ex) {
            throw new Error(`URL path not found: ${path}`)
        }
        let item = await category.get_item(Number(item_id))
        return item.serve(this, request, response)
    }
}

/**********************************************************************************************************************
 **
 **  FILES & FOLDERS
 **
 */

export class Folder extends Item {}
export class File extends Item {}
export class FileLocal extends File {}

