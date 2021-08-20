"use strict";

class Widget {}

class ValueInteger extends Widget {

}

class generic_protocol {
    bind(widget) {
        let view = widget.querySelector("#view");
        let edit = widget.querySelector("#edit");
        view.addEventListener('dblclick', () => this.show(view, edit));
        edit.addEventListener('focusout', () => this.hide(view, edit));

        // let input = edit.querySelector(".input");       // the (unique) element that contains a form value inserted by user
        // input.reset();

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

let protocols = {
    STRING: new generic_protocol(),
}

function bind_all() {
    // find all elements with a "protocol" defined and bind event handlers to each of them
    $("[protocol]").each(function (i, widget) {
        let name = widget.getAttribute('protocol');
        if (name in protocols) {
            protocols[name].bind(widget);
        }
    });
}

// document ready
$(function() {
    bind_all();
});
// $("document").ready(function() {
//     document.querySelectorAll("[protocol='STRING']").forEach(function (widget) {
