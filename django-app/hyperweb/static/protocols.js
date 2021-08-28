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

class Widget extends HTMLElement {
    _template      = undefined;
    _editing       = false;             // current state of the widget: previewing (false) / editing (true)
    _current_value = undefined;         // most recent value accepted by user after edit
    _initial_value = undefined;         // for change detection

}

class SimpleWidget extends Widget {
    /* Base class for schema widgets containing separate #view/#edit sub-widgets
     * and a unique input element inside the edit form. */

    // static View = class { constructor() {} };

    _enter_accepts = false;
    _esc_accepts   = true;

    _view = null;           // <div> containing a preview sub-widget
    _edit = null;           // <div> containing an edit form

    connectedCallback() {
        // console.log("in Widget.connectedCallback()");
        if (typeof this._template !== 'undefined') {                    // insert _template into the document
            // this.insertAdjacentHTML('beforeend', this._template);
            this.innerHTML = this._template;        // insertAdjacentHTML() can't be used bcs connectedCallback() can be invoked multiple times
            this.bind();
        }
        else {
            // without _template, binding must be delayed until the light DOM (children) is initialized,
            // which usually happens AFTER connectedCallback()
            setTimeout(() => this.bind());
        }
    }
    bind() {
        let view = this._view = this.querySelector("#view");
        let edit = this._edit = this.querySelector("#edit");

        view.addEventListener('dblclick', () => this.show());
        edit.addEventListener('focusout', () => this.hide());

        let value = this._initial_value = this.getAttribute('data-value');
        // let value = this._initial_value = this.textContent;

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
    _enter_accepts = true;
    _template = `
        <div id="view"></div>
        <div id="edit" style="display:none">
            <input class="focus input" type="text" style="width:100%" />
        </div>
    `
    // "display:none" prevents a flash of unstyled content (FOUC) for #edit
    // autocomplete='off' prevents the browser overriding <input value=...> with a cached value inserted previously by a user
}

class TEXT extends SimpleWidget {
    _template = `
        <pre><div id="view" class="scroll"></div></pre>
        <div id="edit" style="display:none">
            <pre><textarea class="focus input" rows="1" style="width:100%;height:10em" wrap="off" /></pre>
        </div>
    `
}

class CODE extends SimpleWidget {
    _template = `
        <!--<div id="view"><div class="ace-editor"></div></div>-->
        <pre><div id="view" class="scroll"></div></pre>
        <div id="edit" style="display:none">
            <div class="ace-editor"></div>
        </div>
    `;
    view_options = {
        mode:           "ace/mode/haml",
        theme:          "ace/theme/textmate",     // dreamweaver crimson_editor
        readOnly:               true,
        showGutter:             false,
        displayIndentGuides:    false,
        showPrintMargin:        false,
        highlightActiveLine:    false,
    };
    edit_options = {
        mode:           "ace/mode/haml",
        theme:          "ace/theme/textmate",     // dreamweaver crimson_editor
        showGutter:             true,
        displayIndentGuides:    true,
        showPrintMargin:        true,
        highlightActiveLine:    true,
    };

    view_editor = null;
    edit_editor = null;

    bind() {
        this.edit_editor = this.create_editor("#edit", this.edit_options);
        // this.view_editor = this.create_editor("#view", this.view_options);
        // this.view_editor.renderer.$cursorLayer.element.style.display = "none";      // no cursor in preview editor
        super.bind();
    }
    create_editor(path, options) {
        let editor_div = this.querySelector(path + " .ace-editor");
        let editor = ace.edit(editor_div, options);
        new ResizeObserver(() => { editor.resize(); }).observe(editor_div);     // allow resizing of the editor box by a user; must update the Ace widget then
        return editor;
    }

    // set_preview()   { this.view_editor.session.setValue(this._current_value); }
    set_form(value) { this.edit_editor.session.setValue(value); }
    get_form()      { return this.edit_editor.session.getValue(); }
}


window.customElements.define('hw-widget-string', STRING);
window.customElements.define('hw-widget-text', TEXT);
window.customElements.define('hw-widget-code', CODE);


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

