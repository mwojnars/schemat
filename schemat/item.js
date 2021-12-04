import {
    e, useState, useRef, delayed_render, NBSP, DIV, A, P, H1, H2, H3, SPAN, FORM, INPUT, LABEL, FIELDSET,
    TABLE, TH, TR, TD, TBODY, BUTTON, FRAGMENT, HTML, splitFirst, splitLast
} from './utils.js'
import { print, assert, T, escape_html } from './utils.js'
import { generic_schema, CATALOG, DATA } from './types.js'
import { JSONx } from './serialize.js'
import { Catalog, Data, ItemsMap } from './data.js'

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
        let schemas = await category.getFields()

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
    - moved    -- ID of another item that contains more valid/complete data and replaces this one
    - stopper  -- knowingly invalid item that's kept in DB to prevent re-insertion of the same data again; with a text explanation
    ? status   -- enum, "deleted" for tombstone items
    ? name     -- for fast generation of lists of hyperlinks without loading full data for each item; length limit ~100
    ? info     -- a string like `name`, but longer ~300-500 ??
    */

    cid = null      // CID (Category ID) of this item; cannot be undefined, only "null" if missing
    iid = null      // IID (Item ID within a category) of this item; cannot be undefined, only "null" if missing

    data            // data fields of this item, as a Data object; can hold a Promise, so it always should be awaited for,
                    // or accessed after await load(), or through item.get()
    category        // parent category of this item, as an instance of Category
    registry        // Registry that manages access to this item

    temporary = new Map()       // cache of temporary fields and their values; access through temp(); values can be promises

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
    }
    async reload(use_schema = true, record = null) {
        /* Return this item's data object newly loaded from a DB or from a preloaded DB `record`. */
        //print(`${this.id_str}.reload() started...`)
        if (!record) {
            if (!this.has_id()) throw new Error(`trying to reload an item with missing or incomplete ID: ${this.id_str}`)
            record = await this.registry.load_record(this.id)
        }
        let flat   = record.data
        let schema = use_schema ? await this.category.temp('schema') : generic_schema
        let state  = (typeof flat === 'string') ? JSON.parse(flat) : flat
        this.data  = await schema.decode(state).then(d => new Data(d))
        // TODO: initialize item metadata - the remaining attributes from `record`

        //print(`${this.id_str}.reload() done`)
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
            let url = await this.category.url({route: ''})
            if (url) cat = `<a href=${url}>${cat}</a>`
        }
        let stamp = `${cat}:${this.iid}`
        if (!brackets) return stamp
        return `[${stamp}]`
    }

    async get(path, default_ = undefined) {
        await this.load()

        // search in this.data
        let value = this.data.get(path)
        if (value !== undefined) return value

        // search in category's defaults
        if (this.category !== this) {
            let cat_default = await this.category.getDefault(path)
            if (cat_default !== undefined)
                return cat_default
        }
        // // try imputing the value with a call to this._impute_PATH() - for top-level fields
        // value = await this.impute(path)
        // if (value !== undefined) return value

        return default_
    }
    async getAll(key) {
        /* Return an array (possibly empty) of all values assigned to a given `key` in this.data.
           Default value (if defined) is NOT used.
         */
        await this.load()
        return this.data.getAll(key)
    }

    async getEntries(order = 'schema') {
        /*
        Retrieve a list of this item's fields and their values.
        Multiple values for a single field are returned as separate entries.
        */
        await this.load()
        return this.data.getEntries()

        // let fields  = await this.category.getFields()
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

    async temp(field) {
        /* Calculate and return a value of a temporary `field`. For the calculation, method _temp_FIELD() is called
           (can be async). The value is computed once and cached in this.temporary for subsequent temp() calls. */
        if (this.temporary.has(field)) return this.temporary.get(field)
        let fun = this[`_temp_${field}`]
        if (!fun) throw new Error(`method '_temp_${field}' not found for a temporary field`)
        let value = fun.bind(this)()
        this.temporary.set(field, value)        // this may store a promise
        return value                            // this may return a promise
    }

    async encodeData(use_schema = true) {
        /* Encode this.data into a JSON-serializable dict composed of plain JSON objects only, compacted. */
        let schema = use_schema ? await this.category.temp('schema') : generic_schema
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
        let ajax_url = await (await this.registry.site).ajaxURL()
        return {'ajax_url': ajax_url, 'request': JSONx.encode(request)}
    }
    async url(params = {}) {
        let {raise = true, ...params_} = params
        let site   = await this.registry.site
        let build  = site.buildURL(this, params_)
        if (raise) return build

        try { return await build }
        catch(ex) { return null }
    }

    /***  Handlers (server side)  ***/

    async handle(req, res, app = null) {
        /*
        Serve a web request submitted to a given @endpoint of this item.
        Endpoints map to Javascript "handler" functions stored in a category's "handlers" property:

           function handler({item, req, res, endpoint})

        or as methods of a particular Item subclass, named `_handle_{endpoint}`.
        In every case, the function's `this` is bound to `item` (this===item).
        A handler function can directly write to the response, and/or return a string that will be appended.
        The function can return a Promise (async function). It can have an arbitrary name, or be anonymous.
        */
        req.item = this
        if (app) req.app = app
        let endpoint = req.endpoint || req.endpointDefault || 'view'

        let handler
        let handlers = await this.category.getHandlers()
        let source   = handlers.get(endpoint)

        // get handler's source code from category's properties?
        if (source) {
            handler = eval('(' + source + ')')      // surrounding (...) are required when parsing a function definition
            // TODO: parse as a module with imports, see https://2ality.com/2019/10/eval-via-import.html
        }
        else                                        // fallback: get handler from the item's class
            handler = this[`_handle_${endpoint}`]

        if (!handler) throw new Error(`Endpoint "${endpoint}" not found`)

        handler = handler.bind(this)
        let page = handler({item: this, req, res, endpoint})
        if (page instanceof Promise) page = await page
        if (typeof page === 'string')
            res.send(page)
    }

    async _handle_json({res}) { return res.sendItem(this) }
    async _handle_view({req, res, endpoint}) {

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
            <link href="/files/styles.css" rel="stylesheet" />
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
    // set(key, value, {label, comment} = {}) {
    //     this.data.set(key, value, {label, comment})
    // }

    _edit_push(entry) { return this.data.pushEntry(entry) }
    _edit_set (entry) { return this.data.setEntry (entry) }
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
        let itemclass = await this.getClass()
        let item = new itemclass(this, data)
        if (stage) this.registry.stage(item)                    // mark `item` for insertion on the next commit()
        return item
    }
    async issubcat(category) {
        /*
        Return true if `this` inherits from `category`, or is `category` (by ID comparison).
        Inheritance means that the ID of `category` is present on an item-prototype chain of `this`.
        */
        if (this.has_id(category.id)) return true
        let prototypes = await this.getAll('prototype')
        for (const proto of prototypes)
            if (await proto.issubcat(category)) return true
        return false
    }
    async getFields()       { return this.temp('fields_all') }
    async getHandlers()     { return this.temp('handlers_all') }

    async getClass() {
        let name = await this.get('class_name')
        let code = await this.get('class_code')
        if (code)
            return eval(code)
            // TODO: save the newly created class to registry as a subclass NAME_XXX of Item
            // TODO: check this.data for individual methods & templates to be treated as methods

        assert(name, `no class_name defined for category ${this}: ${name}`)
        return this.registry.getClass(name)
    }
    async getItem(iid) {
        /*
        Instantiate an Item (a stub) and seed it with IID (the IID being present in DB, presumably, not checked),
        but do NOT load remaining contents from DB (lazy loading).
        */
        return this.registry.getItem([this.iid, iid])
    }
    async getDefault(field, default_ = undefined) {
        /* Get default value of a field from category schema. Return `default` if no category default is configured. */
        let fields = await this.getFields()
        let schema = fields.get(field)
        return schema ? schema.default : default_
    }

    async _inherited(field) {
        /* Merge all catalogs found at a given `field` in all base categories of this, `this` included.
           It's assumed that the catalogs are dictionaries (unique non-missing keys).
           If a key is present in multiple catalogs, its first occurrence is used (closest to `this`).
         */
        let catalog    = new Catalog()
        let prototypes = await this.getAll('prototype')
        for (const proto of [this, ...prototypes]) {
            let cat = await proto.get(field)
            if (!cat) continue
            for (const entry of cat)
                if (entry.key !== undefined && !catalog.has(entry.key))
                    catalog.pushEntry({...entry})
        }
        return catalog
    }
    async _temp_fields_all() {
        /* The 'fields_all' temporary variable: a catalog of all fields of this category including the inherited ones. */
        return this._inherited('fields')
    }
    async _temp_handlers_all() {
        /* The 'handlers_all' temporary variable: a catalog of all handlers of this category including the inherited ones. */
        return this._inherited('handlers')
    }
    async _temp_schema() {
        let fields = await this.getFields()
        return new DATA(fields.asDict())
    }

    async _handle_scan({res}) {
        /* Retrieve all children of this category and send to client as a JSON.
           TODO: set a size limit & offset (pagination).
           TODO: let declare if full items (loaded), or meta-only, or naked stubs should be sent.
         */
        let items = []
        for await (const item of this.registry.scan_category(this))
            items.push(item) //await item.encodeSelf())
        res.sendItems(items)
        // res.json(items)
    }
    async _handle_new({req, res}) {
        /* Web handler to create a new item in this category based on request data. */
        print('in _handle_new()...')
        print('request body:  ', req.body)
        assert(req.method === 'POST')

        // req.body is an object representing state of a Data instance, decoded from JSON by middleware
        let data = await (new Data).__setstate__(req.body)
        let item = await this.new(data)
        this.registry.commit()
        print('new item.id:', item.id)
        print('new item.data:', item.data)
        res.sendItem(item)
        // TODO: check constraints: schema, fields, max lengths of fields and of full data - to close attack vectors
    }
    async remote_new(data) {
        /* Client-side method to request insertion of a new item with given `data` to a server-side DB. */
        let json = JSON.stringify(data.__getstate__())
        let url  = `${await this.url()}@new`
        let response = await fetch(url, {body: json, method: 'POST', headers: {'Content-Type': 'application/json; charset=utf-8'}})
        let record = await response.json()
        this.registry.db.keep(record)
        return record
        // print('remote_new().response:', response)
    }

    remote_delete(id, callback) {
        /*  */
    }

    Items({items}) {
        /* A list (table) of items in `category`. */
        if (!items || items.length === 0) return null
        const remove = (id) => { print('clicked delete item:', id) }
        return delayed_render(async () => {
            let rows = []
            for await (const item of items) {
                let name = await item.get('name') || item.toString()
                let url  = await item.url()
                rows.push(TR(
                    TD(`${item.iid} ${NBSP}`),
                    TD(url !== null ? A({href: url}, name) : `${name} (no URL)`),
                    TD(BUTTON({onClick: () => remove(item.id)}, 'Delete')),
                ))
            }
            return TABLE(TBODY(...rows))
        }, [items])
    }
    NewItem({category, itemAdded}) {

        let form  = useRef(null)

        function setFormDisabled(disabled) {
            let fieldset = form.current?.getElementsByTagName('fieldset')[0]
            if (fieldset) fieldset.disabled = disabled
        }

        async function submit(e) {
            e.preventDefault()                  // not needed when button type='button', but then Enter still submits the form (!)
            let fdata = new FormData(form.current)
            setFormDisabled(true)               // this must not preceed FormData(), otherwise fdata is empty
            // fdata.append('name', 'another name')
            // let name = input.current.value
            // let json = JSON.stringify(Array.from(fdata))

            let data = new Data()
            for (let [k, v] of fdata) data.push(k, v)

            let record = await category.remote_new(data)
            let item   = await category.registry.getItem([record.cid, record.iid])
            itemAdded(item)

            form.current.reset()            // clear input fields
            setFormDisabled(false)
        }

        return FORM({ref: form}, FIELDSET(
            // LABEL('Name: ', INPUT({name: 'name'}), ' '),
            INPUT({name: 'name', placeholder: 'name'}),
            BUTTON({type: 'submit', onClick: submit}, 'Create Item'),
        ))
    }

    Page({item: category}) {
        // child items; state is used to prevent re-scan after every itemAdded();
        // scan_category() returns an async generator that requires "for await"
        const items = useRef(category.registry.scan_category(category))
        const [newItems, setNewItems] = useState([])
        const itemAdded = (item) => { setNewItems(prev => [...prev, item]) }

        return Item.prototype.Page({item: category, extra: FRAGMENT(
            H2('Items'),
            e(category.Items, {items: items.current}),
            H3('Add item'),
            e(category.Items, {items: newItems}),
            e(category.NewItem, {category, itemAdded}),
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

/**********************************************************************************************************************
 **
 **  SUBCLASSES
 **
 */

export class Site extends Item {
    /* Global configuration of all applications that comprise this website, with URL routing etc. */

    static SEP_ENDPOINT = '@'       // separator of an item path and an endpoint name within a URL path

    async execute(request, response) {
        /* Set `ipath` and `endpoint` in request. Forward the request to a root application from the `app` property. */
        let app  = await this.get('application')
        let path = request.path, sep = Site.SEP_ENDPOINT;
        [request.ipath, request.endpoint] = path.includes(sep) ? splitLast(path, sep) : [path, '']
        return app.execute(request.ipath, request, response)
    }

    async ajaxURL() {
        /* Absolute base URL for AJAX calls originating at a client UI. */
        return (await this.get('base_url')) + '/ajax'
    }

    async buildURL(item, {route = null, relative = true, baseURL, endpoint, args} = {}) {
        /*
        Return a relative URL of `item` as assigned by the deep-most Application (if route=null)
        that's processing the current web request; or an absolute or relative URL
        assigned by an application anchored at a given `route`.
        route=null should only be used during request processing, when the current app is defined.
        */
        let url = await this.url_path(item, {route, relative, baseURL})
        return this.setEndpoint(url, endpoint, args)              // append `endpoint` and `args` to the URL
    }

    async url_path(item, {route, relative, baseURL}) {

        // relative URL anchored at the deep-most application's route
        if (route === null) {
            let app  = this.registry.current_request.app
            let path = await app.url_path(item, {route, relative})
            return './' + path      // ./ informs the browser this is a relative path, even if dots and ":" are present similar to a domain name with http port
        }

        // relative URL anchored at `route`
        let root = await this.get('application')
        let path = await root.url_path(item, {route, relative})
        if (relative) return path

        // absolute URL without base?
        path = '/' + path
        if (!baseURL) return path

        // absolute URL with base (protocol+domain+port)
        let base = (typeof baseURL === 'string') ? baseURL : await this.get('base_url')
        if (base.endsWith('/')) base = base.slice(-1)
        return base + path
    }
    setEndpoint(url, endpoint, args) {
        if (endpoint) url += `${Site.SEP_ENDPOINT}${endpoint}`
        if (args) url += '?' + new URLSearchParams(args).toString()
        return url
    }
}

export class Application extends Item {
    /*
    An application implements a mapping of URL paths to item methods, and the way back.
    Some application classes may support nested applications.
    INFO what characters are allowed in URLs: https://stackoverflow.com/a/36667242/1202674
    */
    static SEP_ROUTE    = '/'       // separator of route segments in URL, each segment corresponds to another (sub)application

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
    async url_path(item, {route, relative}) {
        /*
        Generate URL path (URL fragment after route) for `item`.
        If relative=true, the path is relative to a given application `route`; otherwise,
        it is absolute, i.e., includes segments for all intermediate applications below this one;
        the path does NOT have a leading separator, or it has a different meaning -
        in any case, a leading separator should be appended by caller if needed.
        */
        throw new Error()
    }
}

export class AppRoot extends Application {
    /* A set of sub-applications, each bound to a different URL prefix. */

    async execute(path, request, response) {
        /*
        Find an application in 'apps' that matches the requested URL path and call its execute().
        `path` can be an empty string; if non-empty, it starts with SEP_ROUTE character.
        */
        let [step, app, subpath] = await this._route(path)
        await app.execute(subpath, request, response)
    }

    async _route(path = '') {
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

    async url_path(item, opts = {}) {

        let [step, app, path] = await this._route(opts.route)
        let subpath = await app.url_path(item, {...opts, route: path})
        if (opts.relative) return subpath                           // path relative to `route`
        let segments = [step, subpath].filter(Boolean)              // only non-empty segments
        return segments.join(Application.SEP_ROUTE)                 // absolute path, empty segments excluded
    }
}

export class AppAdmin extends Application {
    /* Admin interface. All items are accessible through the 'raw' routing pattern: .../CID:IID */
    
    async execute(path, request, response) {
        let item = await this._find_item(path)
        return item.handle(request, response, this)
    }
    async _find_item(path) {
        /* Extract (CID, IID, endpoint) from a raw URL of the form CID:IID@endpoint, return an item, save endpoint to request. */
        let id
        try { id = path.slice(1).split(':').map(Number) }
        catch (ex) { throw new Error(`URL path not found: ${path}`) }
        return this.registry.getItem(id)
    }
    async url_path(item, opts = {}) {
        assert(item.has_id())
        let [cid, iid] = item.id
        return `${cid}:${iid}`
    }
}

export class AppAjax extends AppAdmin {
    async execute(path, request, response) {
        request.endpointDefault = "json"
        let item = await this._find_item(path)
        return item.handle(request, response, this)
    }
}

export class AppFiles extends Application {
    /*
    Filesystem application. Folders and files are accessible through the hierarchical
    "file path" routing pattern: .../dir1/dir2/file.txt
    */
    async execute(path, request, response) {
        /* Find an item (file/folder) pointed to by `path` and call its handle(). */

        if (!path.startsWith('/'))
            return response.redirect(request.ipath + '/')
        // TODO: make sure that special symbols, e.g. "$", are forbidden in file paths

        let filepath  = path.slice(1)
        request.app   = this
        
        let root = await this.get('root_folder') || await this.registry.files
        return root.execute(filepath, request, response)     // `root` must be an item of Folder_ or its subcategory
    }

    async url_path(item, opts = {}) {
        // TODO: convert folder-item relationship to bottom-up to avoid using current_request.state
        let state = this.registry.current_request.state
        return state.folder.get_name(item)
    }
}

export class AppSpaces extends Application {
    /*
    Application for accessing individual objects (items) through verbose paths of the form: .../SPACE:IID,
    where SPACE is a text identifier assigned to a category in `spaces` property.
    */
    async url_path(item, opts = {}) {
        let spaces_rev = await this.temp('spaces_rev')
        let space = spaces_rev.get(item.category.id)
        if (!space) throw new Error(`URL path not found for items of category ${item.category}`)
        return `${space}:${item.iid}`
    }
    async _temp_spaces_rev()    { return ItemsMap.reversed(await this.get('spaces')) }

    async execute(path, request, response) {
        let space, item_id, category
        try {
            [space, item_id] = path.slice(1).split(':')         // decode space identifier and convert to a category object
            category = await this.get(`spaces/${space}`)
        } catch (ex) {
            throw new Error(`URL path not found: ${path}`)
        }
        let item = await category.getItem(Number(item_id))
        return item.handle(request, response, this)
    }
}

/**********************************************************************************************************************
 **
 **  FILES & FOLDERS
 **
 */

export class File extends Item {
    async read() {
        return this.get('content')
    }
    async _handle_download() {
        /* Return full content of this file, either as <str> or a Response object. */
        return this.read()
    }
}

export class FileLocal extends File {
    async read(encoding = 'utf8') {
        let fs = import('fs')
        let path = await this.get('path')
        if (path) return fs.readFileSync(path, {encoding})
    }
    async _handle_download({res}) {
        let content = await this.get('content', null)
        if (typeof content === 'string')
            return res.send(content)
        
        let path = await this.get('path', null)
        if (!path) res.sendStatus(404)

        res.sendFile(path, {}, (err) => {if(err) res.sendStatus(err.status)})

        // TODO respect the "If-Modified-Since" http header like in django.views.static.serve(), see:
        // https://github.com/django/django/blob/main/django/views/static.py
    }
}

export class Folder extends Item {
    static SEP_FOLDER = '/'          // separator of folders in a file path

    async execute(path, request, response) {
        /* Propagate a web request down to the nearest object pointed to by `path`.
           If the object is a Folder, call its execute() with a truncated path. If the object is an item, call its handle().
         */
        if (path.startsWith(Folder.SEP_FOLDER)) path = path.slice(1)
        let name = path.split(Folder.SEP_FOLDER)[0]
        let item = this

        if (name) {
            item = await this.get(`files/${name}`)
            if (!item) throw new Error(`URL path not found: ${path}`)
            assert(item instanceof Item, `not an item: ${item}`)
            path = path.slice(name.length+1)
        }

        if (await item.get('_is_file')) {
            if (path) throw new Error('URL not found')
            request.endpointDefault = 'download'
        }
        else if (await item.get('_is_folder')) {
            // request.endpointDefault = 'browse'
            if (path) return item.execute(path, request, response)
            else request.state.folder = item                 // leaf folder, for use when generating file URLs (url_path())
        }

        return item.handle(request, response)
    }

    // exists(path) {
    //     /* Check whether a given path exists in this folder. */
    // }
    async search(path) {
        /*
        Find an object pointed to by `path`. The path may start with '/', but this is not obligatory.
        The search is performed recursively in subfolders.
        */
        if (path.startsWith(Folder.SEP_FOLDER)) path = path.slice(1)
        let item = this
        while (path) {
            let name = path.split(Folder.SEP_FOLDER)[0]
            item = await item.get(`files/${name}`)
            path = path.slice(name.length+1)
        }
        return item
    }
    async read(path) {
        /* Search for a File/FileLocal pointed to by a given `path` and return its content as a utf8 string. */
        let f = await this.search(path)
        if (f instanceof File) return f.read()
        throw new Error(`not a File: ${path}`)
    }
    async get_name(item) {
        /* Return a name assigned to a given item. If the same item is assigned multiple names,
        the last one is returned. */
        let names = await this.temp('names')
        return names.get(item.id, null)
    }
    async _temp_names()     { return ItemsMap.reversed(await this.get('files')) }
}

export class FolderLocal extends Folder {

    // async search(path) {
    //     let fs = import('fs')
    //     let root = await this.get('path')
    //
    //     if (!root) return undefined
    //     if (!root.endsWith('/')) root = root + '/'
    //     if (path.startsWith(Folder.SEP_FOLDER)) path = path.slice(1)
    //     let fullpath = root + path
    //
    //     if (path) return fs.readFileSync(path, {encoding})
    //
    //
    //     let item = this
    //     while (path) {
    //         let name = path.split(Folder.SEP_FOLDER)[0]
    //         item = await item.get(`files/${name}`)
    //         path = path.slice(name.length+1)
    //     }
    //     return item
    // }
    // async read(path) {
    //     /* Search for a File/FileLocal pointed to by a given `path` and return its content as a utf8 string. */
    //     let f = await this.search(path)
    //     if (f instanceof File) return f.read()
    //     throw new Error(`not a file: ${path}`)
    // }
    // async get_name(item) {
    //     /* Return a name assigned to a given item. If the same item is assigned multiple names,
    //     the last one is returned. */
    //     let names = await this.temp('names')
    //     return names.get(item.id, null)
    // }
    // async _temp_names()     { return ItemsMap.reversed(await this.get('files')) }
}

