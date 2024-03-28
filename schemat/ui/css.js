import {assert, print, tryimport} from '../common/utils.js'


let peg = await tryimport('pegjs', 'default')
let cssValidator = await tryimport('csstree-validator')


/**********************************************************************************************************************
 **
 **  CSS UTILITIES
 **
 */

export function compact_css(css) {
    /* Remove comments and merge whitespace (including newlines) inside CSS code. */

    let compacted = css.replace(/\/\*[\s\S]*?\*\//g, '')                        // remove comments

    compacted = compacted.split(/(['"])(?:(?=(\\?))\2.)*?\1/)                           // avoid compacting whitespace inside quotes
        .map((chunk, index) => index % 2 === 0 ? chunk.replace(/\s+/g, ' ') : chunk     // compact only outside quotes
    ).join('')

    compacted = compacted.replace(/\{\s+/g, '{').replace(/\s+\}/g, '}')         // remove spaces after "{" and before "}"

    return compacted.trim()
}


/**********************************************************************************************************************
 **
 **  CSS SCOPING (custom solution)
 **
 */

export function interpolate(strings, values) {
    /* Concatenate `strings` with `values` inserted between each pair of neighboring strings, for tagged templates.
       Both arguments are arrays; `strings` must be +1 longer than `values`.
     */
    assert(strings.length === values.length + 1)
    values.push('')
    let out = ''
    strings.forEach((s, i) => {out += s + values[i]})
    return out
}

function css(selector, stylesheet) {
    /* Replace every occurence of '&` in a `stylesheet` string with `selector`.
       `selector` is a string, or an object whose own properties are substrings to be replaced
       instead of '&' and their substitutions: {SYMBOL: substitution, ...}
       Can be called as a partial function that receives a tagged template:  css(selector)`stylesheet...`
     */
    if (stylesheet === undefined)              // return a partial function if `stylesheet` is missing
        return (sheet, ...values) => css(selector, typeof sheet === 'string' ? sheet : interpolate(sheet, values))

    if (typeof selector === 'string')
        selector = {'&': selector}

    for (const [symbol, insert] of Object.entries(selector))
        stylesheet = stylesheet.replaceAll(symbol, insert)

    return stylesheet
    // return stylesheet.replaceAll(symbol, selector)
}

export function cssPrepend(scope, css) {
    /* Prepend a `scope` string and a space to all css selectors in `css`.
       Also, drop comments, drop empty lines, and trim whitespace in each line.
       Rules inside @media {...} and @charset {...} are correctly prepended, too.
       Can be called as a 2nd-order function:
          cssPrepend(scope)(css)   OR
          cssPrepend(scope)`css`

       WARNING: this function is only slightly tested, watch out for corner cases.
       In particular, it may work incorrectly with some "at-rules" other than @media:
       https://developer.mozilla.org/en-US/docs/Web/CSS/At-rule

       Inspired by: https://stackoverflow.com/a/54077142/1202674
     */

    if (css === undefined)              // return a partial function if `css` is missing
        return (css, ...values) => cssPrepend(scope, typeof css === 'string' ? css : interpolate(css, values))

    if (!css || !css.trim()) return ''                                  // empty `css`? return empty string

    if (cssValidator) {
        let errors = cssValidator.validate(css)
        if (errors && errors.length) throw new Error(`invalid CSS snippet: ${errors}\n${css.trimEnd()}`)
    }

    css = css.replace(/\/\*(?:(?!\*\/)[\s\S])*\*\/|[\r\t]+/g, '')       // remove comments and some whitespace
    css = css.replace(/(\s*\n\s*)/g,'\n').replace(/(^\s+|\s+$)/g,'')    // trim leading/trailing whitespace in each line
    css = css.replace(/}(\s*)@/g, '}@')                                 // make sure `next` will not target a space
    css = css.replace(/}(\s*)}/g, '}}')

    if (!scope) return css                  // if `scope` is missing stay with compaction only: trimming lines etc.
    scope += ' '                            // make sure `scope` will not get concatenated with the original selector

    let char, next, media, block, pos = 0

    let [RULE, NESTED, BLOCK, MEDIA] = [1,2,3,4]

    while (pos < css.length-2) {                                        // scan all characters of `css`, one by one
        char = css[pos]
        next = css[++pos]

        if (char === '@' && next !== 'f') { assert(!block); media = true }
        if (!media && char === '{') block = true
        if ( block && char === '}') block = false

        // a css rule ends here? skip the terminating character and spaces, then insert the `scope`
        if (!block && next !== '@' && next !== '}' &&
            (char === '}' || char === ',' || ((char === '{' || char === ';') && media)))
        {
            while(next === ' ' || next === '\n') next = css[++pos]
            css = css.slice(0, pos) + scope + css.slice(pos)
            pos += scope.length
            media = false
        }
    }

    // prefix the first select if it is not `@media` and if it is not yet prefixed
    if (css.indexOf(scope) !== 0 && css.indexOf('@') !== 0) css = scope + css

    return css
}


// The grammar below is written in PEG.js language:   https://pegjs.org/documentation
//     Online PEG.js editor:                          https://pegjs.org/online
//     CSS Grammar Spec:                              https://www.w3.org/TR/CSS21/grammar.html

const _cssPrepend_grammar =
    `
    { let prefix = options.scope + ' ' }
    
    stylesheet = list:ruleset* _    { return list.join('\\n') }
    ruleset    = head:selector tail:(sep selector)* '{' body: [^}]* '}' nl
                 { return tail.reduce((res,t) => res+t[0]+t[1], head) + '{' + body.join('') + '}' }
                 
    // only top-level selectors are detected, while nested ones in :is :not etc. are treated as plain text (not prepended)
    selector = [^,{]+                  { return prefix + text() }
    
    sep = _','_                        { return text() }
    nl "newlines"  = ([ \\t]*'\\n')*   { return text() }
    _ "whitespace" = [ \\t\\n\\r]*     { return text() }
    `
let _cssPrepend_parser = peg ? peg.generate(_cssPrepend_grammar) : undefined

function cssPrepend__(scope, css) {
    /* Prepend a `scope` string and a space to all css selectors in `css`.
       Also, drop comments and empty lines. Can only be called server-side.

       Can be called as a 2nd-order function:
          cssPrepend(scope)(css)   OR
          cssPrepend(scope)`css`

       WARNING: The grammar is simplified and requires further development.
       The function may incorrectly handle advanced cases, like some "at-rules":
       https://developer.mozilla.org/en-US/docs/Web/CSS/At-rule
     */

    if (css === undefined)              // return a partial function if `css` is missing
        return (css, ...values) => cssPrepend(scope, typeof css === 'string' ? css : interpolate(css, values))

    if (!peg) throw new Error('pegjs module is missing; cssPrepend() is a server-side only function and cannot be called client-side')
    if (!css || !css.trim()) return ''      // empty `css`? return empty string
    if (!scope) return css                  // no `scope` defined? return `css` without changes

    css = css.replace(/\/\*(?:(?!\*\/)[\s\S])*\*\//g, '')       // remove comments

    if (cssValidator) {
        let errors = cssValidator.validate(css)
        if (errors && errors.length) throw new Error(`invalid CSS snippet:\n${css.trimEnd()}\nerrors: ${errors}`)
    }

    return _cssPrepend_parser.parse(css, {scope})
}



/**********************************************************************************************************************
 **
 **  TESTS
 **
 */

// // cssPrepend() tests:
// print(cssPrepend('.page', 'div { width: 100%; }   '), '\n')
// print(cssPrepend('.page', 'div, p:hover,i::after,ul { width: 100%; }'), '\n')
// print(cssPrepend('.page', 'div { width: 100%; } /* long \n\n comment */  \n\n  p {}    a{}  \n'), '\n')
// print(cssPrepend('.page', '@charset "utf-8"; div { width: 100%; }'), '\n')
// print(cssPrepend('.page', '@media only screen { div { width: 100%; } p { width: 1.2rem; } } @media only print { p { width: 1.2rem; } } div { height: 100%; font-family: "Arial", Times; }'), '\n')
// print(cssPrepend('.page', '@font-face { font-family: "Open Sans"; src: url("/fonts/OpenSans-Regular-webfont.woff2") format("woff2"); } div { width: 100%; }'), '\n')
// print(cssPrepend('.page', ':is(.up,.down)  { font-size: 0.8em; } '), '\n')

