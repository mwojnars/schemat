"use strict";

class Widget {}

class ValueInteger extends Widget {

}

function generic_bind(widget) {
    let view  = widget.querySelector("#view");
    let edit  = widget.querySelector("#edit");

    function show_edit() {
        //console.log('in show_edit()');
        view.style.display = 'none';
        edit.style.display = 'block';
        let focus = edit.querySelector(".focus");       // the element that should receive focus after form activation; can be missing
        if (focus) { focus.focus(); }
    }
    function hide_edit() {
        set_preview();
        edit.style.display = 'none';
        view.style.display = 'block';
    }
    function set_preview() {
        let input = edit.querySelector(".input");       // the (unique) element that contains a form value inserted by user
        view.textContent = input.value;
    }

    view.addEventListener('dblclick', show_edit);
    edit.addEventListener('focusout', hide_edit);
}

let protocols = {
    STRING: generic_bind,
}

function bind_all() {
    // find all elements with a "protocol" defined and bind event handlers to each of them
    $("[protocol]").each(function (i, widget) {
        let name = widget.getAttribute('protocol');
        if (name in protocols) {
            let bind = protocols[name];
            bind(widget);
        }
    });
}

// document ready
$(function() {
    bind_all();
});
// $("document").ready(function() {
//     document.querySelectorAll("[protocol='STRING']").forEach(function (widget) {

// $("document").ready(function () {
//
//     $('[protocol="STRING"] #view').dblclick(function () {
//         let value = $(this).html();
//
//         $(this).html('<input type="text" value="' + thisVal + '" name="name" />');
//     });
// });
