import { assert, print, ItemNotLoaded } from './utils.js'


/**********************************************************************************************************************
 **
 **  CSS UTILITIES
 **
 */

function stringInterpolate(strings, values) {
    /* Concatenate `strings` with `values` inserted between each pair of neighboring strings, for tagged templates.
       Both arguments are arrays; `strings` must be +1 longer than `values`.
     */
    // assert(strings.length === values.length + 1)
    values.push('')
    let out = ''
    strings.forEach((s, i) => {out += s + values[i]})
    return out
}

function cssPrepend(scope, css) {
    /* Prepend a `scope` string and a space to all css selectors in `css`.
       Also, drop comments, trim whitespace in each line, join lines.
       Rules inside @media {...} and @charset {...} are correctly prepended, too.
       Can be called as a 2nd-order function:
          cssPrepend(scope)(css)   OR
          cssPrepend(scope)`css`

       WARNING: this function is only slightly tested, watch out for corner cases.
       Inspired by: https://stackoverflow.com/a/54077142/1202674
     */

    if (css === undefined)              // return a partial function if `css` is missing
        return (css, ...values) => cssPrepend(scope, typeof css === 'string' ? css : stringInterpolate(css, values))

    let scopeLen = scope.length, char, next, media, block, suffix, pos = 0
    scope += ' '            // make sure `scope` will not concatenate the selector

    css = css.replace(/\/\*(?:(?!\*\/)[\s\S])*\*\/|[\r\t]+/g, '')       // remove comments
    css = css.replace(/(\s*\n\s*)/g,'\n').replace(/(^\s+|\s+$)/g,'')     // trim leading/trailing whitespace in each line, join lines
    css = css.replace(/}(\s*)@/g, '}@')                     // make sure `next` will not target a space
    css = css.replace(/}(\s*)}/g, '}}')

    while (pos < css.length-2) {                            // scan all characters of `css`, one by one
        char = css[pos]
        next = css[++pos]

        if (char === '@' && next !== 'f') media = true
        if (!media && char === '{') block = true
        if ( block && char === '}') block = false

        // a rule ends here? skip the terminating character and spaces, then insert the `scope`
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


/**********************************************************************************************************************
 **
 **  REACT UTILITIES
 **
 */

let React    = globalThis.React                             // on client...
let ReactDOM = globalThis.ReactDOM
// let CSSTransition = globalThis.CSSTransition

if (!React) {
    React    = (await import("react")).default              // on server...
    ReactDOM = (await import("react-dom/server.js")).default
    // CSSTransition = (await import("react-transition-group")).CSSTransition
}

export { React, ReactDOM }
export const e = React.createElement

function _e(name) {
    return (...args) =>
        args[0]?.$$typeof || typeof args[0] === 'string' ?      // if the 1st arg is a React element or string, no props are present
            e(name, null, ...args) :
            e(name, args[0], ...args.slice(1))
}

export const NBSP = '\u00A0'       // plain character equivalent of &nbsp; entity
export const A = _e('a')
export const B = _e('b')
export const I = _e('i')
export const P = _e('p')
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
export const BUTTON = _e('button')
export const TEXTAREA = _e('textarea')
export const FIELDSET = _e('fieldset')

export const HTML = (html) => {
    return {dangerouslySetInnerHTML: {__html: html}}
}

export const FRAGMENT = (...nodes) => e(React.Fragment, {}, ...nodes)

export const createRef = React.createRef
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
        if (item.loaded) return true
        if (!missingItems.includes(item))
            setMissingItems(prev => [...prev, item])
        if (raise) throw new ItemNotLoaded()
        return false
    }
    return assertLoaded
}

export const ItemLoadingHOC = (component, config = {raise: false, class: React.Component}) =>
    /* ItemLoadingHOC() is a counterpart of useItemLoading() but for class components */
    class ItemLoadingWrapper extends (config.class) {
        constructor(props) {
            super(props)
            this.state = {missingItems: []}
        }
        async componentDidMount()  { return this._load() }
        async componentDidUpdate() { return this._load() }
        async _load() {
            if (!this.state.missingItems.length) return
            for (let item of this.state.missingItems) await item.load()        // TODO: use batch loading of all items at once to reduce I/O
            this.setState({missingItems: []})
        }
        render() {
            const loaded = (item) => {
                if (item.loaded) return true
                if (!this.state.missingItems.includes(item))
                    setTimeout(() => this.setState((prev) => ({missingItems: [...prev.missingItems, item]})))
                    // NOTE: setState() calls must be delayed until after render(), otherwise a React warning is produced:
                    // Cannot update during an existing state transition (such as within `render`). Render methods should be a pure function of props and state.
                if (config.raise) throw new ItemNotLoaded()
                return false
            }
            return e(component, {loaded, ...this.props})
        }
    }

/*************************************************************************************************/

export async function fetchJson(url, data, params) {
    /* Stringify and send the `data` object as JSON through POST (if present), or request a `url` through GET.
       Return the received JSON response parsed into an object.
     */
    params = params ? {...params} : {}
    if (data !== undefined) {
        params.body = JSON.stringify(data)
        if (!params.method) params.method = 'POST'
        if (!params.headers) params.headers = {}
        if (!params.headers['Content-Type']) params.headers['Content-Type'] = 'application/json; charset=utf-8'
    }
    return fetch(url, params)
    // let response = await fetch(url, params)
    // return response.json()
}


/**********************************************************************************************************************
 **
 **  TESTS
 **
 */

// cssPrepend() tests:
print(cssPrepend('.page', 'div { width: 100%; }'), '\n')
print(cssPrepend('.page', 'div { width: 100%; } /* long \n\n comment */  \n\n  p {}    a{}  \n'), '\n')
print(cssPrepend('.page', '@charset "utf-8"; div { width: 100%; }'), '\n')
print(cssPrepend('.page', '@media only screen { div { width: 100%; } p { size: 1.2rem; } } @media only print { p { size: 1.2rem; } } div { height: 100%; font-family: "Arial", Times; }'), '\n')
print(cssPrepend('.page', '@font-face { font-family: "Open Sans"; src: url("/fonts/OpenSans-Regular-webfont.woff2") format("woff2"); } div { width: 100%; }'), '\n')

