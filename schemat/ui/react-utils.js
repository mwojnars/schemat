import { assert, print, T } from '../common/utils.js'
import { NotLoaded } from '../common/errors.js'
import { React, ReactDOM } from './resources.js'
export { React, ReactDOM }


/**********************************************************************************************************************
 **
 **  UNICODE
 **
 */

// a bunch of useful Unicode characters for use on web pages;
// can be referred to by their names or copy-pasted directly from here

export const CHAR_ARROW_R  =  "»"
export const CHAR_ARROW_L  =  "«"
export const CHAR_DOT      =  "•"

// export const NBSP       = '\u00A0'       -- defined down below, plain character equivalent of &nbsp;


/**********************************************************************************************************************
 **
 **  REACT Helper Functions
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
export const TEMPLATE = _e('template')

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

export function delayed_render(value, deps = [], empty = undefined) {
    /* Delayed React rendering for async values. If `value` is a Promise, return null on initial rendering attempt,
       then asynchronously await the value and request re-rendering to return the final value.
       NOTE: during SSR, re-rendering is NOT executed and so the server-side output contains nulls instead of the final values.
     */

    if (!T.isPromise(value)) return value

    const [output, setOutput] = useState(empty)
    useEffect(() => { value.then(v => setOutput(v)) }, deps)
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
    /* A hook that returns a function, assert_loaded(item), that checks whether an `item` is already loaded, and if not,
       schedules its loading to be executed after the current render completes, then requests re-rendering.
       If raise=false, assert_loaded(item) returns true if the `item` is loaded, false otherwise;
       if raise=true, an NotLoaded exception is raised in the latter case. The assert_loaded() function
       can be called multiple times during a single render: with the same or different item as an argument.
     */
    let [missingItems, setMissingItems] = useState([])

    useEffect(async () => {
        if (!missingItems.length) return
        for (let item of missingItems) await item.load()        // TODO: use batch loading of all items at once to reduce I/O
        setMissingItems([])
    }, [missingItems])

    function assert_loaded(item) {
        if (item.is_loaded()) return true
        if (!missingItems.includes(item))
            setMissingItems(prev => [...prev, item])
        if (raise) throw new NotLoaded()
        return false
    }
    return assert_loaded
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
                if (item.is_loaded()) return true
                if (!this.state.missingItems.includes(item))
                    setTimeout(() => this.setState((prev) => ({missingItems: [...prev.missingItems, item]})))
                    // NOTE: setState() calls must be delayed until after render(), otherwise a React warning is produced:
                    // Cannot update during an existing state transition (such as within `render`). Render methods should be a pure function of props and state.
                if (config.raise) throw new NotLoaded()
                return false
            }
            return e(classComponent, {loaded, ...this.props})
        }
    }

