"use strict";

class Widget {}

class ValueInteger extends Widget {

}

class generic_protocol {
    constructor(enter_accepts = false) {
        this._enter_accepts = enter_accepts;
    }

    bind(widget) {
        let view = widget.querySelector("#view");
        let edit = widget.querySelector("#edit");
        view.addEventListener('dblclick', () => this.show(view, edit));
        edit.addEventListener('focusout', () => this.hide(view, edit));

        if (this._enter_accepts) {
            edit.addEventListener("keyup", ({key}) => {if (key === "Enter") { this.hide(view, edit) }});
        }
        this.set_preview(view, edit);
    }
    show(view, edit) {
        //console.log('in show_edit()');
        view.style.display = 'none';
        edit.style.display = 'block';
        let focus = edit.querySelector(".focus");       // the element that should receive focus after form activation; can be missing
        if (focus) { focus.focus(); }
    }
    hide(view, edit) {
        this.set_preview(view, edit);
        edit.style.display = 'none';
        view.style.display = 'block';
    }
    set_preview(view, edit) {
        let input = edit.querySelector(".input");       // the (unique) element that contains a form value inserted by user
        view.textContent = input.value;
    }
}

// a protocol that displays a modal pop-up window for editing
class popup_protocol extends generic_protocol {
}

let protocols = {
    STRING: new generic_protocol(true),
    TEXT: new generic_protocol(),
}

function bind_all() {
    // find all elements with a "protocol" defined and bind event handlers to each of them
    $("[protocol]").each(function (i, widget) {
        let name = widget.getAttribute('protocol');
        if (name in protocols) {
            protocols[name].bind(widget);
        } else {
            console.warn(`protocol '${name}' is undefined`);
        }
    });
}

// document ready
$(function() {
    bind_all();
});
// $("document").ready(function() {
//     document.querySelectorAll("[protocol='STRING']").forEach(function (widget) {
