"use strict";

//import {LitElement, html, css} from "https://unpkg.com/lit-element/lit-element.js?module";

/*************************************************************************************************/
/* UTILITIES
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
        let node = (selector ? this.querySelector(selector) : this);
        if (node === undefined) return undefined;
        let value = node.textContent;
        if (!type) type = node.getAttribute('type');

        // decode `value` depending on the `type`
        if (type === "json") return JSON.parse(value);
        return value;
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
        console.log('Item_() data_flat:', data_flat);
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


/*************************************************************************************************/
/*************************************************************************************************/

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
        for ([key, value] of Object.entries(data)) {
            console.log(key, value);
        }
    }
}

class Item {

    cid = null;
    iid = null;
    //loaded = null;    // names of fields that have been loaded so far

    constructor(data_flat, category) {
        this.category = category;
        this.data = data_flat; //this.load(data_flat);
        console.log('Item_() data_flat:', data_flat);
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

    static Properties = class extends Catalog {}

    static Page = class extends CustomElement {
        static props = {useShadowDOM: true,}
        init() {
            let data = this.read_data('', 'json');
            console.log('Item.Page.init() data:', data)
            // let g = globalThis;
            // g.category = this._category = new Item_(this.read_data('p#category'));
            // g.item     = this._item     = new Item_(this.read_data('p#item'), category)        //this.getAttribute('data-item')
        }
        render = () => `
            <h2>Properties</h2>
            <hw-item-properties></hw-item-properties>
        `
    }
}

window.customElements.define('hw-item-page', Item.Page);

/*************************************************************************************************/

class Classpath {
    // m = new Map()
    // m.set(C, path_C)
    // c.constructor == C
    // Array.from(m.keys())                 -- array of all keys
    // for (k of m.keys()) console.log(k)   -- iterating over keys
}

class Registry {
    get_item(id) {}
}

let registry = window.registry = new Registry();


