import { assert, print, tryimport, T } from './utils.js'
import { ItemNotLoaded } from './errors.js'
import { React, ReactDOM } from './resources.js'
export { React, ReactDOM }

let peg = await tryimport('pegjs', 'default')
let cssValidator = await tryimport('csstree-validator')


/**********************************************************************************************************************
 **
 **  CSS UTILITIES
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

export function css(selector, stylesheet) {
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

export function cssPrepend__(scope, css) {
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
 **  REACT UTILITIES
 **
 */

export function cl(...classes) { return {className: classes.join(' ')} }    // shorthand for setting css classes of a React component
export function st(styles)     { return {style: styles} }                   // shorthand for setting a `style` of a React component

function _sortReactArgs(args) {
    /* Unpack, sort, and merge the arguments for React.createElement().
       All plain objects in `args` (not strings, not arrays, not React elements) are treated as props and merged.
       The `style` and `className` props are merged separately to allow merging of individual class/style entries.
       Arrays are concatenated to a list of elements (but no additional preprocessing of elements).
     */
    let props = {}, styles = {}, classes = '', elements = [], style, className
    for (let arg of args)
        if (arg === undefined || arg === false) {}
        else if (T.isArray(arg)) { elements.push(...arg) }      // arrays get unpacked
        else if (arg && !arg.$$typeof && typeof arg !== 'string') {
            ({style, className, ...arg} = arg)                  // pull out the `style` and `className` property as they need special handling
            if (arg)   props  = {...props, ...arg}
            if (style) styles = {...styles, ...style}
            if (className) classes += ' ' + className
        } else elements.push(arg)

    classes = classes.trim()
    if (classes) props.className = classes
    if (T.notEmpty(styles)) props.style = styles
    return [props, elements]
}

export const e = (type, ...args) => {
    /* Shorthand for React.createElement(), with the extension that props can be placed at an arbitrary position in `args`,
       and can be split into multiple objects that will be merged automatically.
     */
    let [props, elements] = _sortReactArgs(args)
    return React.createElement(type, T.notEmpty(props) ? props : null, ...elements)
}

function _e(name) {
    /* Return a function that will create React elements for an HTML tag, `name`. */
    return (...args) => e(name, ...args)
}


export const NBSP = '\u00A0'       // plain character equivalent of &nbsp; entity
export const A = _e('a')
export const B = _e('b')
export const I = _e('i')
export const P = _e('p')
export const BR = _e('br')
export const H1 = _e('h1')
export const H2 = _e('h2')
export const H3 = _e('h3')
export const H4 = _e('h4')
export const H5 = _e('h5')
export const DIV = _e('div')
export const PRE = _e('pre')
export const SPAN = _e('span')
export const STYLE = _e('style')
export const TABLE = _e('table')
export const THEAD = _e('thead')
export const TBODY = _e('tbody')
export const TFOOT = _e('tfoot')
export const TH = _e('th')
export const TR = _e('tr')
export const TD = _e('td')
export const FORM = _e('form')
export const INPUT = _e('input')
export const LABEL = _e('label')
export const SELECT = _e('select')
export const OPTION = _e('option')
export const BUTTON = _e('button')
export const TEXTAREA = _e('textarea')
export const FIELDSET = _e('fieldset')
export const BLOCKQUOTE = _e('blockquote')

export const FLEX  = (...args) => DIV(st({display: 'flex'}), ...args)        // shorthand for DIV(...) with display=flex
// export const FLEX = (...args) => DIV(st({display: 'flex'}), ...args)        // shorthand for DIV(...) with display=flex

export const HTML = (html) => {
    return {dangerouslySetInnerHTML: {__html: html}}
}

export const FRAGMENT = (...nodes) => e(React.Fragment, {}, ...nodes)

export const createRef = React.createRef
export const createContext = React.createContext
export const useContext = React.useContext
export const useEffect = React.useEffect
export const useState = React.useState
export const useRef = React.useRef

/**********************************************************************************************************************/

export function delayed_render(async_fun, deps = [], empty = undefined) {
    /* Delayed rendering: returns null on initial rendering attempt, then asynchronously calculates
       rendering output through async_fun() and requests re-rendering to return the final result. */

    const [output, setOutput] = useState(empty)
    useEffect(async () => setOutput(await async_fun()), deps)
    return (output === empty) ? null : output

    // DRAFT to allow deps=null without infinite re-rendering loop:
    // const [output, setOutput] = useState(empty)
    // const updating = useRef(false)
    //
    // if (!updating.current) {
    //     useEffect(async () => {
    //         updating.current = true
    //         setOutput(await async_fun())
    //     }, deps)
    // } else
    //     updating.current = false
    //
    // return (output === empty) ? null : output
}

export function useItemLoading(raise = false) {
    /* A hook that returns a function, assertLoaded(item), that checks whether an `item` is already loaded, and if not,
       schedules its loading to be executed after the current render completes, then requests re-rendering.
       If raise=false, assertLoaded(item) returns true if the `item` is loaded, false otherwise;
       if raise=true, an ItemNotLoaded exception is raised in the latter case. The assertLoaded() function
       can be called multiple times during a single render: with the same or different item as an argument.
     */
    let [missingItems, setMissingItems] = useState([])

    useEffect(async () => {
        if (!missingItems.length) return
        for (let item of missingItems) await item.load()        // TODO: use batch loading of all items at once to reduce I/O
        setMissingItems([])
    }, [missingItems])

    function assertLoaded(item) {
        if (item.isLoaded) return true
        if (!missingItems.includes(item))
            setMissingItems(prev => [...prev, item])
        if (raise) throw new ItemNotLoaded()
        return false
    }
    return assertLoaded
}

export const ItemLoadingHOC = (classComponent, config = {raise: false}) =>
    /* Create a subclass of `classComponent` that tracks missing (unloaded) items during render() and loads them in .componentDid*().
       ItemLoadingHOC() does a similar thing as useItemLoading(), but for class components.
     */
    class ItemLoadingWrapper extends classComponent {
        constructor(props) {
            super(props)
            assert(this.state.missingItems === undefined)
            this.state = {...this.state, missingItems: []}
        }
        async componentDidMount()  { if(super.componentDidMount)  await super.componentDidMount();  return this._load() }
        async componentDidUpdate() { if(super.componentDidUpdate) await super.componentDidUpdate(); return this._load() }
        async _load() {
            if (!this.state.missingItems.length) return
            for (let item of this.state.missingItems) await item.load()        // TODO: use batch loading of all items at once to reduce I/O
            this.setState({missingItems: []})
        }
        render() {
            const loaded = (item) => {
                if (item.isLoaded) return true
                if (!this.state.missingItems.includes(item))
                    setTimeout(() => this.setState((prev) => ({missingItems: [...prev.missingItems, item]})))
                    // NOTE: setState() calls must be delayed until after render(), otherwise a React warning is produced:
                    // Cannot update during an existing state transition (such as within `render`). Render methods should be a pure function of props and state.
                if (config.raise) throw new ItemNotLoaded()
                return false
            }
            return e(classComponent, {loaded, ...this.props})
        }
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

