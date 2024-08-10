/*
    Standard file transforms to be applied while serving web requests.
 */


import postcss from "postcss"
import postcssImport from "postcss-import"
import postcssNested from "postcss-nested"
import postcssMixins from "postcss-mixins"
import postcssSimpleVars from "postcss-simple-vars"
import postcssCustomProperties from "postcss-custom-properties"

import {print} from "../common/utils.js"


function postcssScoping() {
    return {
        postcssPlugin: "scope-beyond-plugin",
        Root(root) {
            return processNode(root)
        }

        // Root(root) {
        //     let widget = null
        //     let stack = []
        //     let top = () => stack[stack.length - 1]
        //
        //     // root.walkComments(comment => {
        //     //     const match = comment.text.match(/^\s*widget:\s*(\w+)\s*$/)
        //     //     if (match) widget = match[1]
        //     // })
        //
        //     root.walk(node => {
        //         // if (node.type === "rule") {
        //         //     if (level === 0 && node.selector.startsWith("."))
        //         //         widget = node.selector.slice(1)
        //         //
        //         //     else if (widget)
        //         //         processRule(node, widget)
        //         //
        //         //     level++
        //         // }
        //         // else if (node.type === "decl")
        //         //     level = 0
        //
        //         if (node.type === "rule") {
        //             if (stack.length === 0 && node.selector.startsWith("."))    // if top-level rule, update current widget
        //                 widget = node.selector.slice(1)
        //
        //             if (widget) processRule(node, widget)
        //
        //             stack.push(node)                                // push current node to stack to increase nesting level
        //             print('pushed:', node.selector, stack.length)
        //         }
        //         else if (node.type === "decl")                      // do nothing on declaration, but ensure we manage the stack correctly
        //             while (stack.length && stack[stack.length - 1].type !== "rule")
        //                 stack.pop()
        //
        //         if (node.type === "rule") {                         // when a node is fully processed, we pop it from the stack
        //             stack.pop()
        //             if (stack.length === 0)                         // if stack becomes empty, reset widget
        //                 widget = null
        //             else                                            // update widget based on the top of the stack
        //                 widget = top().selector.slice(1)
        //         }
        //     })
        // }
    }
    
    function processNode(node, widget = null, scope_char = "|") {
        /* Recursively process the `node` and its descendants to replace the scoping symbol, "|", in each rule with
           `:not(.after-${widget} *)` qualifier to protect inner widgets from being spoiled by an outer widget's style.
           Update the `widget` name along the way.

           The `.after-${widget}` class name should be added to the inner widgets' container elements in the HTML.
           Typically, this plugin should be combined with the `postcss-nested` plugin to handle nested rules correctly,
           and the latter should be placed AFTER this plugin in the list of PostCSS plugins.
         */

        if (node.type === "rule" && widget)
            node.selector = node.selector.replace(scope_char, `:not(.after-${widget} *)`)

        if (node.type === "rule" && node.selector.startsWith(".")) {
            widget = node.selector.slice(1).split(" ")[0].split(":")[0]
            print("widget:", widget)
        }

        for (let child of node.nodes || [])
            processNode(child, widget)
    }

    // function processRule(rule, widget, scope_char) {
    //     let parts = rule.selector.split(",")
    //
    //     parts = parts.map(part => {
    //         part = part.trim()
    //
    //         // add the "after-widget" protection to avoid spoiling inner widgets with this widget's style;
    //         // IMPORTANT: this prevents the recursive embedding of the widget in itself!
    //         if (part.includes(scope_char))
    //             part = part.replace(scope_char, `:not(.after-${widget} *)`)
    //
    //         // NOTE: the code below may only be needed when postcssNested() plugin is NOT enabled
    //         // if (!part.startsWith(`.${widget}`))
    //         //     part = `.${widget} ${part}`
    //
    //         return part
    //     })
    //
    //     rule.selector = parts.join(", ")
    // }
}

export async function transform_postcss(css, filepath) {
    const result = await postcss([
        postcssScoping(),
        postcssImport(),
        postcssMixins(),
        postcssNested(),
        postcssSimpleVars(),
        postcssCustomProperties(),
    ]).process(css, {from: filepath})
    return result.css
}

// // Example usage
// const inputCss = `
// /* widget: Widget1 */
// .move|                        { margin-right: 10px; visibility: hidden; }
// :is(.moveup,.movedown)|       { font-size: 0.8em; line-height: 1em; cursor: pointer; }
// .moveup|::after               { content: "△"; }
//
// .Widget2 {
//     .move|                    { margin-left: 10px; visibility: visible; }
//     :is(.moveup,.movedown)|   { font-size: 1em; line-height: 1.2em; }
//     .movedown|::after         { content: "▽"; }
// }
// `
//
// async function main() {
//     const outputCss = await processCss(inputCss)
//     console.log(outputCss)
// }
//
// main()
