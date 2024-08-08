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
        Root(root) {
            let currentWidgetName = null
            let nestedLevel = 0

            root.walkComments(comment => {
                const match = comment.text.match(/^\s*widget:\s*(\w+)\s*$/)
                if (match) currentWidgetName = match[1]
            })

            root.walk(node => {
                if (node.type === "rule") {
                    if (nestedLevel === 0 && node.selector.startsWith("."))
                        currentWidgetName = node.selector.slice(1)

                    if (currentWidgetName)
                        processRule(node, currentWidgetName)

                    nestedLevel++
                }
                else if (node.type === "decl")
                    nestedLevel = 0
            })
        }
    }

    function processRule(rule, widgetName) {
        let parts = rule.selector.split(",")

        parts = parts.map(part => {
            part = part.trim()

            if (part.includes("|"))
                part = part.replace("|", `:not(.after-${widgetName} *)`)

            if (!part.startsWith(`.${widgetName}`))
                part = `.${widgetName} ${part}`

            return part
        })

        rule.selector = parts.join(", ")
    }
}

async function processCss(css) {
    try {
        const result = await postcss([
            postcssImport(),
            postcssMixins(),
            postcssNested(),
            postcssSimpleVars(),
            postcssCustomProperties(),
            postcssScoping(),
        ]).process(css, { from: undefined })
        return result.css
    } catch (error) {
        console.error("CSS processing error:", error)
    }
}

// Example usage
const inputCss = `
/* widget: Widget1 */
.move|                        { margin-right: 10px; visibility: hidden; }
:is(.moveup,.movedown)|       { font-size: 0.8em; line-height: 1em; cursor: pointer; }
.moveup|::after               { content: "△"; }

.Widget2 {
    .move|                    { margin-left: 10px; visibility: visible; }
    :is(.moveup,.movedown)|   { font-size: 1em; line-height: 1.2em; }
    .movedown|::after         { content: "▽"; }
}
`

async function main() {
    const outputCss = await processCss(inputCss)
    console.log(outputCss)
}

main()
