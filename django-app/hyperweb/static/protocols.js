"use strict";

/*************************************************************************************************/

class Schema_ extends HTMLElement {
    connectedCallback() {
        let shadow = this.attachShadow({mode: 'open'});
        let view = this._view = document.createElement('div');
        let edit = this._edit = document.createElement('div');
        this.shadowRoot.append(view, edit);

        let value_json = this.getAttribute('data-value');
        let value = JSON.parse(value_json);
        this.set_value(value);
    }
    set_value(value) {}
    get_value() { return null; }
}

/*************************************************************************************************/

class Schema extends HTMLElement {
    _enter_accepts = false;
    _esc_accepts   = true;

    _view = null;           // <div> containing a preview sub-widget
    _edit = null;           // <div> containing an edit form

    _current_value = undefined;         // most recent value accepted by user after edit
    _initial_value = undefined;         // for change detection
    _editing       = false;             // current state of the widget: previewing (false) / editing (true)

    connectedCallback() {
        // console.log("in Schema.connectedCallback()");
        setTimeout(() => this.bind());      // binding must be delayed until the light DOM (children) is initialized
    }
    bind() {
        let view = this._view = this.querySelector("#view");
        let edit = this._edit = this.querySelector("#edit");

        view.addEventListener('dblclick', () => this.show());
        edit.addEventListener('focusout', () => this.hide());

        let value = this._initial_value = this.getAttribute('data-value');

        if (typeof value !== 'undefined') {
            this.set_form(value);
        }

        if (this._enter_accepts || this._esc_accepts) {
            let keys = [];
            if (this._enter_accepts) { keys.push("Enter"); }
            if (this._esc_accepts)   { keys.push("Escape"); }
            edit.addEventListener("keyup", ({key}) => {if (keys.includes(key)) { this.hide() }});
        }
        this.hide();
        // this.set_preview(view, edit);
    }
    show() {
        /* show the edit form, hide the preview */
        this._editing = true;
        this._view.style.display = 'none';
        this._edit.style.display = 'block';
        let focus = this._edit.querySelector(".focus");       // the element that should receive focus after form activation; can be missing
        if (focus) { focus.focus(); }
    }
    hide(accept = true) {
        /* hide the edit form, show the preview */
        if (accept) { this.update_value(); }
        this.set_preview();
        this._edit.style.display = 'none';
        this._view.style.display = 'block';
        this._editing = false;
    }
    is_editing()    { return this._editing }

    get_value()     { return this._current_value }      // should only be used if value_changed() is true
    value_changed() { return (typeof this._current_value !== 'undefined') && (this._current_value !== this._initial_value) }
    update_value()  { this._current_value = this.get_form() }
    set_preview()   { this._view.textContent = this._current_value }

    set_form(value) {
        /* write `value` into the elements of the edit form; by default, assume there's exactly one
         * form element, that's identified by .input css class */
        this._edit.querySelector(".input").value = value;
    }
    get_form() {
        /* collect values of individual form elements and combine into a single value object */
        return this._edit.querySelector(".input").value;
    }
}

class STRING    extends Schema { _enter_accepts = true }
class TEXT      extends Schema {}


window.customElements.define('hw-schema-string', STRING);
window.customElements.define('hw-schema-text', TEXT);


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

