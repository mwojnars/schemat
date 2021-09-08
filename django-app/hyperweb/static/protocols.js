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

class Element extends HTMLElement {

    // default values for `this.props`; must be declared as static in subclasses
    static props = { useShadowDOM: false };
    static state = {};

    props = null;
    state = null;

    constructor(props = {}) {
        super();

        let base_props = [];
        let proto = this;
        while (proto && proto !== Element.prototype) {
            proto = Object.getPrototypeOf(proto);
            let p = proto.constructor.props;
            if (p) base_props.push(p);
        }
        // combine `properties` of all base classes into `this.props`, with instance `props` appended at the end
        this.props = Object.assign({}, ...base_props.reverse(), props);
        this.state = {};
    }

    connectedCallback() {
        const { useShadowDOM } = this.props;
        let initDone = false;
        let template = this.render();

        if (typeof template !== 'undefined')                // insert widget's template into the document
            if (useShadowDOM) {
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
    init()      {}
    render()    {}
}

class Widget extends Element {
    static state = {
        editing: false,                 // true if the edit form is active, false otherwise (preview is active)
    };

    _current_value = undefined;         // most recent value accepted by user after edit
    _initial_value = undefined;         // for change detection
}

/*************************************************************************************************/

class SimpleWidget extends Widget {
    /* Base class for schema widgets containing separate #view/#edit sub-widgets
     * and a unique input element inside the edit form. */

    // static View = class { constructor() {} };

    static props = {
        enter_accepts:  false,
        esc_accepts:    true,
    }

    // _enter_accepts = false;
    // _esc_accepts   = true;

    _view = null;           // <div> containing a preview sub-widget
    _edit = null;           // <div> containing an edit form

    init() {
        let view = this._view = this.querySelector("#view");
        let edit = this._edit = this.querySelector("#edit");

        view.addEventListener('dblclick', () => this.show());
        edit.addEventListener('focusout', () => this.hide());

        let value = this._initial_value = this.getAttribute('data-value');
        // let value = this._initial_value = this.textContent;

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
    // is_editing()    { return this.state.editing }

    get_value()     { return this._current_value }      // should only be used if value_changed() is true
    value_changed() { return (typeof this._current_value !== 'undefined') && (this._current_value !== this._initial_value) }
    update_value()  { this._current_value = this.get_form() }
    update_view()   { this._view.textContent = this._current_value }

    set_form(value) {
        /* write `value` into elements of the edit form; by default, assume there's exactly one
         * form element and it's identified by ".input" css class */
        this._edit.querySelector(".input").value = value;
    }
    get_form() {
        /* collect values of individual form elements and combine into a single value object */
        return this._edit.querySelector(".input").value;
    }
}
// console.log(new SimpleWidget.View());


class STRING extends SimpleWidget {
    // _enter_accepts = true;
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

class TEXT extends SimpleWidget {
    render = () => `
        <pre><div id="view" class="scroll"></div></pre>
        <div id="edit" style="display:none">
            <pre><textarea class="focus input" rows="1" style="width:100%;height:10em" wrap="off" /></pre>
        </div>
    `;
}

class CODE extends SimpleWidget {
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

    #view_editor = null;
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
    // update_view()   { this.view_editor.session.setValue(this._current_value); }
    set_form(value) { this.editor.session.setValue(value); }
    get_form()      { return this.editor.session.getValue(); }
}


window.customElements.define('hw-widget-string', STRING);
window.customElements.define('hw-widget-text', TEXT);
window.customElements.define('hw-widget-code', CODE);


/*************************************************************************************************/

class CatalogAtomicEntry extends LitElement {
    /* A row containing an atomic value of a data field (not a subcatalog) */

    static get properties() { return {
        key:    { type: String },
        value:  { type: Object },
        schema: { type: Object },
    }}
    render() {
        return html`
            <th class="ct-field">${escape(this.key)}</th>
            <td class="ct-value">${this.schema.display(this.value)}</td>
        `;
    }
}
class Catalog extends HTMLElement {

}

class Item {
    static Properties = class extends Catalog {
        connectedCallback() { setTimeout(() => this.init()); }
        init() {
            let data = this._data = this.getAttribute('data-item');
        }
    }
}

window.customElements.define('hw-item-properties', Item.Properties);

/*************************************************************************************************/

// class generic_protocol {
//     // Watch out: a single protocol instance can be bind to multiple distinct elements,
//     // therefore all inner elements #view, #edit etc. must be *local* to a binding method
//     // rather than assigned to `this`.
//
//     constructor(enter_accepts = false, esc_accepts = true) {
//         this._enter_accepts = enter_accepts;
//         this._esc_accepts = esc_accepts;
//     }
//
//     bind(widget) {
//         let view = widget.querySelector("#view");
//         let edit = widget.querySelector("#edit");
//         view.addEventListener('dblclick', () => this.show(view, edit));
//         edit.addEventListener('focusout', () => this.hide(view, edit));
//
//         if (this._enter_accepts || this._esc_accepts) {
//             let keys = [];
//             if (this._enter_accepts) { keys.push("Enter"); }
//             if (this._esc_accepts)   { keys.push("Escape"); }
//             edit.addEventListener("keyup", ({key}) => {if (keys.includes(key)) { this.hide(view, edit) }});
//         }
//         this.hide(view, edit);
//         // this.set_preview(view, edit);
//     }
//     show(view, edit) {
//         //console.log('in show_edit()');
//         view.style.display = 'none';
//         edit.style.display = 'block';
//         let focus = edit.querySelector(".focus");       // the element that should receive focus after form activation; can be missing
//         if (focus) { focus.focus(); }
//     }
//     hide(view, edit) {
//         this.set_preview(view, edit);
//         edit.style.display = 'none';
//         view.style.display = 'block';
//     }
//     set_preview(view, edit) {
//         let input = edit.querySelector(".input");       // the (unique) element that contains a form value inserted by user
//         view.textContent = input.value;
//     }
// }
//
// // a protocol that displays a modal dialog window for editing
// class dialog_protocol extends generic_protocol {
// }
//
// let protocols = {
//     STRING: new generic_protocol(true),
//     TEXT:   new generic_protocol(),
// }
//
// function bind_all() {
//     // find all elements with a "protocol" defined and bind event handlers to each of them
//     $("[protocol]").each(function (i, widget) {
//         let name = widget.getAttribute('protocol');
//         if (name in protocols) {
//             protocols[name].bind(widget);
//         } else {
//             console.warn(`protocol '${name}' is undefined`);
//         }
//     });
// }
//
// // document ready
// $(function() {
//     bind_all();
// });
// // $("document").ready(function() {
// //     document.querySelectorAll("[protocol='STRING']").forEach(function (widget) {


/*************************************************************************************************/

