import { React, MaterialUI, styled } from './resources.js'
import { e, A, B, I, P, PRE, DIV, SPAN, STYLE, INPUT, TEXTAREA, TABLE, TH, TR, TD, TBODY, FLEX, FRAGMENT, HTML, cl, st } from './react-utils.js'
import { css, cssPrepend, interpolate, createRef, useState, useItemLoading, delayed_render, ItemLoadingHOC } from './react-utils.js'
import { T, assert, print, truncate, DataError, ValueError, ItemNotLoaded } from './utils.js'
import { JSONx } from './serialize.js'
import { Catalog } from './data.js'

let csso
try { csso = await import('csso') } catch(ex) {}


/**********************************************************************************************************************
 **
 **  WIDGETS
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

    display(mini)       { return `${this._allAssets()}\n${this.displayStyles(mini)}` }
    displayStyles(mini) { return this.styles.size ? `<style>\n${this._allStyles(mini)}\n</style>` : '' }

    _allAssets()        { return [...this.assets].join('\n') }
    _allStyles(mini = false) {
        let css = [...this.styles].join('\n')
        return mini && csso ? csso.minify(css).css : css
    }
}


/**********************************************************************************************************************/

class Component extends React.Component {
    /* A React component with an API for defining and collecting dependencies (assets) and CSS styles.
       A Component subclass itself can be listed as a dependency (in .__assets__ or .assets) of another object.
     */
    static SCOPE_PROLOG() { return `begin-${this.scope}` }
    static SCOPE_EPILOG() { return   `end-${this.scope}` }

    static scope        // app-wide unique name of this component for the purpose of reliable CSS scoping
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
        /* Embed another `component` into this one by wrapping up the React element created from the `component`
           in a "stop-at" <div> with an appropriate css class for reliable scoping.
           Also, check if `this` declares the `component` in its assets and throw an exception if not.
           IMPORTANT: clients should always use this method instead of createElement() to insert Components into a document;
           the only exceptions are top-level Components, as they do not have parent scopes where to embed into,
           and the components that may include components of the same type (recursive inclusion, direct OR indirect!).
           Calling createElement() directly without embed() may result in `this` styles leaking down into the `component`.
         */
        // let embedStyle = T.pop(props, 'embedStyle')  // for styling the wrapper DIV, e.g., display:inline
        // let embedDisplay ...
        return this._wrap(e(component, ...args), false)
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
        /* Extend all the rules in  the `css` stylesheet with reliable scoping by a SCOPE_PROLOG() (from above)
           and a SCOPE_EPILOG() (from below) classes.
           WARNING: appending the epilog may NOT work in some cases:
           - when a rule ends with a pseudo-element, like ::before, ::after (or :before, :after) - the epilog (:not...)
             would have to preceed the pseudo-element in such case, which is not implemented right now;
           - when a component may contain nested copies of itself, then the copies will NOT receive styling if epilog is used.
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

class Widget extends Component {}

function widget(attrs = {}, fun) {
    /* Create a functional React widget with `attrs` assigned: these are typically `style` and `assets`. */
    return Object.assign(fun, attrs)
}

class Layout extends Component {
    /* Takes a number of named blocks, e.g.: head, foot, main, side, ... and places them in predefined
       positions on a page.
     */
    static defaultProps = {
        blocks: {},             // named blocks, e.g.: head, foot, main, side ... to be placed on a page
    }
    render() {
        let {blocks} = this.props
    }
}

/**********************************************************************************************************************
 **
 **  SCHEMA base class
 **
 */

export class Schema {

    // common properties of schemas; can be utilized by subclasses or callers:

    info            // human-readable description of this schema: what values are accepted and how they are interpreted
    default         // default value to be assumed when none was provided by a user (in a web form etc.)
    multi           // if true and the schema describes a field in DATA, the field can be repeated (multiple values)
    blank           // if true, `null` should be treated as a valid value
    type            // class constructor; if present, all values should be instances of `type` (exact or subclasses, depending on schema)


    constructor(params = {}) {
        let {default_, info, multi, blank, type} = params || {}         // params=null is valid
        if (info  !== undefined)    this.info  = info
        if (multi !== undefined)    this.multi = multi
        if (blank !== undefined)    this.blank = blank
        if (type  !== undefined)    this.type  = type
        if (default_ !== undefined) this.default = default_             // because "default" is a JS keyword, there are two ways
        if ('default' in params)    this.default = params['default']    // to pass it to Schema: as "default" or "default_"
    }

    valid(value) {
        /* Validate and normalize an app-layer `value` before encoding.
           Return a normalized value, or throw ValueError.
         */
        return value
        // throw new ValueError(value)
    }

    encode(value) {
        /*
        Convert `value` - a possibly composite object matching the current schema (this) -
        to a JSON-serializable "state" that does not contain non-standard nested objects anymore.
        By default, generic object encoding (JSON.encode()) is performed.
        Subclasses may override this method to perform more compact, schema-aware encoding.
        */
        return JSONx.encode(value)
    }

    decode(state) {
        /* Convert a serializable "state" as returned by encode() back to an original custom object. */
        return JSONx.decode(state)
    }

    encodeJson(value, replacer, space) {
        /* Encode and JSON-stringify a `value` with configurable JSON format. */
        return JSON.stringify(this.encode(value), replacer, space)
    }
    decodeJson(dump)    { return this.decode(JSON.parse(dump)) }
    toString()          { return this.constructor.name }     //JSON.stringify(this._fields).slice(0, 60)

    /***  UI  ***/

    // Clients should call getAssets() and display(), other methods & attrs are for internal use ...

    static Widget       // "view-edit" widget that displays and lets users edit values of this schema

    // widget(props) {
    //     /* Functional component that is used as a .viewer() inside Widget if the latter is missing in a subclass.
    //        Does NOT provide a way to define css styles, unlike Widget.
    //        Subclasses may assume `this` is bound when this method is called.
    //      */
    //     return props.value.toString()
    // }

    getAssets() {
        /* Walk through all nested schema objects, collect their CSS styles and assets and return as an Assets instance.
           this.collect() is called internally - it should be overriden in subclasses instead of this method.
         */
        let assets = new Assets()
        this.collect(assets)
        return assets
    }
    collect(assets) {
        /* For internal use. Override in subclasses to provide a custom way of collecting CSS styles & assets from all nested schemas. */
        this.constructor.Widget.collect(assets)
    }

    display(props) {
        return e(this.constructor.Widget, {...props, schema: this})
    }
}

Schema.Widget = class extends Widget {
    /* Base class for UI "view-edit" widgets that display and let users edit atomic (non-catalog)
       values matching a particular schema.
     */
    static scope = 'Schema'

    // Schema.Widget may include itself recursively (through RECORD, for instance);
    // for this reason, a "stop-at" criterion is NOT used (stopper=null), and prefixes are inserted instead
    static style = () => this.safeCSS({stopper: null, replace: {'~': 'Schema_'}})
    `
        .~flash      { padding:6px 15px; border-radius: 3px; color:white; opacity:1; position: absolute; top:-5px; right:0px; z-index:10; }
        .~flash-info { background-color: mediumseagreen; transition: 0.2s; }
        .~flash-warn { background-color: salmon; transition: 0.2s; }
        .~flash-stop { opacity: 0; z-index: -1; transition: 5s linear; transition-property: opacity, background-color, z-index; }
        .~error      { padding-top:5px; color:red; }
    `

    static defaultProps = {
        schema: undefined,          // parent Schema object
        value:  undefined,          // value object to be displayed by render()
        save:   undefined,          // function save(newValue) to be called after `value` was edited by user
    }
    constructor(props) {
        super(props)
        this.input   = createRef()
        this.initial = undefined        // initial flat (encoded) value for the editor; stored here for change detection in close()
        this.state   = {...this.state,
            editing:  false,
            errorMsg: null,             // error message
            flashMsg: null,             // flash message displayed after accept/reject
            flashCls: null,             // css class to be applied to flashMsg box
        }
    }

    prepare()   { return this.encode(this.props.value) }            // value to be shown in the viewer()
    viewer()    { return DIV({onDoubleClick: e => this.open(e)}, this.prepare()) }
    editor()    { return INPUT({
                    defaultValue:   this.initial,
                    ref:            this.input,
                    onKeyDown:      e => this.key(e),
                    // onBlur:         e => this.reject(e),
                    autoFocus:      true,
                    type:           "text",
                    style:          {width: "100%"},
                    })
                }

    keyAccept(e)  { return e.key === "Enter"  }             // return true if the key pressed accepts the edits
    keyReject(e)  { return e.key === "Escape" }             // return true if the key pressed rejects the edits

    // value()       { return undefined }
    value()       { return this.input.current.value }               // retrieve an edited flat value (encoded) from the editor
    encode(value) { return this.props.schema.encodeJson(value) }    // convert `value` to its editable representation
    decode(value) { return this.props.schema.decodeJson(value) }    // ...and back

    open(e) { this.setState({editing: true})  }                     // activate the editor and editing mode
    close() { this.setState({editing: false, errorMsg: null}) }     // close the editor and editing mode
    read()  {                                                       // read the edited flat value, return this value and a "changed" flag
        let current = this.value()
        let changed = (current !== this.initial)
        return [current, changed]
    }

    // confirm()
    key(e) {
             if (this.keyAccept(e)) this.accept(e).then()
        else if (this.keyReject(e)) this.reject(e)
    }
    async accept(e) {
        // e.preventDefault()
        let [value, changed] = this.read()
        if (!changed) return this.close()
        try {
            value = this.decode(value)
            value = this.props.schema.valid(value)          // validate and normalize the decoded value; exception is raised on error
            this.flash("SAVING...")
            await this.props.save(value)                    // push the new decoded value to the parent
            this.flash("SAVED")
            this.close()
        }
        catch (ex) { this.error(ex) }
    }
    reject(e) {
        let [value, changed] = this.read()
        if (changed) this.flash("NOT SAVED", false)
        this.close()
    }

    flashBox() {
        return DIV(
                cl('Schema_flash', `Schema_${this.state.flashCls || 'flash-stop'}`),
                {key: 'flash', onTransitionEnd: () => this.setState({flashCls: null})},
                this.state.flashMsg)
    }
    flash(msg, positive = true) {
        this.setState({flashMsg: msg, flashCls: positive ? 'flash-info' : 'flash-warn'})
    }

    errorBox() { return this.state.errorMsg ? DIV({key: 'error'}, cl('Schema_error'), this.state.errorMsg) : null }
    error(ex)  { this.setState({errorMsg: ex.toString()}) }

    render() {
        this.initial = this.state.editing ? this.encode(this.props.value) : undefined
        let block    = this.state.editing ? this.editor() : this.viewer()
        return DIV(st({position: 'relative'}), block, this.flashBox(), this.errorBox())
    }
}

/**********************************************************************************************************************
 **
 **  PRIMITIVE schema types
 **
 */

export class Primitive extends Schema {
    /* Base class for schemas of primitive JSON-serializable python types. */

    static stype        // the predefined standard type (typeof...) of app-layer values; same type for db-layer values

    valid(value) {
        let t = this.constructor.stype
        if (typeof value === t || (this.blank && (value === null || value === undefined)))
            return value
        throw new ValueError(`expected a primitive value of type "${t}", got ${value} (${typeof value}) instead`)
    }
    encode(value) {
        if (value === undefined) return null
        return value
    }
    decode(value) { return value }
}

export class BOOLEAN extends Primitive {
    static stype = "boolean"
}
export class NUMBER extends Primitive {
    /* Floating-point number */
    static stype = "number"
}
export class INTEGER extends NUMBER {
    /* Same as NUMBER, but with additional constraints. */
}


export class Textual extends Primitive {
    /* Intermediate base class for string-based types: STRING, TEXT, CODE. Provides common widget implementation. */
    static stype = "string"

    static Widget = class extends Primitive.Widget {
        // prepare()    { return this.props.value || this.empty() }         // preprocessed props.value to be shown in the viewer()
        // empty()      { return I({style: {opacity: 0.3}}, "(empty)") }
        encode(value)   { return value }
        decode(value)   { return value }
    }
}

export class STRING extends Textual {
    valid(value) {
        /* Trim leading/trailing whitespace. Replace with `null` if empty string. */
        value = super.valid(value)
        return value.trim()
    }
}

export class TEXT extends Textual
{
    static Widget = class extends Textual.Widget {

        static scope = 'Widget-TEXT'
        static style = () => this.safeCSS()
        `
            .use-scroll {
                overflow: auto;   /*scroll*/
                max-height: 12rem;
                border-bottom: 1px solid rgba(0,0,0,0.1);
                border-right:  1px solid rgba(0,0,0,0.1);
                resize: vertical;
            }
            .use-scroll[style*="height"] {
                max-height: unset;              /* this allows manual resizing (resize:vertical) to exceed predefined max-height */
            }
        `

        viewer() { return PRE(DIV(cl('use-scroll'), {onDoubleClick: e => this.open(e)}, this.prepare())) }
        editor() {
            return PRE(TEXTAREA({
                defaultValue:   this.initial,
                ref:            this.input,
                onKeyDown:      e => this.key(e),
                onBlur:         e => this.reject(e),
                autoFocus:      true,
                rows:           1,
                wrap:           'off',
                style:          {width:'100%', height:'10em'}
            }))
        }
        keyAccept(e) { return e.key === "Enter" && e.ctrlKey }       //e.shiftKey
    }
}
export class CODE extends TEXT
{
    /*
    ACE (code editor):
    - keyboard shortcuts: https://github.com/ajaxorg/ace/wiki/Default-Keyboard-Shortcuts
    - existing highlighters: https://github.com/ajaxorg/ace/tree/master/lib/ace/mode
    - default commands and shortcuts: https://github.com/ajaxorg/ace/tree/master/lib/ace/commands (-> editor.commands.addCommand() ..removeCommand())
    - pre-built ACE files: https://github.com/ajaxorg/ace-builds
    - React-ACE component: https://www.npmjs.com/package/react-ace

    Methods/props:
      editor.renderer.setAnnotations()
      editor.resize()
      editor.renderer.updateFull()
      position:relative
      editor.clearSelection(1)
      editor.gotoLine(1)
      editor.getSession().setScrollTop(1)
      editor.blur()
      editor.focus()
    */

    static Widget = class extends TEXT.Widget {
        static assets =                                             // import ACE Editor
        `
        <script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/ace.min.js" integrity="sha512-jB1NOQkR0yLnWmEZQTUW4REqirbskxoYNltZE+8KzXqs9gHG5mrxLR5w3TwUn6AylXkhZZWTPP894xcX/X8Kbg==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/mode-javascript.min.js" integrity="sha512-37ta5K4KVYs+MEmIg2xnZxJrdiQmBSKt+JInvyPrq9uz7aF67lMJT/t91EYoYj520jEcGlih41kCce7BRTmE3Q==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
        <!--<script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/worker-base.min.js" integrity="sha512-+nNPckbKGLDhLhi4Gz1Y1Wj5Y+x6l7Qw0EEa7izCznLGTl6CrYBbMUVoIm3OfKW8u82JP0Ow7phPPHdk26Fo5Q==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>-->
        <!--<script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/worker-javascript.min.js" integrity="sha512-hwPBZJdHUlQzk8FedQ6S0eqJw/26H3hQ1vjpdAVJLaZU/AJSkhU29Js3/J+INYpxEUbgD3gubC7jBBr+WDqS2w==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>-->
        <!--<script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/theme-textmate.min.js" integrity="sha512-VE1d8sDypa2IvfFGVnil5k/xdGWtLTlHk/uM0ojHH8b2RRF75UeUBL9btDB8Hhe7ei0TT8NVuHFxWxh5NhdepQ==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>-->
        <script>ace.config.set("basePath", "https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/")</script>
        `

        static scope = 'Widget-CODE'
        static style = () => this.safeCSS()
        `
        .ace-editor {
            --bk-color: rgba(255,255,255,0.3);
            background-color: var(--bk-color);
            height: 12rem;
            width: 100%;
            line-height: 1.4;
            resize: vertical;        /* editor box resizing requires editor.resize() to be invoked by ResizeObserver */
            /*margin-left: -10px;      /* shift the editor to better align inner text with text of surrounding rows in a catalog */
            /*border-left: 8px solid var(--bk-color);*/
        }
        `

        // static viewer_options = {
        //     mode:           "ace/mode/haml",
        //     theme:          "ace/theme/textmate",     // dreamweaver crimson_editor
        //     readOnly:               true,
        //     showGutter:             false,
        //     displayIndentGuides:    false,
        //     showPrintMargin:        false,
        //     highlightActiveLine:    false,
        // }

        static editor_options = {
            // each mode & theme may need a separate mode-*, worker-*, theme-* file (!) - see: https://cdnjs.com/libraries/ace
            //theme:          "ace/theme/textmate",  //textmate dreamweaver crimson_editor
            mode:                   "ace/mode/javascript",
            showGutter:             true,
            displayIndentGuides:    true,
            showPrintMargin:        true,
            highlightActiveLine:    true,
            useWorker:              false,      // disable syntax checker and warnings
        }

        editorAce           // an ACE editor object
        observer            // a ResizeObserver to watch for user resizing the editor box

        editor() {
            return DIV({
                ref:            this.input,
                autoFocus:      true,
                onKeyDown:      e => this.key(e),
                onBlur:         e => this.reject(e),
                className:      "ace-editor",
                width:  '100px',
                height: '100px',
            })
        }

        componentDidUpdate(prevProps, prevState) {
            /* Create an ACE editor after open(). */
            if (!this.state.editing || this.state.editing === prevState.editing) return

            // viewerAce = this.create_editor("#view", this.view_options);
            // viewerAce.renderer.$cursorLayer.element.style.display = "none"      // no cursor in preview editor
            // viewerAce.session.setValue(currentValue)

            let div = this.input.current
            let editorAce = this.editorAce = ace.edit(div, this.constructor.editor_options)
            editorAce.session.setValue(this.initial)
            // editorAce.setTheme("ace/theme/textmate")
            // editorAce.session.setMode("ace/mode/javascript")

            this.observer = new ResizeObserver(() => editorAce.resize())
            this.observer.observe(div)                   // allow resizing of the editor box by a user, must update the Ace widget then

            editorAce.focus()
            // editorAce.gotoLine(1)
            // editorAce.session.setScrollTop(1)
        }

        value() { return this.editorAce.session.getValue() }    // retrieve an edited flat value from the editor
        close() {
            try { return super.close() }
            finally {
                this.editorAce.destroy()                        // destroy the ACE editor to free up resources
                this.observer.disconnect()
                delete this.editorAce
                delete this.observer
            }
        }
    }
}

export class FILENAME extends STRING {}


/**********************************************************************************************************************
 **
 **  ATOMIC schema types
 **
 */

export class GENERIC extends Schema {
    /* Accept objects of any class, optionally restricted to the instances of this.type or this.constructor.type. */

    get _type() { return this.type || this.constructor.type }

    valid(obj) {
        if (this._type && !(obj instanceof this._type))
            throw new ValueError(`invalid object type, expected an instance of ${this._type}, got ${obj} instead`)
        return obj
        // let types = this._types
        // return !types || types.length === 0 || types.filter((base) => obj instanceof base).length > 0
    }
    encode(obj)   { return JSONx.encode(obj) }
    decode(state) { return JSONx.decode(state) }

    static Widget = class extends TEXT.Widget {
        /* Displays raw JSON representation of a value using a standard text editor */
        prepare()     { return this.props.schema.encodeJson(this.props.value) }
        encode(value) { return this.props.schema.encodeJson(value, null, 2) }   // JSON string is pretty-printed for edit
        decode(value) { return this.props.schema.decodeJson(value) }
    }
}

// the most generic schema for encoding/decoding of objects of any types
export let generic_schema = new GENERIC()


/**********************************************************************************************************************/

export class SCHEMA extends GENERIC {
    static type = Schema

    static Widget = class extends GENERIC.Widget {
        static style(scope = '.Schema.SCHEMA') {       // TODO: automatically prepend scope of base classes (.Schema)
            return cssPrepend(scope) `
            .default { color: #888; }
            .info { font-style: italic; }
        `}

        viewer() {
            let {value: schema} = this.props
            let defalt = `${schema.default}`
            return DIV({onDoubleClick: e => this.open(e)}, SPAN({className: 'Schema SCHEMA'},
                    `${schema}`,
                    schema.default !== undefined &&
                        SPAN({className: 'default', title: `default value: ${truncate(defalt,1000)}`},
                            ` (${truncate(defalt,100)})`),
                    schema.info &&
                        SPAN({className: 'info'}, ` • ${schema.info}`),
                        // smaller dot: &middot;
                        // larger dot: •
                    ))
        }
    }
}

// export class FIELD extends SCHEMA {
//
//     unique          // if true (default), the field cannot be repeated (max. one value allowed) ...single
//     //repeated        // if true, the field can occur multiple times in an item
//
//     virtual         // the field is not stored in DB, only imputed upon request through a call to _impute_XYZ()
//
//     derived         // if true, the field's value can be automatically imputed, if missing,
//                     // through a call to item._get_XYZ(); only available when multi=false
//     persistent
//     editable
//     hidden
//
//     slow             // 1 means the field is stored in a separate "slow" column group #1 to allow faster loading
//                      // of remaining fields stored in group #0 ("core" group, "fast" group);
//                      // with large fields moved out to a "slow" group, these operations may become faster:
//                      // - (partial) loading of an item's core fields, but only when slow fields are large: ~2x disk block size or more
//                      // - category scan inside each table-partition; important for mapsort pipelines (!)
//
//     /*
//       1) derived: transient non-editable hidden; refreshed on item's data change
//       2) imputed: persistent editable displayed; not refreshed ??
//
//       1) impute on read -- similar to using a category default when value missing (but there, the value is declared with a schema)
//       2) impute on write
//     */
// }

/**********************************************************************************************************************/

export class CLASS extends Schema {
    /* Accepts any global python type and encodes as a string containing its full package-module name. */
    encode(value) {
        if (value === null) return null
        return globalThis.registry.getPath(value)
    }
    decode(value) {
        if (typeof value !== "string") throw new DataError(`expected a string after decoding, got ${value} instead`)
        return globalThis.registry.getClass(value)
    }
}

/**********************************************************************************************************************/

export class ITEM extends Schema {
    /*
    Reference to an Item, encoded as ID=(CID,IID), or just IID if an exact `category` was provided.
    ITEM without parameters is equivalent to GENERIC(Item), however, ITEM can also be parameterized,
    which is not possible with a GENERIC.
    */
    category_base       // (optional) a base category the items should inherit from
    category_exact      // (optional) an exact category of the items being encoded; stored as an object
                        // because during bootstrap there's no IID yet (!) when this ITEM is being created

    constructor(base, params = {}) {
        /* `params.exact` may contain a category object for exact category checks. */
        let {exact, ...base_params} = params
        super(base_params)
        if (exact) this.category_exact = exact
        if (base)  this.category_base  = base
    }
    encode(item) {
        if (!item.has_id())
            throw new DataError(`item to be encoded has missing or incomplete ID: [${item.id}]`)

        // verify inheritance from a base category - only for LOADED items !!
        if (this.category_base)
            if (item.has_data() && !item.isinstance(this.category_base)) throw new Error(`expected an item of base category ${this.category_base}, got ${item}`)

        // return IID alone if an exact category is known
        if (this.category_exact) {
            let cid = this.category_exact.iid
            if (item.cid !== cid) throw new DataError(`incorrect CID=${item.cid} of an item ${item}, expected CID=${cid}`)
            return item.iid
        }
        return item.id
    }
    decode(value) {
        let cid, iid
        if (typeof value === "number") {                                // decoding an IID alone
            let ref_cid = this.category_exact?.iid
            if (ref_cid === undefined) throw new DataError(`expected a [CID,IID] pair, but got only IID=${iid}`)
            cid = ref_cid
            iid = value
        } else if (value instanceof Array && value.length === 2)        // decoding a full ID = [CID,IID]
            [cid, iid] = value
        else
            throw new DataError(`expected a (CID,IID) tuple, got ${value} instead during decoding`)

        if (!Number.isInteger(cid)) throw new DataError(`expected CID to be an integer, got ${cid} instead during decoding`)
        if (!Number.isInteger(iid)) throw new DataError(`expected IID to be an integer, got ${iid} instead during decoding`)

        return globalThis.registry.getItem([cid, iid])
    }

    static Widget = ItemLoadingHOC(class extends Schema.Widget {
        viewer() {
            let {value: item, loaded} = this.props      // `loaded` function is provided by a HOC wrapper, ItemLoadingHOC
            if (!loaded(item))                          // SSR outputs "loading..." only (no actual item loading), hence warnings must be suppressed client-side
                return SPAN({suppressHydrationWarning: true}, "loading...")

            let url  = item.url({raise: false})
            let name = item.get('name', '')
            let ciid = HTML(item.getStamp({html: false, brackets: false}))

            if (name && url) {
                let note = item.category.get('name', null)
                return SPAN(
                    url ? A({href: url}, name) : name,
                    SPAN({style: {fontSize:'80%', paddingLeft:'3px'}, ...(note ? {} : ciid)}, note)
                )
            } else
                return SPAN('[', url ? A({href: url, ...ciid}) : SPAN(ciid), ']')
        }
    })

    // widget({value: item}) {
    //
    //     let loaded = useItemLoading()
    //     if (!loaded(item))                      // SSR outputs "loading..." only (no actual item loading), hence warnings must be suppressed client-side
    //         return SPAN({suppressHydrationWarning: true}, "loading...")
    //
    //     let url  = item.url({raise: false})
    //     let name = item.get('name', '')
    //     let ciid = HTML(item.getStamp({html: false, brackets: false}))
    //
    //     if (name && url) {
    //         let note = item.category.get('name', null)
    //         return SPAN(
    //             url ? A({href: url}, name) : name,
    //             SPAN({style: {fontSize:'80%', paddingLeft:'3px'}, ...(note ? {} : ciid)}, note)
    //         )
    //     } else
    //         return SPAN('[', url ? A({href: url, ...ciid}) : SPAN(ciid), ']')
    // }
}


/**********************************************************************************************************************
 **
 **  COMPOUND schema types
 **
 */

export class MAP extends Schema {
    /*
    Accepts plain objects as data values, or objects of a given `type`.
    Outputs an object with keys and values encoded through their own schema.
    If no schema is provided, `generic_schema` is used as a default for values, or STRING() for keys.
    */

    // the defaults are configured at class level for easy subclassing and to reduce output when this schema is serialized
    static keys_default   = new STRING()
    static values_default = generic_schema

    get _keys()     { return this.keys || this.constructor.keys_default }
    get _values()   { return this.values || this.constructor.values_default }

    constructor(values, keys, params = {}) {
        super(params)
        if (keys)   this.keys = keys            // schema of keys of app-layer dicts
        if (values) this.values = values        // schema of values of app-layer dicts
    }
    encode(d) {
        let type = this.type || Object
        if (!(d instanceof type)) throw new DataError(`expected an object of type ${type}, got ${d} instead`)

        let schema_keys   = this._keys
        let schema_values = this._values
        let state = {}

        // encode keys & values through predefined field types
        for (let [key, value] of Object.entries(d)) {
            let k = schema_keys.encode(key)
            if (k in state) throw new DataError(`two different keys encoded to the same state (${k}) in MAP, one of them: ${key}`)
            state[k] = schema_values.encode(value)
        }
        return state
    }
    decode(state) {

        if (typeof state != "object") throw new DataError(`expected an object as state for decoding, got ${state} instead`)

        let schema_keys   = this._keys
        let schema_values = this._values
        let d = new (this.type || Object)

        // decode keys & values through predefined field types
        for (let [key, value] of Object.entries(state)) {
            let k = schema_keys.decode(key)
            if (k in d) throw new DataError(`two different keys of state decoded to the same key (${key}) of output object, one of them: ${k}`)
            d[k] = schema_values.decode(value)
        }
        return d
    }
    collect(assets) {
        this._keys.collect(assets)
        this._values.collect(assets)
    }

    toString() {
        let name   = this.constructor.name
        return `${name}(${this._values}, ${this._keys})`
    }
}

export class RECORD extends Schema {
    /*
    Schema of dict-like objects that contain a number of named fields, each one having ITS OWN schema
    - unlike in MAP, where all values share the same schema. RECORD does not encode keys, but passes them unmodified.
    `this.type`, if present, is an exact class (NOT a base class) of accepted objects.
    */
    constructor(fields, params = {}) {
        super(params)
        this.fields = fields            // plain object containing field names and their schemas
    }
    encode(data) {
        /* Encode & compactify values of fields through per-field schema definitions. */
        if (this.type) {
            if (!T.ofType(data, this.type)) throw new DataError(`expected an instance of ${this.type}, got ${data}`)
            data = T.getstate(data)
        }
        else if (!T.isDict(data))
            throw new DataError(`expected a plain Object for encoding, got ${T.getClassName(data)}`)

        return T.mapDict(data, (name, value) => [name, this._schema(name).encode(value)])
    }
    decode(state) {
        if (!T.isDict(state)) throw new DataError(`expected a plain Object for decoding, got ${T.getClassName(state)}`)
        let data = T.mapDict(state, (name, value) => [name, this._schema(name).decode(value)])
        // let data = await T.amapDict(state, async (name, value) => [name, await this._schema(name).decode(value)])
        if (this.type) return T.setstate(this.type, data)
        return data
    }
    _schema(name) {
        if (!this.fields.hasOwnProperty(name))
            throw new DataError(`unknown field "${name}", expected one of ${Object.getOwnPropertyNames(this.fields)}`)
        return this.fields[name] || generic_schema
    }
    collect(assets) {
        for (let schema of Object.values(this.fields))
            schema.collect(assets)
    }
}

/**********************************************************************************************************************
 **
 **  CATALOG & DATA
 **
 */

export class CATALOG extends Schema {

    isCatalog = true

    static keys_default   = new STRING({blank: true})
    static values_default = new GENERIC({multi: true})

    keys        // common schema of keys of an input catalog; must be an instance of STRING or its subclass; primary for validation
    values      // common schema of values of an input catalog

    get _keys()  { return this.keys || this.constructor.keys_default }
    _schema(key) { return this.values || this.constructor.values_default }

    constructor(values = null, keys = null, params = {}) {
        super(params)
        if (keys)   this.keys = keys
        if (values) this.values = values
        if (keys && !(keys instanceof STRING)) throw new DataError(`schema of keys must be an instance of STRING or its subclass, not ${keys}`)
    }
    encode(cat) {
        /* Encode & compactify values of fields through per-field schema definitions. */
        if (T.isDict(cat)) throw new DataError(`plain object no longer supported by CATALOG.encode(), wrap it up in "new Catalog(...)": ${cat}`)
        if (!(cat instanceof Catalog)) throw new DataError(`expected a Catalog, got ${cat}`)
        return cat.isDict() ? this._to_dict(cat) : this._to_list(cat)
    }
    _to_dict(cat) {
        /* Encode a catalog as a plain object (dictionary) with {key: value} pairs. Keys are assumed to be unique. */
        let state = {}
        let encode_key = (k) => this._keys.encode(k)
        for (const e of cat.entries())
            state[encode_key(e.key)] = this._schema(e.key).encode(e.value)
        return state
    }
    _to_list(cat) {
        /* Encode a catalog as a list of tuples [value,key,label,comment], possibly truncated if label/comment
           is missing, and with `value` being schema-encoded.
         */
        let encode_key = (k) => this._keys.encode(k)
        return cat.getEntries().map(e => {
            let value = this._schema(e.key).encode(e.value)
            let tuple = [value, encode_key(e.key), e.label, e.comment]
            tuple.slice(2).forEach(s => {if(!(T.isMissing(s) || typeof s === 'string')) throw new DataError(`expected a string, got ${s}`)})
            while (tuple.length >= 2 && !tuple[tuple.length-1])
                tuple.pop()                         // truncate the last element(s) if a label or comment are missing
            return tuple
        })
    }

    decode(state) {
        if (T.isDict(state))  return this._from_dict(state)
        if (T.isArray(state)) return this._from_list(state)
        throw new DataError(`expected a plain Object or Array for decoding, got ${state}`)
    }
    _from_dict(state) {
        let schema_keys = this._keys
        let entries = Object.entries(state).map(([key, value]) => ({
            key:   schema_keys.decode(key),
            value: this._schema(key).decode(value),
        }))
        return new Catalog(entries)
    }
    _from_list(state) {
        let cat = new Catalog()
        let schema_keys = this._keys
        for (let [value, key, label, comment] of state) {
            key = schema_keys.decode(key)
            value = this._schema(key).decode(value)
            cat.pushEntry({key, value, label, comment})
        }
        return cat
    }

    collect(assets) {
        this._keys.collect(assets)
        this._schema().collect(assets)
        this.constructor.Table.collect(assets)
    }

    toString() {
        let name   = this.constructor.name
        let keys   = this.keys || this.constructor.keys_default
        let values = this.values || this.constructor.values_default
        if (T.ofType(keys, STRING))
            return `${name}(${values})`
        else
            return `${name}(${values}, ${keys})`
    }

    get(path, default_ = undefined, sep = '/') {
        /* Return a nested schema object at a given `path`, or `this` if `path` is empty.
           The path is either an array of keys on subsequent levels of nesting, or a '/'-concatenated string.
           The path may span nested CATALOGs at arbitrary depths. This method is a counterpart of Catalog.get().
         */
        if (!path || !path.length) return this
        if (typeof path === 'string') path = path.split(sep)
        let schema  = this._schema(path[0])             // make one step forward, then call get() recursively
        let subpath = path.slice(1)
        if (!subpath.length)            return schema
        if (schema instanceof CATALOG)  return schema.get(subpath, default_)
        return default_
    }

    displayTable(props) { return e(this.constructor.Table, {...props, schema: this}) }

    static Table = class extends Component {
        /* Displays this catalog's data in a tabular form.
           If `schemas` is provided, it should be a Map or a Catalog, from which a `schema` will be retrieved
           for each entry using: schema=schemas.get(key); otherwise, the `schema` argument is used for all entries.
           If `start_color` is undefined, the same `color` is used for all rows.
         */
        static defaultProps = {
            item:        undefined,             // the parent item of the data displayed
            value:       undefined,
            schema:      undefined,             // parent schema (a CATALOG)
            path:        [],
            color:       undefined,
            start_color: undefined,
        }

        static style = (root = '.Schema.CATALOG', prefix = '.', stop = ':not(.CATALOG_stop *)') =>

            css({'&': root + prefix + 'd0', '?': prefix, '|': stop})       // general rules anchored at a top-level CATALOG (depth=0)
        `
            &                   { width: 100%; font-size: 1rem; }
            
            & ?entry1           { background: #e2eef9; }   /* #D0E4F5 */
            & ?entry2           { background: #f6f6f6; }
            & ?entry            { padding-left: 15px; }
            & ?entry:not(:last-child) { border-bottom: 1px solid #fff; }
            & ?entry-head       { display: flex; }

            & ?cell             { padding: 14px 20px 11px; }
            & ?cell-key         { padding-left: 0; border-right: 1px solid #fff; display: flex; flex-grow: 1; align-items: center; }
            & ?cell-value       { width: 800px; }
            
            & ?key              { font-weight: bold; overflow-wrap: anywhere; text-decoration-line: underline; text-decoration-style: dotted; } 
            & ?key:not([title]) { text-decoration-line: none; }
            
            & ?value, & ?value :is(input, pre, textarea, .ace-editor)        
                                { font-size: 0.95em; font-family: 'Noto Sans Mono', monospace; /* courier */ }
            
            /*& ?value pre        { margin-bottom: 0; font-size: 1em; font-family: 'Noto Sans Mono', monospace; }*/

            & ?move|                        { margin-right: 10px; visibility: hidden; }
            & ?entry-head:hover ?move|      { visibility: visible; }
            & :is(?moveup,?movedown)|       { font-size: 0.8em; line-height: 1em; cursor: pointer; } 
            & ?moveup|::before              { content: "△"; }
            & ?movedown|::before            { content: "▽"; }
            & ?moveup:hover|::before        { content: "▲"; } 
            & ?movedown:hover|::before      { content: "▼"; } 
        `
            + '\n' + css({'&': root + prefix + 'd1', '?': prefix, '|': stop})      // special rules for nested elements (depth >= 1)
        `
            &             { padding-left: 25px; margin-top: -10px; }
            & ?entry      { padding-left: 2px; }
            & ?key        { font-weight: normal; font-style: italic; }
        `
        /* CSS elements:
            .dX        -- nesting level (depth) of a CATALOG, X = 0,1,2,...
            .entry     -- <TR> of a table, top-level or nested
            .entryK    -- alternating colors of rows, K = 1 or 2
            .entry-head-- wrapper around key-value block, or the key block alone if it preceeds an unfolded subcatalog
            .cell-*    -- <DIV> box inside a entry that holds a key/value/subcatalog
            .key       -- deep-most element containing just a key label
            .value     -- deep-most element containing just a rendered value component
           Other:
            .icon-*    -- fixed-sized icons for control elements
         */
        /* DRAFTS:
            & ?entry:not(.CATALOG?d1 *)  { background: red; }    -- rule with a "stop-at" criterion

            & ?icon-info        { color: #aaa; margin: 0 5px; }
            & ?icon-info:hover  { color: unset; }

            & ?icon-info        { color:white; background-color:#bbb; width:18px; height:18px; line-height:17px; font-size:16px;
                                  font-weight:bold; font-style:normal; flex-shrink:0; border-radius:3px; text-align:center; box-shadow: 1px 1px 1px #555; }
            & ?icon-info:hover  { background-color: #777; font-style: italic; }

            & ?icon-info        { color:#bbb; width:18px; height:18px; line-height:17px; font-size:16px; border-radius:10px;
                                  font-weight:bold; font-style:normal; flex-shrink:0; text-align:center; box-shadow: 1px 1px 1px; }
            & ?icon-info:hover  { color:white; background-color: #888; }
        */

        constructor(props) {
            super(props)
            this.EntryAtomic = this.EntryAtomic.bind(this)
            this.EntrySubcat = this.EntrySubcat.bind(this)
        }

        arrows()        { return DIV(cl('move'), DIV(cl('moveup')), DIV(cl('movedown'))) }    // drag-handle (double ellipsis):  "\u22ee\u22ee ⋮⋮"
        info(schema)    { return schema.info ? {title: schema.info} : null }
        //     if (!schema.info) return null
        //     return I(cl('icon-info'), {title: schema.info}, '?')
        //     // return I(cl('icon-info material-icons'), {title: schema.info}, 'help_outline') //'question_mark','\ue88e','info'
        //     // return I(cl("bi bi-info-circle icon-info"), {title: schema.info})
        //     // return I(cl("icon-info"), st({fontFamily: 'bootstrap-icons !important'}), {title: schema.info}, '\uf431')
        //     // let text = FRAGMENT(schema.info, '\n', A({href: "./readmore"}, "read more..."))
        //     // return e(MaterialUI.Tooltip, {title: text},
        //     //            I(cls, st({marginLeft: '9px', color: '#aaa', fontSize: '0.9em'})))
        //     // styled.i.attrs(cls) `margin-left: 9px; color: #aaa; font-size: 0.9em;`
        // }

        key(key_, schema)   { return FRAGMENT(this.arrows(), DIV(cl('key'), key_, this.info(schema))) }

        EntryAtomic({item, path, key_, value, schema}) {
            /* Function component. A table row containing an atomic entry: a key and its value (not a subcatalog).
               The argument `key_` must have a "_" in its name to avoid collision with React's special prop, "key".
             */
            let [current, setCurrent] = useState(value)
            const save = async (newValue) => {
                // print(`save: path [${path}], value ${newValue}, schema ${schema}`)
                await item.remote_edit({path, value: schema.encode(newValue)})
                setCurrent(newValue)
            }
            return DIV(cl('entry-head'),
                      DIV(cl('cell cell-key'),   this.key(key_, schema)),
                      DIV(cl('cell cell-value'), DIV(cl('value CATALOG_stop'), schema.display({value: current, save}))),
                   )
        }

        EntrySubcat({item, path, key_, value, schema, color}) {
            assert(value  instanceof Catalog)
            assert(schema instanceof CATALOG)
            let [folded, setFolded] = useState(false)
            let toggleFolded = () => setFolded(f => !f)

            return FRAGMENT(
                DIV(cl('entry-head'),
                    DIV(cl('cell cell-key'), st({borderRight:'none'}), this.key(key_, schema)),
                    DIV(cl('cell cell-value'))
                ),
                e(this.Catalog.bind(this), {item, path, value, schema, color})
            )
        }

        Catalog({item, value, schema, path, color, start_color}) {
            let entries = value.getEntries()
            let rows    = entries.map(({key, value, idx}, i) =>
            {
                if (start_color) color = 1 + (start_color + i - 1) % 2
                let valueSchema = schema._schema(key)
                let props = {item, value, schema: valueSchema, path: [...path, key], key_: key, color}
                let entry = e(valueSchema.isCatalog ? this.EntrySubcat : this.EntryAtomic, props)
                return DIV(cl(`entry entry${color}`), entry)
            })
            return DIV(cl(`Schema CATALOG d${path.length}`), ...rows)       // depth class: d0, d1, ...
        }

        render()    { return e(this.Catalog.bind(this), this.props) }
    }
}

export class DATA extends CATALOG {
    /* Like CATALOG, but provides distinct value schemas for different predefined keys (fields) of a catalog.
       Primarily used for encoding Item.data. Not intended for other uses.
     */
    fields         // dict of field names and their schemas; null means a default schema should be used for a given field

    constructor(fields, keys = null, params = {}) {
        super(null, keys, params)
        this.fields = fields
    }
    _schema(key) {
        if (!this.fields.hasOwnProperty(key))
            throw new DataError(`unknown field "${key}", expected one of ${Object.getOwnPropertyNames(this.fields)}`)
        return this.fields[key] || this.constructor.values_default
    }
    collect(assets) {
        for (let schema of Object.values(this.fields))
            schema.collect(assets)
        this.constructor.Table.collect(assets)
    }
    displayTable(props)     { return super.displayTable({...props, value: props.item.data, start_color: 1}) }
}


/**********************************************************************************************************************/

