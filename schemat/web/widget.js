import { T, assert, print, tryimport, dedentFull } from '../common/utils.js'
import { e, cssPrepend, interpolate, DIV } from './react-utils.js'
import { React, Resources } from './resources.js'

let csso = await tryimport('csso')


/**********************************************************************************************************************
 **
 **  ASSETS & WIDGET
 **
 */

export class Assets {
    /* Collection of assets and CSS styles that are appended one by one with addStyle() or addAsset(),
       and then deduplicated (!) and merged to a single HTML snippet in display().
     */
    assets = new Set()
    styles = new Set()

    addStyle(st)    { if (st && st.trim()) this.styles.add(st.trim()) }
    addAsset(asset) {
        /* `asset` can be a plain string to be inserted in the <head> section, or a list of assets,
           or an object with .__assets__ or .assets property. The assets can be nested. */
        if (!asset) return
        if (T.isArray(asset))
            for (let a of asset) this.addAsset(a)

        else if (typeof asset !== 'string') {
            if (asset.__assets__ !== undefined)  asset = asset.__assets__
            else if (asset.assets !== undefined) asset = asset.assets
            else throw new Error(`missing .__assets__ or .assets in ${asset}`)
            this.addAsset(asset)            // `asset` may contain nested objects with .__assets__/assets properties
        }
        else if (asset && asset.trim()) this.assets.add(asset.trim())
    }

    renderAll(mini)     { return `${this._allAssets()}\n${this.renderStyles(mini)}` }
    renderStyles(mini)  { return this.styles.size ? `<style>\n${this._allStyles(mini)}\n</style>` : '' }

    _allAssets()        { return [...this.assets].join('\n') }
    _allStyles(mini = false) {
        let css = [...this.styles].join('\n')
        return mini && csso ? csso.minify(css).css : css
    }
}


/**********************************************************************************************************************/

export class Component extends React.Component {
    /* A React component with an API for defining and collecting dependencies (assets) and CSS styles.
       A Component subclass itself can be listed as a dependency (in .__assets__ or .assets) of another object.
     */
    static SCOPE_PROLOG() { return  `in-${this.scope}` }
    static SCOPE_EPILOG() { return `out-${this.scope}` }

    static scope        // unique name of this component for the purpose of reliable modular CSS scoping in safeCSS();
                        // NOTE: whenever a `scope` is defined for a subclass, the element returned by render() is wrapped up
                        // in a container of a proper css class - see _wrap() and _renderReplacement_()

    static assets       // list of assets this widget depends on; each asset should be an object with .__assets__ or .assets
                        // property defined, or a Component, or a plain html string to be pasted into the <head> section of a page

    static style() {
        /* Override in subclasses to provide CSS styles that will be included (deduplicated) in a page along with the widget. */
    }

    constructor(props) {
        super(props)
        if (this.constructor.scope) {
            this._renderOriginal_ = this.render.bind(this)
            this.render = this._renderReplacement_.bind(this)
        }
    }

    static collect(assets) {
        /* Walk through a prototype chain of `this` (a subclass) to collect .style() and .assets
           of all base classes into an Assets() object. */
        for (let proto of this._prototypes()) {
            let props = Object.keys(proto)
            if (props.includes('style'))  assets.addStyle(proto.style())
            if (props.includes('assets')) assets.addAsset(proto.assets)
        }
    }
    static _prototypes() {
        /* Array of all prototypes of `this` from below `Component` (excluded) down to `this` (included), in top-down order. */
        if (this === Component) return []
        let proto = Object.getPrototypeOf(this)
        let chain = proto._prototypes()
        chain.push(this)
        return chain
    }

    _wrap(elem, prolog = true) {
        if (!this.constructor.scope) return elem
        let names = this._collectScopes(prolog)
        return DIV({className: names.join(' ')}, elem)
        // let name = (prolog ? this.constructor.SCOPE_PROLOG(scopes) : this.constructor.SCOPE_EPILOG(scopes))
        // return DIV({className: name}, elem)
    }

    _collectScopes(prolog = true) {
        /* Collect all distinct `scope` properties of this's class and its base classes,
           and then translate them into prolog/epilog class names. Return an array of names.
         */
        let names = []
        for (const proto of this.constructor._prototypes()) {
            if (!proto.scope) continue
            let name = (prolog ? proto.SCOPE_PROLOG() : proto.SCOPE_EPILOG())
            if (name && !names.includes(name)) names.push(name)
        }
        return names
    }

    embed(component, ...args) {
        /* Embed another React `component` (can be an element) into this one by wrapping it up
           in a "stop-at" <div> with an appropriate css class for modular scoping.
           Also, check if `this` declares the `component` in its assets and throw an exception if not (TODO).
           IMPORTANT: clients should always use this method instead of createElement() to insert Components into a document;
           the only exceptions are top-level Components, as they do not have parent scopes where to embed into,
           and the components that may include components of the same type (recursive inclusion, direct OR indirect!).
           Calling createElement() directly without embed() may result in `this` styles leaking down into the `component`.
         */
        // let embedStyle = T.pop(props, 'embedStyle')  // for styling the wrapper DIV, e.g., display:inline
        // let embedDisplay ...
        if (typeof component === 'function') component = e(component, ...args)      // convert a component (class/function) to an element
        return this._wrap(component, false)
    }
    _renderReplacement_() {
        /* Wrap up the element returned by this.render() in a <div> of an appropriate "start-at" css class(es).
           This method is assigned to this.render in the constuctor, so that subclasses can still
           override the render() as usual, but that React calls this wrapper instead.
         */
        let elem = this._renderOriginal_()
        if (elem === null || typeof elem === 'string') return elem
        return this._wrap(elem, true)
    }

    static safeCSS(params = {}, css) {
        /* Extend all the rules in  the `css` stylesheet with reliable modular scoping by a SCOPE_PROLOG() (from above)
           and a SCOPE_EPILOG() (from below) classes. The class must have a static `scope` attribute defined.

           Parameters:
           - params.stopper: a character or substring (default: '|') that marks the places in `css` where
                             the scope prolog should be inserted;
           - params.replace: a plain object (default: {}) whose own properties define key-value replacement rules,
                             of the form css.replaceAll(key, value); typically a key is a special character rarely
                             occuring in CSS, like '&' or '?'.

           WARNINGS:
           - when an original CSS rule ends with a pseudo-element, like ::before, ::after (or :before, :after), the epilog
             must be inserted *before* the pseudo-element and the stopper character must be placed accordingly;
           - the epilog-based scoping cannot be used for recursive components (containing nested copies of themselves,
             directly or indirectly), as the nested components would *not* receive their styling.
         */
        if (css === undefined)              // return a partial function if `css` is missing
            return (css, ...values) => this.safeCSS(params, typeof css === 'string' ? css : interpolate(css, values))

        if (!this.scope) return css
        let {stopper = '|', replace = {}} = params

        for (const [symbol, insert] of Object.entries(replace))
            css = css.replaceAll(symbol, insert)

        if (stopper) {
            let insert = `:not(.${this.SCOPE_EPILOG()} *)`      // exclude all DOM nodes located below the SCOPE_EPILOG() class
            css = css.replaceAll(stopper, insert)
        }

        return cssPrepend(`.${this.SCOPE_PROLOG()}`, css)
    }
}

export class Widget extends Component {}


/**********************************************************************************************************************
 **
 **  HTML COMPONENTS
 **
 */

export class Page {
    /* Collection of methods that together generate a complete HTML response for a particular URL endpoint.
       Most of the methods when called are bound to the item being rendered, not a Page instance.
       A Page is NOT a React component itself, but some part(s) of it (the body) can be React components.
       The base class takes care of inserting control code that loads initial items and maintains the link between
       the client and the server.
       Selected instance methods can be overriden by subclasses to customize all, or part, of page generation process.
     */

    // static page(item, request) { return new this().page(item, request) }        // page() can be called on a class or instance

    static page(item, request) {
        /* Generate an HTML page to be sent as a response to a GET request;
           fill the page with HTML contents rendered from a view() function (React functional component).
         */
        let proto  = this.prototype
        let title  = proto.title.call(item, request)
        let assets = proto.assets.call(item, request)
        let body   = proto.body.call(item, request)
        return proto.frame.call(item, {title, assets, body})
    }

    // page(item, request) {
    //     /* Generate an HTML page to be sent as a response to a GET request;
    //        fill the page with HTML contents rendered from a view function (React functional component).
    //        The `view` name should point to a method VIEW_{view} of the current Item's subclass.
    //      */
    //     let title  = this.title.call(item, request)
    //     let assets = this.assets.call(item, request)
    //     let body   = this.body.call(item, request)
    //     return this.frame.call(item, {title, assets, body})
    // }

    frame({title, assets, body}) {
        /* Here, `this` is bound to the item being rendered. */
        return dedentFull(`
            <!DOCTYPE html><html>
            <head>
                <title>${title}</title>
                ${assets}
            </head>`) +
            `<body>\n${body}\n</body></html>`
    }

    render(props, targetElement = null) {
        /* Render the view() into an HTMLElement (client-side) if `targetElement` is given,
           or to a string (server-side) otherwise. When rendering server-side, useEffect() & delayed_render() do NOT work,
           so only a part of the HTML output is actually rendered. For workaround, see:
            - https://github.com/kmoskwiak/useSSE  (useSSE, "use Server-Side Effect" hook)
            - https://medium.com/swlh/how-to-use-useeffect-on-server-side-654932c51b13
            - https://dev.to/kmoskwiak/my-approach-to-ssr-and-useeffect-discussion-k44
         */
        let {item} = props
        item.assert_loaded()
        if (!targetElement) print(`SSR render() of ID=${item._id_}`)
        let view = e(this.view.bind(item), props)
        return targetElement ? ReactDOM.render(view, targetElement) : ReactDOM.renderToString(view)
        // might use ReactDOM.hydrate() not render() in the future to avoid full re-render client-side ?? (but render() seems to perform hydration checks as well)
    }
}

// let _page_ = {
//     assets(request) { return `abc` },
//     title(request) {},
// }

export class ViewPage extends Page {
    /* A Page whose HTML body is rendered from a "view" component. Defaults are used for the remaining HTML code. */

    

}

export class Page_ {
    /* Container for a number of functions that together - after binding to an Item instance -
       can be used to generate the HTML contents of a web response page.
     */
    html        // static HTML code of the entire response, starting with DOCTYPE and <html> section
    head        // inner code of the html/meta section
    body        // inner code of the html/body section
}

export class View extends Page_ {
    /* A specialized container that provides individual functions for .
     */
    title
    assets
    view        // React functional component that renders the entire contents of the page
}


// export class Layout extends Component {
//     /* Takes a number of named blocks, e.g.: head, foot, main, side, ... and places them in predefined
//        positions on a page.
//      */
//     static defaultProps = {
//         blocks: {},             // named blocks, e.g.: head, foot, main, side ... to be placed on a page
//     }
//     render() {
//         let {blocks} = this.props
//     }
// }

