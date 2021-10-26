"use strict";

//import {LitElement, html, css} from "https://unpkg.com/lit-element/lit-element.js?module";

import { assert } from './utils.js'
import { generic_schema } from './types.js'
// import * as mod_types from './types.js'

// console.log("Schema:", Schema)
// console.log("mod_types:", mod_types, typeof mod_types)

const ROOT_CID = 0

/**********************************************************************************************************************
 **
 **  UTILITIES
 **
 */

const htmlEscapes = {
    '&': '&amp',
    '<': '&lt',
    '>': '&gt',
    //'"': '&quot',
    //"'": '&#39'
}
const reUnescapedHtml = /[&<>]/g

function escape(string) {
    // reduced version of Lodash's escape(): https://github.com/lodash/lodash/blob/9d11b48ce5758df247607dc837a98cbfe449784a/escape.js
    return string.replace(reUnescapedHtml, (chr) => htmlEscapes[chr]);
}

/*************************************************************************************************/

// class Schema_ extends HTMLElement {
//     connectedCallback() {
//         let shadow = this.attachShadow({mode: 'open'});
//         let view = this._view = document.createElement('div');
//         let edit = this._edit = document.createElement('div');
//         this.shadowRoot.append(view, edit);
//
//         let value_json = this.getAttribute('data-value');
//         let value = JSON.parse(value_json);
//         this.set_value(value);
//     }
//     set_value(value) {}
//     get_value() { return null; }
// }

class CustomElement extends HTMLElement {
    /* Base class for custom HTML elements derived from HTMLElement. 
       Implements connectedCallback() to render and initialize the element's HTML contents
       as either light or shadow DOM. Method render() is called before init() to create the DOM.
       If render's result is undefined, the original light DOM as in HTML source is kept.
       Provides basic representation for properties (with class-level defaults) and state variables.
       Each subclass must be manually declared (!) as a custom element before use: window.customElements.define(...).
     */

    // default values for `this.props`; must be declared as static in subclasses
    static props = {
        useShadowDOM: false,        // if true, result of render() is pasted into a shadow DOM; to the light DOM otherwise (default)
    }
    static state = {}

    props = null;
    state = null;

    constructor(props = {}) {
        super();

        let base_props = [];
        let proto = this;
        while (proto && proto !== CustomElement.prototype) {
            proto = Object.getPrototypeOf(proto);
            let p = proto.constructor.props;
            if (p) base_props.push(p);
        }
        // combine `properties` of all base classes into `this.props`;
        // append instance's and constructor's `props` at the end
        this.props = Object.assign({}, ...base_props.reverse(), this.props, props);
        this.state = {};
    }

    connectedCallback() {
        let template = this.render();
        let initDone = false;

        if (typeof template !== 'undefined')                // insert widget's template into the document
            if (this.props.useShadowDOM) {
                this.attachShadow({mode: 'open'});
                this.shadowRoot.innerHTML = template;
            } else {
                // this.insertAdjacentHTML('beforeend', template);
                this.innerHTML = template;                  // insertAdjacentHTML() can't be used bcs connectedCallback() can be invoked multiple times
                this.init();
                initDone = true;
            }
        if (!initDone)
            // without a template, when child nodes are defined inside an HTML occurrence of this element,
            // init() must be delayed until the light DOM (children) is initialized, which usually happens AFTER connectedCallback()
            setTimeout(() => this.init());
    }
    render()    {}          // override in subclasses
    init()      {}          // override in subclasses

    read_data(selector, type) {
        /* Extract text contents of a (sub)element pointed to by a given selector ('' denotes the current node).
           Typically called from render(), before the DOM is overriden with the output of render().
           If `type` is given, or the element has `type` attribute, and it's equal "json",
           the extracted string is JSON-decoded to an object.
         */
        let node = (selector ? this.querySelector(selector) : this)
        if (node === undefined) return undefined
        let value = node.textContent
        if (!type) type = node.getAttribute('type')

        // decode `value` depending on the `type`
        if (type === "json") return JSON.parse(value)
        return value
    }
}

/*************************************************************************************************/

class EditableElement extends CustomElement {
    /* Base class for schema-based editable value widgets. Provides a default implementation
       for two separate subwidgets (#view, #edit) with a unique input element inside the edit form.
     */
    // static View = class { constructor() {} };

    static props = {
        enter_accepts:  false,
        esc_accepts:    true,
    }
    static state = {
        editing:        false,              // true if the edit form is active, false otherwise (preview is active)
        initial_value:  undefined,
        current_value:  undefined,
    }

    _view = null;           // <div> containing a preview sub-widget
    _edit = null;           // <div> containing an edit form

    init() {
        let view = this._view = this.querySelector("#view");
        let edit = this._edit = this.querySelector("#edit");

        view.addEventListener('dblclick', () => this.show());
        edit.addEventListener('focusout', () => this.hide());

        let value = this.state.initial_value = this.getAttribute('data-value');
        // let value = this.state.initial_value = this.textContent;

        if (typeof value !== 'undefined') this.set_form(value);

        if (this.props.enter_accepts || this.props.esc_accepts) {
            let keys = [];
            if (this.props.enter_accepts) { keys.push("Enter"); }
            if (this.props.esc_accepts)   { keys.push("Escape"); }
            edit.addEventListener("keyup", ({key}) => {if (keys.includes(key)) this.hide() });
        }
        this.hide();
    }
    show() {
        /* show the edit form, hide the preview */
        this.state.editing = true;
        this._view.style.display = 'none';
        this._edit.style.display = 'block';
        let focus = this._edit.querySelector(".focus");       // the element that should receive focus after form activation; can be missing
        if (focus) focus.focus();
    }
    hide(accept = true) {
        /* hide the edit form, show the preview */
        if (accept) { this.update_value(); }
        this.update_view();
        this._edit.style.display = 'none';
        this._view.style.display = 'block';
        this.state.editing = false;
    }

    get_value()     { return this.state.current_value }      // should only be used if value_changed() is true
    value_changed() { return (typeof this.state.current_value !== 'undefined') && (this.state.current_value !== this.state.initial_value) }
    update_value()  { this.state.current_value = this.get_form() }
    update_view()   { this._view.textContent = this.state.current_value }

    set_form(value) {
        /* write `value` into elements of the edit form; by default, assume there's exactly one
         * form element and it's identified by ".input" css class */
        this._edit.querySelector(".input").value = value;
    }
    get_form() {
        /* collect values of individual form elements and combine into a single value object */
        return this._edit.querySelector(".input").value;
    }

    submit() {
        /* send current_value to the server via ajax call */
        let url  = window.location.href;     // this.url({endpoint: 'submit'})
        let data = undefined;

        $.ajax({
            method:         'POST',
            url:            url + '@set',
            data:           JSON.stringify(data),
            contentType:    "application/json; charset=utf-8",
        });
    }
}
// console.log(new EditableElement.View());


class STRING_ extends EditableElement {
    static props = { enter_accepts: true }
    render = () => `
        <div id="view"></div>
        <div id="edit" style="display:none">
            <input class="focus input" type="text" style="width:100%" />
        </div>
    `;
    // "display:none" prevents a flash of unstyled content (FOUC) for #edit
    // autocomplete='off' prevents the browser overriding <input value=...> with a cached value inserted previously by a user
}

class TEXT_ extends EditableElement {
    render = () => `
        <pre><div id="view" class="scroll"></div></pre>
        <div id="edit" style="display:none">
            <pre><textarea class="focus input" rows="1" style="width:100%;height:10em" wrap="off" /></pre>
        </div>
    `;
}

class CODE_ extends EditableElement {
    render = () => `
        <!--<div id="view"><div class="ace-editor"></div></div>-->
        <pre><div id="view" class="scroll"></div></pre>
        <div id="edit" style="display:none">
            <div class="ace-editor"></div>
        </div>
    `;
    // view_options = {
    //     mode:           "ace/mode/haml",
    //     theme:          "ace/theme/textmate",     // dreamweaver crimson_editor
    //     readOnly:               true,
    //     showGutter:             false,
    //     displayIndentGuides:    false,
    //     showPrintMargin:        false,
    //     highlightActiveLine:    false,
    // };
    edit_options = {
        mode:           "ace/mode/haml",
        theme:          "ace/theme/textmate",     // dreamweaver crimson_editor
        showGutter:             true,
        displayIndentGuides:    true,
        showPrintMargin:        true,
        highlightActiveLine:    true,
    };

    // view_editor = null;
    editor = null;

    init() {
        this.editor = this.create_editor("#edit", this.edit_options);
        // this.view_editor = this.create_editor("#view", this.view_options);
        // this.view_editor.renderer.$cursorLayer.element.style.display = "none";      // no cursor in preview editor
        super.init();
    }
    create_editor(path, options) {
        let editor_div = this.querySelector(path + " .ace-editor");
        let editor = ace.edit(editor_div, options);
        new ResizeObserver(() => editor.resize()).observe(editor_div);     // allow resizing of the editor box by a user; must update the Ace widget then
        return editor;
    }
    show() {
        super.show();
        this.editor.focus();
    }
    // update_view()   { this.view_editor.session.setValue(this.state.current_value); }
    set_form(value) { this.editor.session.setValue(value); }
    get_form()      { return this.editor.session.getValue(); }
}


window.customElements.define('hw-widget-string-', STRING_);
window.customElements.define('hw-widget-text-', TEXT_);
window.customElements.define('hw-widget-code-', CODE_);


/*************************************************************************************************/

class Item_ {

    cid = null;
    iid = null;

    //loaded = null;    // a set of field names that have already been loaded

    constructor(data_flat, category) {
        this.category = category;
        this.data = data_flat; //this.load(data_flat);
        // console.log('Item_() data_flat:', data_flat);
    }

    get(field) {
        return this.data[field];                        // TODO: support repeated keys (MultiDict)
    }

    load(data_flat) {
        // let fields = this.category.get('fields');       // specification of fields {field_name: schema}
        // return fields.load_json(data_json);
        return generic_schema.decode(data_flat);
        // return MultiDict(...);
    }

    static Page = class extends CustomElement {
        init() {
            let g = globalThis;
            g.category = this._category = new Item_(this.read_data('p#category'));
            g.item     = this._item     = new Item_(this.read_data('p#item'), category)        //this.getAttribute('data-item')
        }
    }
}

window.customElements.define('hw-item-page-', Item_.Page);


/**********************************************************************************************************************
 **
 **  ITEM & CATEGORY
 **
 */

// class CatalogAtomicEntry extends LitElement {
//     /* A row containing an atomic value of a data field (not a subcatalog) */
//
//     static get properties() { return {
//         key:    { type: String },
//         value:  { type: Object },
//         schema: { type: Object },
//     }}
//     render() {
//         return html`
//             <th class="ct-field">${escape(this.key)}</th>
//             <td class="ct-value">${this.schema.display(this.value)}</td>
//         `;
//     }
// }
class Catalog extends CustomElement {
    render = () => `
        <th class="ct-field">${escape(this.props.key)}</th>
        <td class="ct-value">${this.props.schema.display(this.props.value)}</td>
    `
    __render() {
        const { data } = this.props;
        for (let [key, value] of Object.entries(data)) {
            console.log(key, value);
        }
    }
}

class Item {

    cid = null      // CID (Category ID) of this item; cannot be undefined, only "null" if missing
    iid = null      // IID (Item ID within a category) of this item; cannot be undefined, only "null" if missing

    data            // properties of this item, as a plain object {..}; in the future, MultiDict can be used instead

    category        // parent category of this item, as an instance of Category
    registry        // Registry that manages access to this item (should refer to the unique global registry)

    //loaded = null;    // names of fields that have been loaded so far

    get id()   { return [this.cid, this.iid] }
    has_id()   { return this.cid !== null && this.iid !== null }
    // has_id()   { let id = this.id; return !(id.includes(null) || id.includes(undefined)) }
    has_data() { return !!this.data }

    constructor(category = null, data = null) {
        if (data) this.data = data
        if (category) {
            this.category = category
            this.registry = category.registry
            this.cid      = category.iid
        }
        //this.load(data)
        // console.log('Item() data_flat:', data)
    }

    static from_dump(state, category = null, use_schema = true) {
        /* Recreate an item that was serialized with Item.dump_item(), possibly at the server. */
        let schema = use_schema ? category.get_schema() : generic_schema
        let data = schema.decode(state['data'])
        delete state['data']

        let item = new Item(category, data)
        Object.assign(item, state)                  // copy remaining metadata from `state` to `item`
        return item
    }

    get(field) {
        return this.data[field]
    }
    load(data_flat) {
        // TODO TODO TODO .....
        // let fields = this.category.get('fields')       // specification of fields {field_name: schema}
        // return fields.load_json(data_json)
        return generic_schema.decode(data_flat)
    }
    bind() {
        /*
        Override this method in subclasses to provide initialization after this item is retrieved from DB.
        Typically, this method initializes transient properties and performs cross-item initialization.
        Only after bind(), the item is a fully functional element of a graph of interconnected items.
        When creating new items, bind() should be called manually, typically after all related items
        have been created and connected.
        */
    }

    static Properties = class extends Catalog {}

    static Page = class extends CustomElement {
        static props = {useShadowDOM: true,}
        init() {
            let g = globalThis

            let dump_catg = this.read_data('p#category', 'json');
            console.log('Item.Page.init() dump_catg:', dump_catg)
            g.category = Item.from_dump(dump_catg, null, false)
            console.log('Item.Page.init() category:', g.category)

            // let dump_item = this.read_data('p#item', 'json');
            // console.log('Item.Page.init() dump_item:', dump_item)
            // g.item     = Item.from_dump(dump_item, g.category)
            // console.log('Item.Page.init() item:', g.item)

            // g.category = this._category = new Item_(this.read_data('p#category'));
            // g.item     = this._item     = new Item_(this.read_data('p#item'), category)        //this.getAttribute('data-item')
        }
        render = () => `
            <h2>Properties</h2>
            <hw-item-properties></hw-item-properties>
        `
    }
}

class Category extends Item {
    get_schema(field = null) {
        /* Return schema of a given field, or all fields (if field=null), in the latter case a FIELDS object is returned. */
        // this.load()
        let fields = this.get('fields')
        if (!field) return fields
        let schema = (field in fields) ? fields[field].schema : null
        return schema || generic_schema
    }
}
class RootCategory extends Category {
    cid = ROOT_CID
    iid = ROOT_CID

    constructor(registry, load) {
        super()
        this.registry = registry
        this.category = this                    // root category is a category for itself

        if (load) this.load()
        else {                                  // data is set from scratch only when the root is created anew rather than loaded
            assert(false)
            // from .core.root import root_data
            // this.data = Data(root_data)
        }
        this.bind()
    }
}

/**********************************************************************************************************************
 **
 **  CACHE & DATABASE
 **
 */

class LocalCache {
    /* Client-side item cache based on Web Storage (local storage or session storage). */
    // TODO: implement

    cache = new Map()

    key(id)       { return `${id[0]}:${id[1]}` }            // item ID is an array that must be converted to a string for equality comparisons inside Map
    set(id, item) { this.cache.set(this.key(id), item) }
    get(id)       { return this.cache.get(this.key(id)) }
}

class Classpath {
    forward = new Map()         // dict of objects indexed by paths: (path -> object)
    inverse = new Map()         // dict of paths indexed by objects: (object -> path)

    set(path, obj) {
        /*
        Assign `obj` to a given path. Create an inverse mapping if `obj` is a class or function.
        Override an existing object if already present.
        */
        this.forward.set(path, obj)
        if (typeof obj === "function")
            this.inverse.set(obj, path)             // create inverse mapping for classes and functions
    }
    set_many(path, ...objects) {
        /* Add multiple objects to a given `path`, under names taken from their `obj.name` properties. */
        for (let obj of objects) {
            let name = obj.name
            if (!name) throw `Missing .name of an unnamed object being added to Classpath at path '${path}': ${obj}`
            this.set(`${path}.${name}`, obj)
        }
        // for (let [name, obj] of Object.entries(named ?? {}))
        //     this.set(`${path}.${name}`, obj)
    }

    async set_module(path, module_url, {symbols, accept, exclude_variables = true} = {})
        /*
        Add symbols from `module` to a given package `path`.
        If `symbols` is missing, all symbols found in the module are added, excluding:
        1) variables (i.e., not classes, not functions), if exclude_variables=true;
        2) symbols that point to objects whose accept(obj) is false, if `accept` function is defined.
        */
    {
        // import(module_url).then(module => {console.log(module)})
        let module = await import(module_url)
        
        if (typeof symbols === "string")    symbols = symbols.split()
        else if (!symbols)                  symbols = Object.keys(module)
        if (exclude_variables)              symbols = symbols.filter(s => typeof module[s] === "function")

        for (let name of symbols) {
            let obj = module[name]
            if (accept && !accept(obj)) continue
            this.set(`${path}.${name}`, obj)
        }
    }

    encode(obj) {
        /*
        Return canonical path of a given class or function, `obj`. If `obj` was added multiple times
        under different names (paths), the most recently assigned path is returned.
        */
        let path = this.inverse.get(obj)
        if (path === undefined) throw `Not in classpath: ${obj.name ?? obj}`
        return path
    }
    decode(path) {
        /* Return object pointed to by a given path. */
        let obj = this.forward.get(path)
        if (obj === undefined) throw `Unknown class path: ${path}`
        return obj
    }
}

/**********************************************************************************************************************/

class Database {}

class AjaxDB extends Database {
    /* Remote abstract DB layer that's accessed by this web client over AJAX calls. */

    base_url  = ""
    preloaded = null        // list of item records that have been received on an initial web request to avoid subsequent remote calls

    select(id) {
        /* Retrieve an item from DB by its ID = (CID,IID) */
        let url  = window.location.href
        let data = undefined

        $.ajax({
            method:         'POST',
            url:            url + '@set',
            data:           JSON.stringify(data),
            contentType:    "application/json; charset=utf-8",
        })
    }
}

/**********************************************************************************************************************
 **
 **  REGISTRY
 **
 */

class Registry {

    static STARTUP_SITE = 'startup_site'        // this property of the root category stores the current site, for startup boot()

    db      = null          // Database instance for accessing items and other data from database servers
    cache   = null
    root    = null          // permanent reference to a singleton root Category object, kept here instead of cache
    site_id = null          // `site` is a property (below), not attribute, to avoid issues with caching (when an item is reloaded)

    async init_classpath() {
        let classpath = new Classpath

              classpath.set_many  ("hyperweb.core", Item, Category)
        await classpath.set_module("hyperweb.types", "./types.js")

        this.classpath = classpath
    }
    init_cache(items) {
        /* Insert selected preloaded items into cache before booting. */
    }

    boot(items = []) {
        // this.db.load()
        this.init_cache(items)
        this.root = this.create_root()
        this.site_id = this.root.get(Registry.STARTUP_SITE)
    }
    create_root(load = true) {
        /*
        Create the RootCategory object, ID=(0,0). If `data` is provided,
        the properties are initialized from `data`, the object is bound through bind(),
        marked as loaded, and staged for insertion to DB. Otherwise, the object is left uninitialized.
        */
        this.root = new RootCategory(this, load)
        // if (!load)                          # root created anew? this.db must be used directly (no stage/commit), because
        //     this.db.insert(root)         # ...this.root already has an ID and it would get "updated" rather than inserted!
        return this.root
    }
    load_item(id) {
        /* Load item record from DB and return as a dict with keys: cid, iid, data, all metadata etc. */
        this.db.select(id)
    }

    get_category(cid) { return this.get_item([ROOT_CID, cid]) }

    get_item(id, version = null, load = false) {
        let [cid, iid] = id
        if (cid === null) throw new Error('missing CID')
        if (iid === null) throw new Error('missing IID')
        if (cid === ROOT_CID && iid === ROOT_CID) return this.root

        // ID requested is already present in cache? return the cached instance
        let item = this.cache.get(id)
        if (!item)
            // create a stub of an item and insert to cache, then load item data - these two steps are
            // separated to ensure proper handling of circular relationships between items
            item = this.create_stub(id)

        if (load) item.load()
        return item
    }
    create_stub(id, category = null) {
        /* Create a "stub" item (no data) with a given ID and insert to cache. */
        let [cid, iid] = id
        category = category || this.get_category(cid)
        let itemclass = Item // TODO: category.get_class()
        let item = new itemclass(category)
        item.iid = iid
        this.cache.set(id, item)
        return item
    }

    get_path(cls) {
        /*
        Return a dotted module path of a given class or function as stored in a global Classpath.
        `cls` should be either a constructor function, or a prototype with .constructor property.
        */
        if (typeof cls === "object")            // if `cls` is a class prototype, take its constructor instead
            cls = cls.constructor
        if (!cls) throw `Argument is empty or not a class: ${cls}`

        return this.classpath.encode(cls)
    }

    get_class(path) {
        /* Get a global object - class or function from a virtual package (Classpath) - pointed to by `path`. */
        return this.classpath.decode(path)
    }
}

class LocalRegistry extends Registry {
    /* Client-side registry: get_item() pulls items from server and caches in browser's web storage. */

    constructor() {
        super()
        this.db    = new AjaxDB()
        this.cache = new LocalCache()
    }
}

/**********************************************************************************************************************
 **
 **  STARTUP
 **
 */

let registry = globalThis.registry = new LocalRegistry
await registry.init_classpath()     // TODO: make sure that registry is NOT used before this call completes

let page_items = null
registry.boot(page_items)

window.customElements.define('hw-item-page', Item.Page);

