// import { Temporal } from './libs/js-temporal/polyfill.js'

import { React, MaterialUI } from './resources.js'
import { e, cl, st, createRef, useState, useItemLoading, delayed_render } from './react-utils.js'
import { A, B, I, P, PRE, DIV, SPAN, STYLE, INPUT, SELECT, OPTION, TEXTAREA, BUTTON, FLEX, FRAGMENT, HTML, NBSP } from './react-utils.js'
import { ItemLoadingHOC } from './react-utils.js'
import { T, assert, print, trycatch, truncate, concat } from './utils.js'
import { DataError, ValueError } from './errors.js'
import { JSONx } from './serialize.js'
import { Catalog, Path } from './data.js'
import { Assets, Component, Widget } from './widget.js'

// print('Temporal:', Temporal)


/**********************************************************************************************************************
 **
 **  SCHEMA base class
 **
 */

export class Schema {

    get isCatalog() { return false }

    // common properties of schemas; can be utilized by subclasses or callers:
    static defaultProps = {
        info     : undefined,   // human-readable description of this schema: what values are accepted and how they are interpreted
        blank    : undefined,   // if true, `null` and `undefined` are treated as a valid value
        initial  : undefined,   // initial value assigned to a newly created data element of this schema
        repeated : undefined,   // if true, the field described by this schema can be repeated, typically inside a CATALOG/RECORD/DATA
        default  : undefined,   // default value to be used for a non-repeated property when no explicit value was provided;
                                // since repeated properties behave like lists of varying length, and zero is a valid length,
                                // default value is NOT used for them and should be left undefined (TODO: check & enforce this constraint)

        // TODO: to be added in the future...
        // deprecated: undefined,   // indicator that this field should no longer be used; for smooth transition from one schema to another
        // compress: undefined,     // whether to compress JSON output in stringify/parse()
    }

    static getDefaultProps() {
        /* Return all defaultProps from the prototype chain combined. */
        return T.inheritedMerge(this, 'defaultProps')
    }

    __props = {}                // own properties, i.e., excluding the defaults; this.props = defaults (with inherited) + __props


    constructor(props = {}) {
        this.__props = props || {}      // props=null/undefined is also valid
        this.initProps()
    }

    init() {}                   // called from Category.init(); subclasses should override this method as async to perform asynchronous initialization

    initProps() {
        /* Create this.props by combining the constructor's defaultProps (own and inherited) with own props (this.__props). */
        this.props = {...this.constructor.getDefaultProps(), ...this.__props}
    }

    __getstate__()      { return this.__props }

    __setstate__(state) {
        assert(T.isDict(state))
        this.__props = state
        this.initProps()
        return this
    }

    getInitial() {
        /* `props.initial` can be a value or a function; this method provides support for both cases. */
        let {initial} = this.props //this.constructor.initial
        return (typeof initial === 'function') ? initial() : initial
    }

    instanceof(schemaClass) {
        /* Check if this schema is an instance of a particular `schemaClass`, OR is a SchemaWrapper
           around a `schemaClass` (implemented in SchemaWrapper.instanceof()). */
        return this instanceof schemaClass
    }

    validate(obj) {
        /* Validate and preprocess an object to be encoded. */
        this.check(obj)                         // raises an exception if `obj` is invalid
        return this.normalize(obj)              // cleans up and preprocesses the `obj` to a canonical form
    }
    check(obj) {
        /* Check if the object (before normalization) is valid for this schema, throw an exception if not. */
        if (!this.props.blank && (obj === null || obj === undefined))
            throw new ValueError(`expected a non-blank value, but got '${obj}' instead`)
    }
    normalize(obj) {
        /* Clean up and/or convert the object to a canonical form before encoding. */
        return obj
    }

    // valid(value) {
    //     /* Validate and normalize an app-layer `value` before encoding.
    //        Return a normalized value, or throw ValueError.
    //      */
    //     return value
    //     // throw new ValueError(value)
    // }

    toString()      { return this.constructor.name }            //JSON.stringify(this._fields).slice(0, 60)

    combine(streamsOfEntries) {
        /* Combine streams of inherited entries whose .value matches this schema. Return an array of entries.
           The streams are either concatenated, or the entries are merged into one, depending on `prop.repeated`.
           In the latter case, the default value (if present) is included in the merge as the last entry.
         */
        if (this.props.repeated) return concat(streamsOfEntries.map(stream => [...stream]))

        // include the default value in the merge, if present
        let default_ = this.props.default
        let streams = (default_ !== undefined) ? [...streamsOfEntries, [{value: default_}]] : streamsOfEntries

        let entry = this.merge(streams)
        return entry !== undefined ? [entry] : []
    }
    merge(streamsOfEntries) {
        /* For single-valued schemas (prop.repeated is false).
           Merge the values of multiple streams of inherited entries whose .value matches this schema.
           Return an entry whose .value is the result of the merge, or undefined if the value cannot be determined.
           The merged value may include or consist of the schema's default (prop.default).
           The entry returned can be synthetic and contain {value} attribute only.
           Base class implementation returns the first entry of `streamsOfEntries`, or default.
           Subclasses may provide a different implementation.
         */
        assert(!this.props.repeated)
        for (let entries of streamsOfEntries) {
            let arr = [...entries]          // convert an iterator to an array
            if (arr.length > 1) throw new Error("multiple values present for a key in a single-valued schema")
            if (arr.length < 1) continue
            return arr[0]
        }
    }

    /***  UI  ***/

    // Clients should call getAssets() and display(), other methods & attrs are for internal use ...

    static Widget       // "view-edit" widget that displays and lets users edit values of this schema

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

    static defaultProps = {
        schema: undefined,      // parent Schema object
        value:  undefined,      // value object to be displayed by render()
        save:   undefined,      // callback save(newValue), called after `value` was edited by user
        flash:  undefined,      // callback flash(message, positive) for displaying confirmation messages after edits
        error:  undefined,      // callback error(message) for displaying error messages, typically related to validation after edit
        editing:    false,      // initial state.editing; is true, for instance, in CATALOG.NewKeyWidget
    }
    constructor(props) {
        super(props)
        this.initial = undefined        // in edit mode: initial value (encoded) that came through props, stored for change detection
        this.default = undefined        // in edit mode: default value the editor should start with; if this.initial is missing, schema.default is used
        this.input   = createRef()
        this.state   = {...this.state,
            editing: props.editing,
        }
    }

    empty(v)    { return T.isMissing(v) && I('missing') }       // view of an empty value, for display() and viewer()
    view(v)     { return this.encode(v) }                       // view of a non-empty value, for display() and viewer()
    display(v)  { return this.empty(v) || this.view(v) }        // convert a value to a UI element for display in viewer()
    encode(v)   { return JSONx.stringify(v) }                   // convert a value to its editable representation
    decode(v)   { return JSONx.parse(v) }                       // ...and back

    viewer()    { return DIV({onDoubleClick: e => this.open(e)}, this.display(this.props.value)) }
    editor()    { return INPUT({
                    defaultValue:   this.default,
                    ref:            this.input,
                    onKeyDown:      e => this.key(e),
                    onBlur:         e => this.reject(e),
                    autoFocus:      true,
                    type:           "text",
                    style:          {width: "100%"},
                    })
                }

    keyAccept(e)  { return e.key === "Enter"  }             // return true if the key pressed accepts the edits
    keyReject(e)  { return e.key === "Escape" }             // return true if the key pressed rejects the edits

    value() { return this.input.current.value }             // retrieve an edited flat value (encoded) from the editor

    open(e) { this.setState({editing: true})  }                 // activate the editor and editing mode
    close() { this.setState({editing: false}); this.props.error(null) }     // close the editor and editing mode
    read()  {                                                   // read the edited flat value, return this value and a "changed" flag
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
            let {schema, flash, save} = this.props
            value = this.decode(value)
            value = schema.validate(value)      // validate and normalize the decoded value; exception is raised on error
            flash("SAVING...")
            await save(value)                   // push the new decoded value to the parent
            flash("SAVED")
            this.close()
            return value
        }
        catch (ex) { this.props.error(ex.toString()) }
    }
    reject(e) {
        let [value, changed] = this.read()
        if (changed) this.props.flash("NOT SAVED", false)
        this.close()
    }

    render() {
        let {schema, value} = this.props
        if (!this.state.editing) return this.viewer()
        this.initial = (value !== undefined) ? this.encode(value) : undefined
        this.default = (this.initial !== undefined) ? this.initial : schema.getInitial()
        return this.editor()
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

    check(value) {
        super.check(value)
        let t = this.constructor.stype
        if (typeof value === t || (this.props.blank && (value === null || value === undefined))) return
        throw new ValueError(`expected a primitive value of type "${t}", got ${value} (${typeof value}) instead`)
    }
}

export class BOOLEAN extends Primitive {
    static stype = "boolean"
    static defaultProps = {initial: false}
}
export class NUMBER extends Primitive {
    /* Floating-point number */
    static stype = "number"
    static defaultProps = {
        initial: 0,
        min:     undefined,         // minimum value allowed (>=)
        max:     undefined,         // maximum value allowed (<=)
    }
    check(value) {
        super.check(value)
        let {min, max} = this.props
        if (min !== undefined && value < min) throw new ValueError(`the number (${value}) is out of bounds, should be >= ${min}`)
        if (max !== undefined && value > max) throw new ValueError(`the number (${value}) is out of bounds, should be <= ${max}`)
    }
}
export class INTEGER extends NUMBER {
    /* Same as NUMBER, but with additional constraints. */
    check(value) {
        super.check(value)
        if (!Number.isInteger(value)) throw new ValueError(`expected an integer, got ${value} instead`)
    }
}


/**********************************************************************************************************************
 **
 **  STRING and TEXT types
 **
 */

export class Textual extends Primitive {
    /* Intermediate base class for string-based types: STRING, TEXT, CODE. Provides common widget implementation. */
    static stype = "string"
    static defaultProps = {
        initial: '',
        // charcase: false,            // 'upper'/'lower' mean the string will be converted to upper/lower case for storage
    }

    static Widget = class extends Primitive.Widget {
        empty(value)    { return !value && NBSP }  //SPAN(cl('key-missing'), "(missing)") }
        encode(v)       { return v }
        decode(v)       { return v }
    }
}

export class STRING extends Textual {
    normalize(value) {
        return super.normalize(value).trim()        // trim leading/trailing whitespace
    }
}
export class URL extends STRING {
    /* For now, URL schema does NOT check if the string is a valid URL, only modifies the display to make the string a hyperlink. */
    static Widget = class extends STRING.Widget {
        view(v) { return A({href: v}, v) }
    }
}

export class TEXT extends Textual
{
    static Widget = class extends Textual.Widget {

        static scope = 'Widget-TEXT'
        static style = () => this.safeCSS()
        `
            .editor {
                min-height: 2em;
                height: 10em;
                width: 100%;
                outline: none;
                resize: vertical;
            }
        `
        //     .use-scroll {
        //         overflow: auto;   /*scroll*/
        //         max-height: 12rem;
        //         border-bottom: 1px solid rgba(0,0,0,0.1);
        //         border-right:  1px solid rgba(0,0,0,0.1);
        //         resize: vertical;
        //     }
        //     .use-scroll[style*="height"] {
        //         max-height: unset;              /* this allows manual resizing (resize:vertical) to exceed predefined max-height */
        //     }

        viewer() { return DIV({onDoubleClick: e => this.open(e)}, this.display(this.props.value)) }
        editor() {
            return TEXTAREA({
                className:      'editor',
                defaultValue:   this.default,
                ref:            this.input,
                onKeyDown:      e => this.key(e),
                autoFocus:      true,
                rows:           1,
                // onBlur:         e => this.reject(e),
                // wrap:           'off',
            })
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
        <script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/mode-jsx.min.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
        <!--<script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/mode-javascript.min.js" integrity="sha512-37ta5K4KVYs+MEmIg2xnZxJrdiQmBSKt+JInvyPrq9uz7aF67lMJT/t91EYoYj520jEcGlih41kCce7BRTmE3Q==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>-->
        <!--<script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/worker-base.min.js" integrity="sha512-+nNPckbKGLDhLhi4Gz1Y1Wj5Y+x6l7Qw0EEa7izCznLGTl6CrYBbMUVoIm3OfKW8u82JP0Ow7phPPHdk26Fo5Q==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>-->
        <!--<script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/worker-javascript.min.js" integrity="sha512-hwPBZJdHUlQzk8FedQ6S0eqJw/26H3hQ1vjpdAVJLaZU/AJSkhU29Js3/J+INYpxEUbgD3gubC7jBBr+WDqS2w==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>-->
        <!--<script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/theme-textmate.min.js" integrity="sha512-VE1d8sDypa2IvfFGVnil5k/xdGWtLTlHk/uM0ojHH8b2RRF75UeUBL9btDB8Hhe7ei0TT8NVuHFxWxh5NhdepQ==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>-->
        <script>ace.config.set("basePath", "https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/")</script>
        `

        static scope = 'Widget-CODE'
        static style = () => this.safeCSS()
        `
        .ace-viewer, .ace-editor {
            font-size: 1em;
            min-height: 3em;
            line-height: 1.3;
            resize: vertical;        /* editor box resizing requires editor.resize() to be invoked by ResizeObserver */
        }
        .ace-viewer {
            background-color: rgba(255,255,255,0);
            width: calc(100% + 4px);
            margin-left: -4px;       /* shift the viewer to better align inner text with text of surrounding rows in a catalog */
        }
        .ace-editor {
            background-color: rgba(255,255,255,0.5);
            height: 12em;
        }
        `

        static viewer_options = {
            mode:                   "ace/mode/jsx",   // .../javascript
            readOnly:               true,
            showGutter:             false,
            displayIndentGuides:    false,
            showPrintMargin:        false,
            highlightActiveLine:    false,
            useWorker:              false,      // disable syntax checker and warnings
            // maxLines:               10,    // when set, it makes the editor (!) display with incorrect height
        }
        static editor_options = {
            // each mode & theme may need a separate mode-*, worker-*, theme-* file (!) - see: https://cdnjs.com/libraries/ace
            //theme:                "ace/theme/textmate",  //textmate dreamweaver crimson_editor
            mode:                   "ace/mode/jsx",
            showGutter:             true,
            displayIndentGuides:    true,
            showPrintMargin:        true,
            highlightActiveLine:    true,
            useWorker:              false,      // disable syntax checker and warnings
        }

        viewerRef = createRef()
        viewerAce                       // ACE viewer object
        editorAce                       // ACE editor object

        viewer() {
            let value  = this.display(this.props.value)
            let lines  = value.trimRight().split('\n')
            let height = Math.min(10, 4 + Math.max(0, lines.length - 2)) + 'em'
            return DIV(cl("ace-viewer"), st({height}), {onDoubleClick: e => this.open(e), ref: this.viewerRef})
        }
        editor() {
            return DIV({
                ref:            this.input,
                autoFocus:      true,
                onKeyDown:      e => this.key(e),
                //onBlur:         e => this.reject(e),
                className:      "ace-editor",
            })
        }

        createAce(value, div, options) {
            let widget = ace.edit(div, options)
            widget.session.setValue(value)
            let observer = new ResizeObserver(() => widget.resize())    // watch for user resizing the Ace box;
            observer.observe(div)                                       // on resize must update the Ace widget;
            let destroy = widget.destroy.bind(widget)                   // amend the standard destroy() to disconnect the observer
            widget.destroy = () => {observer.disconnect(); destroy()}
            return widget
        }
        deleteAce() {
            this.viewerAce?.destroy()                       // destroy the ACE widget to free up resources
            this.editorAce?.destroy()
            delete this.viewerAce
            delete this.editorAce
        }

        initViewer() {
            assert(this.viewerRef.current)
            let value = this.display(this.props.value)
            this.viewerAce = this.createAce(value, this.viewerRef.current, this.constructor.viewer_options)
            this.viewerAce.renderer.$cursorLayer.element.style.display = "none"      // no Ace cursor in preview
        }
        initEditor() {
            this.deleteAce()
            this.editorAce = this.createAce(this.default, this.input.current, this.constructor.editor_options)
            this.editorAce.focus()
        }
        initAce()   { if (this.state.editing) this.initEditor(); else this.initViewer() }
        value()     { return this.editorAce.session.getValue() }        // retrieve an edited flat value from the editor
        close()     { this.deleteAce(); super.close() }

        componentDidMount()                         { this.initAce() }
        componentWillUnmount()                      { this.deleteAce() }
        componentDidUpdate(prevProps, prevState)    { if (this.state.editing !== prevState.editing) this.initAce() }
    }
}

export class PATH extends STRING {
    relative        // if True, relative paths are allowed in addition to absolute ones
}

/**********************************************************************************************************************
 **
 **  DATE* types
 **
 */

export class DATE extends STRING {
    /* Date (no time, no timezone). Serialized to a string "YYYY-MM-DD". */

    check(value) {
        if (!(value instanceof Date)) throw new ValueError(`expected a Date, got ${value} instead`)
    }
}

export class DATETIME extends STRING {
    /* Date+time. May contain a timezone specification. Serialized to a string. */
}

/**********************************************************************************************************************
 **
 **  ATOMIC schema types
 **
 */

export class GENERIC extends Schema {
    /* Accept objects of any class, optionally restricted to the instances of this.type or this.constructor.type. */

    static defaultProps = {
        class: undefined,
        //types: undefined,
    }

    check(obj) {
        super.check(obj)
        let {class: class_} = this.props
        if (class_ && !(obj instanceof class_))
            throw new ValueError(`invalid object type, expected an instance of ${class_}, got ${obj} instead`)
        // let types = this._types
        // return !types || types.length === 0 || types.filter((base) => obj instanceof base).length > 0
    }

    static Widget = class extends TEXT.Widget {
        /* Display raw JSON representation of a value using a standard text editor */
        empty(value)    { return Schema.Widget.prototype.empty.call(this, value) }
        view(value)     { return JSONx.stringify(value) }               // JSON string is pretty-printed for edit
        encode(value)   { return JSONx.stringify(value, null, 2) }      // JSON string is pretty-printed for edit
        decode(value)   { return JSONx.parse(value) }
    }
}

// the most generic schema for encoding/decoding of objects of any types
export let generic_schema = new GENERIC()
export let generic_string = new STRING()


/**********************************************************************************************************************/

export class SCHEMA extends GENERIC {
    static defaultProps = {class: Schema}

    static Widget = class extends GENERIC.Widget {
        scope = 'Schema-SCHEMA'
        static style = () => this.safeCSS({stopper: '|'})
        `
            .default|   { color: #888; }
            .info|      { font-style: italic; }
        `
        viewer()  { return Schema.Widget.prototype.viewer.call(this) }
        view() {
            let {value: schema} = this.props
            if (schema instanceof SchemaWrapper) {
                if (!schema.schema) return "SchemaWrapper (not loaded)"
                schema = schema.schema
            }
            let dflt = `${schema.props.default}`
            return SPAN(`${schema}`,
                    schema.props.default !== undefined &&
                        SPAN(cl('default'), {title: `default value: ${truncate(dflt,1000)}`}, ` (${truncate(dflt,100)})`),
                    schema.props.info &&
                        SPAN(cl('info'), ` • ${schema.props.info}`),   // smaller dot: &middot;  larger dot: •
                    )
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

export class ITEM extends Schema {
    /*
    Reference to an Item, encoded as ID=(CID,IID), or just IID if an exact `category` was provided.
    ITEM without parameters is equivalent to GENERIC(Item), however, ITEM can also be parameterized,
    which is not possible with a GENERIC.
    */
    static defaultProps = {
        category:  undefined,       // base category for all the items to be encoded
        exact:     false,           // if true, the items must belong to this exact `category`, not any of its subcategories
    }

    static Widget = ItemLoadingHOC(class extends Schema.Widget {
        view() {
            let {value: item, loaded} = this.props      // `loaded` function is provided by a HOC wrapper, ItemLoadingHOC
            if (!loaded(item))                          // SSR outputs "loading..." only (no actual item loading), hence warnings must be suppressed client-side
                return SPAN({suppressHydrationWarning: true}, "loading...")

            let url  = item.url()
            let name = item.getName()
            let ciid = HTML(item.getStamp({html: false, brackets: false}))

            if (name && url) {
                let note = item.category.getName() || null
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
    //     let url  = item.url()
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

    static defaultProps = {
        class:      Object,                     // class of input objects
        keys:       new STRING(),               // schema of keys of app-layer dicts
        values:     generic_schema,             // schema of values of app-layer dicts
    }

    collect(assets) {
        this.props.keys.collect(assets)
        this.props.values.collect(assets)
    }

    toString() {
        let name   = this.constructor.name
        return `${name}(${this.props.values}, ${this.props.keys})`
    }
}

export class RECORD extends Schema {
    /*
    Schema of dict-like objects that contain a number of named fields, each one having ITS OWN schema
    - unlike in MAP, where all values share the same schema. RECORD does not encode keys, but passes them unmodified.
    `this.type`, if present, is an exact class (NOT a base class) of accepted objects.
    */

    static defaultProps = {
        class:  undefined,
        fields: {},                     // object containing field names and their schemas
    }

    collect(assets) {
        for (let schema of Object.values(this.props.fields))
            schema.collect(assets)
    }
}

/**********************************************************************************************************************
 **
 **  CATALOG & DATA
 **
 */

export class CATALOG extends Schema {
    /*
    Schema of an object of the Catalog class or its subclass.
    Validates each `value` of a catalog's entry through a particular "subschema" - the subschema may depend
    on the entry's key, or be shared by all entries regardless of the key.

    The schema may restrict the set of permitted keys in different ways:
    - require that a key name belongs to a predefined set of "fields"
    - no duplicate key names (across all non-missing names)
    - no duplicates for a particular key name -- encoded in the key's subschema, subschema.repeated=false
    other constraints:
    - mandatory keys (empty key='' allowed)
    - empty key not allowed (by default key_empty_allowed=false)
    - keys not allowed (what about labels then?)
     */

    get isCatalog() { return true }

    static defaultProps = {
        keys:       new STRING({blank: true}),      // schema of all keys in the catalog; must be an instance of STRING or its subclass; mainly for validation
        values:     new GENERIC({multi: true}),     // schema of all values in the catalog
        initial:    () => new Catalog(),
        repeated:   false,                          // typically, CATALOG fields are not repeated, so that their content gets merged during inheritance (which requires repeated=false)
        // keys_mandatory : false,
        // keys_forbidden : false,
        // keys_unique    : false,
        // keys_empty_ok  : false,
    }

    subschema(key)  { return this.props.values }    // schema of values of a `key`; subclasses should throw an exception or return undefined if `key` is not allowed
    getValidKeys()  { return undefined }

    constructor(props = {}) {
        super(props)
        let {keys} = props
        if (keys && !(keys.instanceof(STRING))) throw new DataError(`schema of keys must be an instance of STRING or its subclass, not ${keys}`)
    }

    collect(assets) {
        this.props.keys.collect(assets)
        this.props.values.collect(assets)
        this.constructor.Table.collect(assets)
    }

    toString() {
        let name = this.constructor.name
        let {keys, values} = this.props
        if (T.ofType(keys, STRING))  return `${name}(${values})`
        else                         return `${name}(${values}, ${keys})`
    }

    find(path = null) {
        /* Return a (nested) subschema at a given `path`, or `this` if `path` is empty.
           The path is an array of keys on subsequent levels of nesting, some keys can be missing (null/undefined)
           if the corresponding subcatalog accepts this. The path may span nested CATALOGs at arbitrary depths.
         */
        return Path.find(this, path, (schema, key) => {
            if (!schema.isCatalog) throw new Error(`schema path not found: ${path}`)
            return [schema.subschema(key)]
        })
    }

    merge(streams) {
        let entries = concat(streams.map(s => [...s]))      // input streams must be materialized before concat()
        if (entries.length === 1) return entries[0]
        let catalogs = entries.map(e => e.value)
        // TODO: inside Catalog.merge(), if repeated=false, overlapping entries should be merged recursively
        //       through combine() of props.values schema
        if (catalogs.length) return {value: Catalog.merge(catalogs, !this.props.repeated)}
    }

    displayTable(props) { return e(this.constructor.Table, {...props, path: [], schema: this}) }

    static KeyWidget = class extends STRING.Widget {
        /* A special type of STRING widget for displaying keys in a catalog. */
        static defaultProps = {
            keyNames: undefined,    // array of predefined key names to choose from
        }
        empty(value)   { return !value && I(cl('key-missing'), "(empty)") }
        editor() {
            let {keyNames} = this.props
            if (!keyNames) return super.editor()
            // let options = keyNames.map(key => OPTION({value: key}, key))
            let options = [OPTION("select key ...", {value: ""}), ...keyNames.map(key => OPTION({value: key}, key))]
            return SELECT({
                    defaultValue:   this.default,
                    ref:            this.input,
                    onKeyDown:      e => this.key(e),
                    onChange:       e => e.target.value === "" ?  this.reject(e) : this.accept(e),
                    onBlur:         e => this.reject(e),
                    autoFocus:      true,
                    // size:           5,                  // enforces a list box instead of a dropdown, no need for "select key..." pseudo-option
                    }, options)
        }
    }
    static NewKeyWidget = class extends CATALOG.KeyWidget {
        static defaultProps = {
            editing:  true,         // this widget starts in edit mode
        }
        reject(e)   { this.props.save(undefined) }      // save() must be called to inform that no initial value was provided
    }
}

CATALOG.Table = class extends Component {
    /* A set of function components for displaying a Catalog in a tabular form. */

    static scope = 'Schema-CATALOG'
    static style = () => this.safeCSS({stopper: '|'})
    `
        .catalog-d0       { width: 100%; font-size: 1rem; }
        
        .entry1           { background: #e2eef9; }   /* #D0E4F5 */
        .entry2           { background: #f6f6f6; }
        .entry            { padding-left: 15px; }   /* border-collapse: collapse; */
        .entry-head       { display: flex; }
        .entry:not(:last-child)          { border-bottom: 1px solid #fff; }
        .spacer           { flex-grow: 1; }

        .onhover          { width: 25%; height: 20px; margin-top: -20px; position: absolute; top:0; }
        .addnew           { padding-left: 20px; opacity: 0.4; }
        .addnew.hide      { max-height: 0; margin-top:-1px; visibility: hidden; transition: 0.2s linear 0.1s; overflow-y: hidden; }
        .addnew:hover, .onhover:hover + .addnew   
                          { max-height: 100px; margin-top:0; visibility: visible; transition: max-height 0.3s linear 0.5s; opacity: 1; }
        .addnew .cell-key { cursor: pointer; border-right: none; }

        .cell             { padding: 14px 20px 11px; position: relative; }
        .cell-key         { padding-left: 0; border-right: 1px solid #fff; display: flex; flex-grow: 1; align-items: center; }
        .cell-value       { width: 800px; }
        
        .key              { font-weight: bold; overflow-wrap: anywhere; text-decoration-line: underline; text-decoration-style: dotted; }
        .key:not([title]) { text-decoration-line: none; }
        .key-missing      { opacity: 0.3; visibility: hidden; }
        
        /* show all control icons/info when hovering over the entry: .move, .delete, .insert, .key-missing */
        .cell-key:hover *|            { visibility: visible; }
                
        .cell-value|                  { font-size: 0.8rem; font-family: 'Noto Sans Mono', monospace; /* courier */ }
        .cell-value :is(input, pre, textarea, .ace-viewer, .ace-editor)      /* NO stopper in this selector, it must apply inside embedded widgets */         
                                      { font-size: 0.8rem; font-family: 'Noto Sans Mono', monospace; }

        .move|                        { margin-right: 10px; visibility: hidden; }
        :is(.moveup,.movedown)|       { font-size: 0.8em; line-height: 1em; cursor: pointer; } 
        .moveup|::after               { content: "△"; }
        .movedown|::after             { content: "▽"; }
        .moveup:hover|::after         { content: "▲"; color: mediumblue; } 
        .movedown:hover|::after       { content: "▼"; color: mediumblue; }
        
        .expand                       { padding-left: 10px; }
        .expand.is-empty|::after      { content: "▿"; }
        .expand.is-folded|::after     { content: "▸"; cursor: pointer; }
        .expand.is-expanded|::after   { content: "▾"; cursor: pointer; }
        
        .insert|::after               { content: "✚"; }
        .insert:hover|                { color: green; text-shadow: 1px 1px 1px #777; cursor: pointer; }
        
        .delete|::after               { content: "✖"; }
        .delete|                      { padding-left: 10px; }
        .delete|, .insert|            { color: #777; flex-shrink:0; font-size:1.1em; line-height:1em; visibility: hidden; }
        .delete:hover|                { color: firebrick; text-shadow: 1px 1px 1px #777; cursor: pointer; }

        .catalog-d1                   { padding-left: 25px; margin-top: -10px; }
        .catalog-d1 .entry            { padding-left: 2px; }
        .catalog-d1 .key              { font-weight: normal; font-style: italic; }
        .catalog.is-empty             { margin-top: 0; }

        .flash|         { padding:4px 12px; border-radius: 2px; color:white; opacity:1; position: absolute; top:8px; right:8px; z-index:10; }
        .flash-info|    { background-color: mediumseagreen; transition: 0.2s; }
        .flash-warn|    { background-color: salmon; transition: 0.2s; }
        .flash-stop|    { opacity: 0; z-index: -1; transition: 2s linear 1s; transition-property: opacity, background-color, z-index; }
        .error|         { padding-top:5px; color:red; }
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
       DRAFTS:
        drag-handle (double ellipsis):  "\u22ee\u22ee ⋮⋮"
        undelete: ↺ U+21BA
    */

    constructor(props) {
        super(props)
        this.EntryAtomic = this.EntryAtomic.bind(this)
        this.EntrySubcat = this.EntrySubcat.bind(this)
        this.Catalog = this.Catalog.bind(this)
    }

    move(up, down) {
        let hide = st({visibility: 'hidden'})
        return DIV(cl('move'),
                   DIV(cl('moveup'),   {onClick: e => up(),   title: "Move up"},   !up   && hide),
                   DIV(cl('movedown'), {onClick: e => down(), title: "Move down"}, !down && hide))
    }
    delete(action)  { return DIV(cl('delete'), {onClick: action, title: "Delete this entry"}) }

    // info(schema)    { return schema.info ? {title: schema.info} : null }
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

    expand({state, toggle}) { return DIV(cl(`expand is-${state}`), {onClick: toggle}) }
    insert(action)  {
        let menu = [
            ['Add before', () => action(-1)],
            ['Add after',  () => action(+1)],
        ]
        return e(MaterialUI.Tooltip,
                    {// PopperProps: {style: {marginTop: '-30px'}, sx: {mt: '-30px'}},
                     componentsProps: {tooltip: {sx: {background: 'white', color: 'black', m:'0 !important'}}},
                     title: FRAGMENT(...menu.map(cmd => e(MaterialUI.MenuItem, cmd[0], {onClick: cmd[1]}))),
                     placement: "bottom-end", enterDelay: 1500, enterTouchDelay: 500, leaveTouchDelay: 500,
                    },
                    DIV(cl('insert'), {onClick: () => action(+1)}),
                )
    }

    flash() {
        let [msg, setMsg] = useState()
        let [cls, setCls] = useState()
        let action = (msg, ok = true) => setMsg(msg) || setCls(ok ? 'flash-info' : 'flash-warn')
        let box = DIV(msg, cl('flash', cls || 'flash-stop'), {key: 'flash', onTransitionEnd: () => setCls(null)})
        return [action, box]
    }
    error() {
        let [msg, setMsg] = useState()
        let box = msg ? DIV(cl('error'), {key: 'error'}, msg) : null
        return [setMsg, box]
    }

    key(entry, info, ops, expand) {
        /* Display key of an entry, be it an atomatic entry or a subcatalog. */
        let [current, setCurrent] = useState(entry.key)
        const save = async (newKey) => {
            await ops.updateKey(newKey)
            setCurrent(newKey)
        }
        let [flash, flashBox] = this.flash()
        let [error, errorBox] = this.error()

        let {initKey, keyNames} = ops
        let widget = (entry.id === 'new') ? CATALOG.NewKeyWidget : CATALOG.KeyWidget
        let props  = {value: current, flash, error, save: initKey || save, keyNames, schema: generic_string}

        return FRAGMENT(
                    this.move(ops.moveup, ops.movedown),
                    DIV(cl('key'), e(widget, props), info && {title: info}),
                    expand && this.expand(expand),
                    DIV(cl('spacer')),
                    ops.insert && this.insert(ops.insert),
                    ops.delete && this.delete(ops.delete),
                    flashBox, errorBox,
        )
    }

    EntryAtomic({item, path, entry, schema, ops}) {
        /* A table row containing an atomic entry: a key and its value (not a subcatalog).
           The argument `key_` must have a "_" in its name to avoid collision with React's special prop, "key".
           `entry.value` and `schema` can be undefined for a newly created entry, then no value widget is displayed.
           If value is undefined, but schema is present, the value is displayed as "missing".
         */
        let [value, setValue] = useState(entry.value)
        let isnew = (value === undefined) || entry.saveNew

        const save = async (newValue) => {
            // print(`save: path [${path}], value ${newValue}, schema ${schema}`)
            let action = entry.saveNew || ops.updateValue       // saveNew: an entire entry is saved for the first time
            await action(newValue)
            setValue(newValue)
        }
        let [flash, flashBox] = this.flash()            // components for value editing; for key editing created in key() instead
        let [error, errorBox] = this.error()
        let props = {value,
                     editing: isnew,                    // a newly created entry (no value) starts in edit mode
                     save, flash, error}

        return DIV(cl('entry-head'),
                  DIV(cl('cell cell-key'),   this.key(entry, schema?.props.info, ops)),
                  DIV(cl('cell cell-value'), schema && this.embed(schema.display(props)), flashBox, errorBox),
               )
    }

    EntrySubcat({item, path, entry, schema, color, ops}) {
        let [folded, setFolded] = useState(false)
        let subcat = entry.value
        let empty  = false //!subcat.length   -- this becomes INVALID when entries are inserted/deleted inside `subcat`
        let toggle = () => !empty && setFolded(f => !f)
        let expand = {state: empty && 'empty' || folded && 'folded' || 'expanded', toggle}
        let key    = this.key(entry, schema?.props.info, ops, expand)

        return FRAGMENT(
            DIV(cl('entry-head'), {key: 'head'},
                DIV(cl('cell cell-key'), key, folded ? null : st({borderRight:'none'})),
                DIV(cl('cell cell-value'))
            ),
            DIV({key: 'cat'}, folded && st({display: 'none'}),
                e(this.Catalog, {item, path, value: subcat, schema, color})),
        )
    }
    EntryAddNew({hide = true, insert}) {
        return FRAGMENT(
            hide && DIV(cl('onhover')),
            DIV(cl('entry-head addnew'), hide && cl('hide'),
                DIV(cl('cell cell-key'), "✚ ", NBSP, " Add new entry ...", {onClick: insert}),
                DIV(cl('cell cell-value'))
            )
        )
    }

    // validKey(pos, key, entries, schema) {
    //     /* Check that the key name at position `pos` in `entries` is allowed to be changed to `key`
    //        according to the `schema`; return true, or alert the user and raise an exception. */
    //     // verify that a `key` name is allowed by the catalog's schema
    //     let subschema = trycatch(() => schema.subschema(key))
    //     if (!subschema) {
    //         let msg = `The name "${key}" for a key is not permitted by the schema.`
    //         alert(msg); throw new Error(msg)
    //     }
    //     // check against duplicate names, if duplicates are not allowed
    //     if (!subschema.repeated)
    //         for (let ent of entries) {}
    //     return true
    // }

    actions({item, path, setEntries}) { return {
        /* A set of UI actions to manipulate top-level entries, for use by subcomponents of a Catalog() widget below. */

        insert: (pos, rel = -1) => setEntries(prev => {
            /* insert a special entry {id:"new"} at a given position to mark a place where an "add new entry" row should be displayed */
            // `rel` is -1 (add before), or +1 (add after)
            if (rel > 0) pos++
            return [...prev.slice(0,pos), {id: 'new'}, ...prev.slice(pos)]
        }),

        delete: async (pos) => {
            /* delete the entry at position `pos`; TODO: only mark the entry as deleted (entry.deleted=true) and allow undelete */
            // TODO: lock/freeze/suspense the UI until the server responds to prevent user from making multiple modifications at the same time
            await item.action.delete_field([...path, pos])
            setEntries(prev => [...prev.slice(0,pos), ...prev.slice(pos+1)])
        },

        move: async (pos, delta) => {
            // move the entry at position `pos` by `delta` positions up or down, delta = +1 or -1
            assert(delta === -1 || delta === +1)
            await item.action.move_field(path, pos, pos+delta)
            setEntries(prev => {
                // if (pos+delta < 0 || pos+delta >= prev.length) return prev
                let entries = [...prev];
                [entries[pos], entries[pos+delta]] = [entries[pos+delta], entries[pos]]     // swap [pos] and [pos+delta]
                return entries
            })
        },

        initKey: (pos, key, catalogSchema) => {
            /* Confirm creation of a new entry with a given key; assign an ID to it.
               Store an initial value of a key after new entry creation.
               `catalogSchema` is a DATA schema of a parent catalog, for checking if `key` is valid or not.
             */

            let schema = trycatch(() => catalogSchema.subschema(key))
            if (key !== undefined && !schema) {                  // verify if `key` name is allowed by the parent catalog
                alert(`The name "${key}" for a key is not permitted by the schema.`)
                key = undefined
            }
            let unnew = () => setEntries(prev => {
                /* mark an entry at a given position as not new anymore, by deleting its `saveNew` prop */
                delete prev[pos].saveNew
                return [...prev]
            })

            setEntries(prev => {
                assert(prev[pos].id === 'new')
                if (key === undefined) return [...prev.slice(0,pos), ...prev.slice(pos+1)]          // drop the new entry if its key initialization was terminated by user

                let value = schema.getInitial()
                let ids = [-1, ...prev.map(e => e.id)]
                let id  = Math.max(...ids.filter(Number.isInteger)) + 1     // IDs are needed internally as keys in React subcomponents
                prev[pos] = {id, key, value}

                if (schema.isCatalog) item.action.insert_field(path, pos, {key, value: JSONx.encode(value) })
                else prev[pos].saveNew = (value) =>
                    item.action.insert_field(path, pos, {key, value: JSONx.encode(value)}).then(() => unnew())

                return [...prev]
            })
        },
        updateKey: (pos, newKey) => {
            return item.action.update_field([...path, pos], {key: newKey})
            // return item.client.send_field_update([...path, pos], {key: newKey})
            // return item.client.update_field()
            // return item.server.field_update()
            // return item.server.update_field()
            // return item.server.update({field: ...})
        },
        updateValue: (pos, newValue, schema) => {
            return item.action.update_field([...path, pos], {value: JSONx.encode(newValue)})
        }
    }}

    Catalog({item, value, schema, path, color, start_color}) {
        /* If `start_color` is undefined, the same `color` is used for all rows. */
        assert(value  instanceof Catalog)
        assert(schema.instanceof(CATALOG))

        let catalog  = value
        let getColor = pos => start_color ? 1 + (start_color + pos - 1) % 2 : color

        // `id` of an entry is used to identify subcomponents through React's "key" property
        let [entries, setEntries] = useState(catalog.getEntries().map((ent, pos) => ({...ent, id: pos})))
        let run = this.actions({item, path, setEntries})

        let keyNames = schema.getValidKeys()
        let N = entries.length

        let rows = entries.map((entry, pos) =>
        {
            let {key}   = entry
            let isnew   = (entry.id === 'new')
            let vschema = isnew ? undefined : schema.subschema(key)
            let color   = getColor(pos)

            // insert `pos` as the 1st arg in all actions of `run`
            let ops     = T.mapDict(run, (name, fun) => [name, (...args) => fun(pos, ...args)])

            // some actions in `ops` must be defined separately
            ops.moveup   = pos > 0   ? () => run.move(pos,-1) : null        // moveup() is only present if there is a position available above
            ops.movedown = pos < N-1 ? () => run.move(pos,+1) : null        // similar for movedown()
            ops.initKey  = isnew ? key => run.initKey(pos, key, schema) : null
            ops.keyNames = keyNames
            ops.updateValue = val => run.updateValue(pos, val, vschema)

            let props   = {item, path: [...path, pos], entry, schema: vschema, color, ops}
            let row     = e(vschema?.isCatalog ? this.EntrySubcat : this.EntryAtomic, props)
            return DIV(cl(`entry entry${color}`), {key: entry.id}, row)
        })

        let pos   = rows.length
        let depth = path.length
        let empty = !entries.length

        // if (!entries.map(e => e.id).includes('new'))
        rows.push(DIV(cl(`entry entry${getColor(pos)}`), {key: 'add'}, st({position: 'relative'}),
                  e(this.EntryAddNew, {hide: depth > 0, insert: () => run.insert(pos)})))

        return DIV(cl(`catalog catalog-d${depth}`), empty && cl('is-empty'), ...rows)
    }

    render()    { return e(this.Catalog, this.props) }
}

export class DATA extends CATALOG {
    /* Like CATALOG, but provides distinct value schemas for different predefined keys (fields) of a catalog.
       Primarily used for encoding Item.data. Not intended for other uses.
     */

    static defaultProps = {
        fields: {},             // object with field names and their schemas; null means a default schema should be used for a given field
        // keys_obligatory: true,
    }

    has(key) { return Object.hasOwn(this.props.fields, key) }
    get(key) { return this.props.fields[key] }

    subschema(key) {
        let {fields} = this.props
        if (!fields.hasOwnProperty(key))
            throw new DataError(`unknown data field "${key}", expected one of [${Object.getOwnPropertyNames(fields)}]`)
        return fields[key] || this.props.values
    }
    collect(assets) {
        for (let schema of Object.values(this.props.fields))
            schema.collect(assets)
        this.constructor.Table.collect(assets)
    }
    getValidKeys()          { return Object.getOwnPropertyNames(this.props.fields).sort() }
    displayTable(props)     { return super.displayTable({...props, value: props.item.data, start_color: 1}) }
}


/**********************************************************************************************************************
 **
 **  SCHEMA WRAPPER (schema in DB)
 **
 */

export class SchemaWrapper extends Schema {
    /* Wrapper for a schema type implemented as an item of the Schema category (object of SchemaPrototype class).
       Specifies a schema type + property values (schema constraints etc.) to be used during encoding/decoding.
     */

    static defaultProps = {
        prototype:  undefined,          // item of the Schema category (instance of SchemaPrototype) implementing `this.schema`
        properties: {},                 // properties to be passed to `prototype` to create `this.schema`
    }

    schema                              // the actual Schema instance to be used for encode/decode, provided by `prototype` during init()
    
    async init() {
        if (this.schema) return
        let {prototype, properties} = this.props
        await prototype.load()
        let {SchemaPrototype} = await import('./type_schema.js')
        assert(prototype instanceof SchemaPrototype)
        this.schema = prototype.createSchema(properties)
    }
    instanceof(cls)     { return this.schema instanceof cls }
    validate(obj)       { return this.schema.validate(obj) }
    display(props)      { return this.schema.display(props) }

    __getstate__()          { return [this.props.prototype, this.props.properties] }
    __setstate__(state)     {
        // let [id, props] = state
        // this.__props.prototype  = globalThis.registry.getItem(id)
        // this.__props.properties = props
        [this.__props.prototype, this.__props.properties] = state
        this.initProps()
        return this
    }
}

