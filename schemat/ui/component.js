import { T, assert, print, tryimport } from '../common/utils.js'
import { cssPrepend } from './css.js'
import { e, DIV, TEMPLATE } from './react-utils.js'
import { React } from './resources.js'

let csso = await tryimport('csso')


/**********************************************************************************************************************
 **
 **  ASSETS
 **
 */

export class Assets {
    /* Collection of assets and CSS styles that are appended one by one with add_style() or add_asset(),
       and then deduplicated (!) and merged to a single HTML snippet in display().
     */
    assets = new Set()
    styles = new Set()

    add_style(st)    { if (st?.trim()) this.styles.add(st.trim()) }
    add_asset(asset) {
        /* `asset` can be a plain string to be inserted in the <head> section, or a list of assets,
           or an object with .assets property. The assets can be nested. */
        if (!asset) return
        if (T.isArray(asset))
            for (let a of asset) this.add_asset(a)

        else if (typeof asset !== 'string')
            this.add_asset(asset.assets)               // `asset` may contain nested objects with .assets properties

        else if (asset.trim()) this.assets.add(asset.trim())
    }

    render_all(mini)     { return `${this._all_assets()}\n${this.render_styles(mini)}` }
    render_styles(mini)  { return this.styles.size ? `<style>\n${this._all_styles(mini)}\n</style>` : '' }

    _all_assets()        { return [...this.assets].join('\n') }
    _all_styles(mini = false) {
        let css = [...this.styles].join('\n')
        return mini && csso ? csso.minify(css).css : css
    }
}


/**********************************************************************************************************************
 **
 **  CSS STYLE
 **
 */

export class Style {
    /* CSS styles that can be scoped exclusively to the part of DOM where the component is located.

       NOTE:
       - when an original CSS rule ends with a pseudo-element, like ::before, ::after (or :before, :after),
         the `stopper` character must be placed *before* the pseudo-element, not after it (!)
       - epilog must not be used for recursive components (containing nested copies of themselves,
         directly or indirectly), because the subcomponents of the same type would *not* receive their styling then.
     */

    scope               // name of the CSS scope; for building names of "prolog" and "epilog" CSS classes
    opts = {
        stopper: '|',   // character or substring that marks the places in `css` where the scope prolog should be inserted
        replace: {},    // key-value replacement rules for: css.replaceAll(key, value); typically a key is a special character rarely occurring in CSS (&, ?)
    }

    _class_prolog       // name of the CSS class for the prolog part of the scope
    _class_epilog       // name of the CSS class for the epilog part of the scope

    _css_raw            // original block of CSS before scoping and replacements
    css                 // final CSS with the scope and replacements applied


    constructor(scope, styled_class, opts = {}, css = '') {
        /* `styled_class` is the owner class of this Style object and should be derived from the Styled() mixin,
            so that styled_class.style==this after the constructor completes. The `scope` can be null/empty (no scoping).
         */
        this.opts = {...this.opts, ...opts}
        this.scope = scope
        this._css_raw = css

        if (scope) {
            this._class_prolog = `in-${scope}`
            this._class_epilog = `out-${scope}`
        }

        let prototypes = T.getPrototypes(styled_class).slice(1)
        let styles = [this, ...prototypes.map(cls => cls.style)].filter(stl => Boolean(stl?.scope))

        // collect all scoping classes from the prototype chain of `styled_class`
        this._all_classes_prolog = [...new Set(styles.map(stl => stl._class_prolog))].sort().join(' ')
        this._all_classes_epilog = [...new Set(styles.map(stl => stl._class_epilog))].sort().join(' ')

        for (const [symbol, sub] of Object.entries(this.opts.replace))
            css = css.replaceAll(symbol, sub)

        this.css = this._safe_css(css)
    }

    _safe_css(css) {
        /* Update the rules in `this.css` stylesheet by scoping them with special CSS classes:
           <_class_prolog> (from above) and <_class_epilog> (from below).
         */
        if (!this.scope) return css

        let stopper = this.opts.stopper
        if (stopper) {
            let sub = `:not(.${this._class_epilog} *)`      // exclude all DOM nodes located below the <_class_epilog> CSS class
            css = css.replaceAll(stopper, sub)
        }

        return cssPrepend(`.${this._class_prolog}`, css)
    }

    _wrap(elem, className) {
        if (!className || !elem || typeof elem === 'string') return elem
        return DIV({className}, elem)
    }

    add_prolog(elem)    { return this._wrap(elem, this._all_classes_prolog) }
    add_epilog(elem)    { return this._wrap(elem, this._all_classes_epilog) }
}


export const Styled = (baseclass) => class extends baseclass {
    /* A mixin for a View and Component classes that defines static `style` and `assets` properties and a method for collecting them. */

    static assets       // list of assets this widget depends on; each asset should be an object with .assets property,
                        // or a Component, or a plain html string to be pasted into the <head> section of a page

    static style        // a Style object that defines the CSS styles for this component, possibly scoped

    static collect(assets) {
        /* Walk through a prototype chain of `this` class to collect all .style's and .assets into an Assets object. */
        for (let cls of T.getPrototypes(this)) {
            assets.add_style(cls.style?.css)
            assets.add_asset(cls.assets)
        }
    }
}


/**********************************************************************************************************************
 **
 **  COMPONENT
 **
 */

export class Component extends Styled(React.Component) {
    /* A React component with scoped CSS styles through Styled() and dependencies (assets).
       A Component subclass itself can be listed as a dependency (in .assets) of another object.
     */

    // If shadow_dom=true, the component is rendered inside a "shadow DOM" that is separate from the main DOM.
    // This provides style encapsulation (CSS scoping) and prevents styles of different components from interfering.
    // HOWEVER, note that some styles of the parent DOM can still pass into the shadow DOM, like:
    // - inherited CSS properties: font-*, color, line-*, text-*, ...
    // - global styles and resets (*, body, html), which may influence the inherited styles
    // - css custom properties (variables)
    // - :host, :host(), ::slotted()

    shadow_dom = false

    constructor(props) {
        super(props)

        // for CSS scoping, replace this.render() with a wrapper that adds an extra DIV around the rendered element;
        // directly overriding render() is inconvenient, because subclasses could no longer define their own render() !!
        if (this.constructor.style) {
            this._render_original = this.render.bind(this)
            this.render = this._render_wrapped.bind(this)
        }

        // bind all the methods (own or inherited) that start with a capital letter, possibly prefixed by underscore(s)
        // - they are assumed to be React functional components
        for (let name of T.getAllPropertyNames(this.constructor.prototype))
            if (name.match(/^_*[A-Z]/) && typeof this[name] === 'function')
                this[name] = this[name].bind(this)

        this._root = React.createRef()
        this._shadow = null
    }

    componentDidMount()  { this._create_shadow() }

    _create_shadow() {
        if (!this.shadow_dom) return
        this._shadow = this._root.current.attachShadow({ mode: 'open' })        // attach shadow DOM
        this.forceUpdate()                                                      // force update to render the _portal()
    }

    _portal() {
        if (!this._shadow) return null
        let content = this._render_original()
        return ReactDOM.createPortal(content, this._shadow)
    }

    _render_wrapped() {
        /* Wrap up the element returned by this.render() in a <div> of an appropriate "prolog" CSS class(es) for style scoping.
           This method is assigned to `this.render` in the constructor, so that subclasses can still
           override the render() as usual, but React calls this wrapper instead.
         */
        if (!this.shadow_dom) {
            let content = this._render_original()
            return this.constructor.style.add_prolog(content)           // <div> wrapper applies a CSS class for style scoping
            // return this.shadow_dom ? TEMPLATE({shadowrootmode: 'open'}, div) : div      // render the component inside a shadow DOM if needed
        }

        if (typeof window === 'undefined') {                // server-side: content rendered inside a <template> tag
            let content = this._render_original()
            let template = TEMPLATE({shadowrootmode: 'open'}, content)
            return DIV(template)
        }
        else
            // client-side: initially render just the <div> container, shadow DOM content will be added in componentDidMount
            return DIV({ref: this._root}, this._portal())
    }

    embed(component, props = null) {
        /* Safely embed a React `component` (or element) inside this one by wrapping it up
           in an "epilog" <div> with an appropriate css class for modular scoping.
           Also, check if `this` declared the `component` in its assets and throw an exception if not (TODO).

           IMPORTANT: nested components should always be inserted into a page using this method, not createElement();
           calling createElement() directly may result in the styles of `this` leaking down into the `component`.
           The only exceptions are top-level Components and the components that may include components of the same type
           (recursive inclusion, direct OR indirect!).
         */
        // let embedStyle = T.pop(props, 'embedStyle')  // for styling the wrapper DIV, e.g., display:inline
        // let embedDisplay ...
        if (typeof component === 'function') component = e(component, props)        // convert a component (class/function) to an element if needed
        let style = this.constructor.style
        return style ? style.add_epilog(component) : component
    }
}
