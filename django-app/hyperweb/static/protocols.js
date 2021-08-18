"use strict";

class Widget {}

class ValueInteger extends Widget {

}

// $("document").ready(function() {
//     document.querySelectorAll("[protocol='STRING']").forEach(function (widget) {

function bind_STRING() {
    $("[protocol='STRING']").each(function (i, widget) {
        //let view  = $('#view', this); //widget.find("#view");
        //let edit  = $('#edit', this); //widget.find("#edit");
        //let focus = $('.focus', edit); //edit.find(".focus");
        let view  = widget.querySelector("#view");
        let edit  = widget.querySelector("#edit");
        let focus = edit.querySelector(".focus");       // the element that should receive focus after form activation; can be missing

        function show_edit() {
            //console.log('in show_edit()');
            view.style.display = 'none';
            edit.style.display = 'block';
            if (focus) { focus.focus(); }
        }

        function hide_edit() {
            //widget.pro.set_preview();
            edit.style.display = 'none';
            view.style.display = 'block';
        }

        //view.on('dblclick', show_edit);
        //edit.on('focusout', hide_edit);
        view.addEventListener('dblclick', show_edit);
        edit.addEventListener('focusout', hide_edit);

        //edit.querySelectorAll('*').forEach(node => node.addEventListener('blur', hide_edit));
    });
}

// document ready
$(function() {
    bind_STRING();
});

// $("document").ready(function () {
//
//     $('[protocol="STRING"] #view').dblclick(function () {
//         let value = $(this).html();
//
//         $(this).html('<input type="text" value="' + thisVal + '" name="name" />');
//     });
// });
