/*
    Standard file transforms to be applied while serving web requests.
 */

import postcss from "postcss"
import postcssImport from "postcss-import"
import postcssNested from "postcss-nested"
import postcssMixins from "postcss-mixins"
import postcssSimpleVars from "postcss-simple-vars"
import postcssCustomProperties from "postcss-custom-properties"


function postcssScoping() {
    return {
        postcssPlugin: "scoping-plugin",
        Root(root) { processNode(root) }
    }
    
    function processNode(node, widget = null, scope_char = "|") {
        /* Recursively process the `node` and its descendants to replace the scoping symbol, "|", in each rule with
           `:not(.after-${widget} *)` qualifier to protect inner widgets from being spoiled by the outer widget's style.
           Update the `widget` name along the way to reflect the class name of the most deeply nested parent.

           The `.after-${widget}` class name should be added to the inner widgets' container elements in the HTML.
           Typically, this plugin should be combined with the `postcss-nested` plugin to handle nested rules correctly,
           and the latter should be placed AFTER this plugin in the list of PostCSS plugins.
         */

        if (node.type === "rule" && widget)
            node.selector = node.selector.replace(scope_char, `:not(.after-${widget} *)`)

        if (node.type === "rule" && node.selector.startsWith("."))
            widget = node.selector.slice(1).split(" ")[0].split(":")[0]

        for (let child of node.nodes || [])
            processNode(child, widget)
    }
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
