import {e, delayed_render, DIV, P, H1, H2, SPAN, TABLE, TH, TR, TD, TBODY, FRAGMENT, HTML} from './utils.js'
import { print, assert, T, escape_html } from './utils.js'
import { generic_schema, multiple, RECORD } from './types.js'

export const ROOT_CID = 0

const useState  = React.useState
const useEffect = React.useEffect


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
                        : e(CatalogRow, {field: field, value: value, schema: schema})
            )
        })
        return TABLE({className: 'catalog-1'}, TBODY(...rows))
    })
}

function Catalog2({data, schema, color = 0}) {
    return DIV({className: 'wrap-offset'},
            TABLE({className: 'catalog-2'},
              TBODY(...Object.entries(data).map(([field, value]) =>
                TR({className: `ct-color${color}`}, e(CatalogRow, {field: field, value: value, schema: schema})))
           )))
}

function CatalogRow({field, value, schema}) {
    /* A table row containing an atomic value of a data field (not a subcatalog). */
    return FRAGMENT(
                TH({className: 'ct-field'}, field),
                TD({className: 'ct-value'}, schema.Widget({value: value})),
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
    // has_id()   { let id = this.id; return !(id.includes(null) || id.includes(undefined)) }
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

    // async load(field = null, data_json = null, use_schema = true) {
    //     /*
    //     Load properties of this item from a DB or JSON string `data_json` into this.data, IF NOT LOADED YET.
    //     Only with a not-null `data_json`, (re)loading takes place even if `this` was already loaded
    //     - the newly loaded `data` fully replaces the existing this.data in such case.
    //     */
    //     // if field !== null && field in this.loaded: return      // this will be needed when partial loading from indexes is available
    //     // if (this.category && this.category !== this)
    //     //     this.category.load()
    //
    //     if (this.has_data() && !data_json) return this
    //     if (this.iid === null) throw Error(`trying to load() a newborn item with no IID`)
    //
    //     print(`${this.id_str}.reload() started...`)
    //     if (!data_json) {
    //         let record = await this.registry.load_record(this.id)
    //         data_json = record['data']          // TODO: initialize item metadata - the remaining attributes from `record`
    //     }
    //     let schema = use_schema ? await this.category.get_schema() : generic_schema
    //     let state  = (typeof data_json === 'string') ? JSON.parse(data_json) : data_json
    //     this.data  = await schema.decode(state)
    //     print(`${this.id_str}.reload() done`)
    //
    //     this.bind()
    //     return this
    // }
    async load(field = null, use_schema = true) {
        /* Return this item's data (this.data). The data is loaded from a DB, if not loaded yet. */

        // if field !== null && field in this.loaded: return      // this will be needed when partial loading from indexes is available
        // if (this.category && this.category !== this)
        //     this.category.load()

        if (this.data) return this.data   //field === null ? this.data : T.getOwnProperty(this.data, field)
        if (this.iid === null) throw Error(`trying to load() a newborn item with no IID`)

        // store and return a Promise that will eventually load this item's data;
        // for efficiency, replace in self the proxy promise with an actual `data` object when it's ready
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
            let url = await this.category.url('', true)
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
        Retrieve a list of this item's fields and their values, ordered appropriately.
        Multiple values for a single field are returned as separate entries.
        */
        // await this.load()
        let data    = await this.load() //this.data
        let fields  = await this.category.get_fields()
        let entries = []

        function push(f, v) {
            if (v instanceof multiple)
                for (w of v.values()) entries.push([f, w])
            else
                entries.push([f, v])
        }

        // retrieve entries by their order in category's schema
        for (const f in fields) {
            let v = T.getOwnProperty(data, f)
            if (v !== undefined) push(f, v)
        }

        // add out-of-schema entries, in their natural order (of insertion)
        for (const f in data)
            if (!fields.hasOwnProperty(f)) push(f, data[f])

        return entries
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

    display(target) {
        /* Render this item into a `target` HTMLElement. */
        ReactDOM.render(e(this.Page, {item: this}), target)
    }

    /***  React components  ***/

    Title(props) {
        return delayed_render(async () => {
            let name = await props.item.get('name', null)
            let ciid = await props.item.ciid()
            if (name)
                return H1(name, ' ', SPAN({style: {fontSize:'40%', fontWeight:"normal"}, ...HTML(ciid)}))
            else
                return H1(HTML(ciid))
        })
    }

    Page(props) {           // React functional component
        let item = props.item
        return DIV(
            e(item.Title, props),
            H2('Properties'),                               //{style: {color:'blue'}}
            e(Catalog1, props)
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
    // async load(field = null, data_json = null, use_schema = false) {
    //     /* Same as Item.load(), but use_schema is false to avoid circular dependency during deserialization. */
    //     return await super.load(field, data_json, false)
    // }
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
}

export class AppAdmin extends Application {
    /* Admin interface. All items are accessible through the 'raw' routing pattern: .../CID:IID */
    
    async url_path(item, route = '', opts = {}) {
        assert(item.has_id())
        let [cid, iid] = item.id
        let url = `${cid}:${iid}`
        return this._set_endpoint(url, opts)
    }
}

export class AppAjax extends Application {}

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
}

export class AppSpaces extends Application {
    /*
    Application for accessing public data through verbose paths of the form: .../SPACE:IID,
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
}

/**********************************************************************************************************************
 **
 **  FILES & FOLDERS
 **
 */

export class Folder extends Item {}
export class File extends Item {}
export class FileLocal extends File {}

