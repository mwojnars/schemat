import {e, A, I, P, PRE, DIV, SPAN, STYLE, INPUT, TEXTAREA, FRAGMENT, HTML, cssPrepend} from './react-utils.js'
import { React, createRef, useState, useRef, useEffect, useItemLoading, delayed_render, ItemLoadingHOC } from './react-utils.js'
import { T, assert, print, truncate, DataError, ItemNotLoaded } from './utils.js'
import { JSONx } from './serialize.js'
import { Catalog } from './data.js'


/**********************************************************************************************************************
 **
 **  WIDGETS
 **
 */

class Styles {
    /* Collection of CSS snippets that are appended one by one with add() and then deduplicated
       and converted to a single snippet in getCSS().
     */
    styles = new Set()

    get size()      { return this.styles.size }
    add(style)      { if (style) this.styles.add(style.trimEnd() + '\n') }
    getCSS()        { return '\n' + [...this.styles].join('') }
}

/**********************************************************************************************************************/

class Widget extends React.Component {
    /* A React class-based component that defines API for defining and collecting CSS styles of the component. */

    static style(scope = undefined) {
        /* Optional CSS styling that should be included at least once in a page along with the widget.
           Parameterized by the CSS `scope`: a path string that's prepended to all selectors for better scoping.
           In subclasses, it's recommended to use cssPrepend() function for prepending the `scope`.
         */
    }
    static collectStyles(styles, scope = undefined) {
        /* Walk through a prototype chain of `this` (a subclass) to collect .style() of all base classes into a Styles() object. */
        let proto = this
        while (proto && proto !== Widget) {
            if (!proto.style) continue
            styles.add(proto.style(scope))
            proto = Object.getPrototypeOf(proto)
        }
    }
}

class Layout extends Widget {
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

    check(value) { if (!this.valid(value)) throw new DataError("Invalid") }
    valid(value) { return false }

    dump_json(value, format = {}) {
        /*
        JSON-encoding proceeds in two phases:
        1) reduction of the original `value` (with nested objects) to a smaller `flat` object using any external
           type information that's available; the flat object may still contain nested non-primitive objects;
        2) encoding of the `flat` object through json.dumps(); external type information is no longer used.
        */
        let {replacer, space} = json_format
        let state = this.encode(value)
        return JSON.stringify(state, replacer, space)
    }

    load_json(dump) {
        let state = JSON.parse(dump)
        return this.decode(state)
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

    toString()          { return this.constructor.name }     //JSON.stringify(this._fields).slice(0, 60)

    /***  UI  ***/

    // Clients should call getStyle() and display(), other methods & attrs are for internal use ...

    static Widget = class extends Widget {
        /* Base class for UI "view-edit" widgets that display and let users edit atomic (non-catalog) values of a specific schema.
           The default implementation falls back to a functional implementation, schema.widget(),
           or utilizes predefined methods, viewer() & editor(), of the subclass.
         */
        static style(scope = ".Schema") {           // TODO: make `scope` a class-level attribute
            /* */
            return cssPrepend(scope) `
            .flash { padding:5px 15px; border-radius: 3px; color:white; opacity:1; position: absolute; top:-7px; right:-20px; z-index:10; }
            .flash-good { background-color: mediumseagreen; transition: 0.2s; }
            .flash-warn { background-color: salmon; transition: 0.2s; }
            .flash-stop { opacity: 0; z-index: -1; transition: 5s linear; transition-property: opacity, background-color, z-index; }
        `}

        static defaultProps = {
            schema: undefined,          // parent Schema instance
            value:  undefined,          // value object to be displayed by render()
            save:   undefined,          // function save(newValue) to be called after `value` was edited by user
        }
        constructor(props) {
            super(props)
            this.input = createRef()
            this.state = { ...this.state,
                editing:  false,
                value:    props.value,      // internal state of the editor preserved by close() even after rejection (!)
                flashMsg: null,             // flash message displayed after accept/reject
                flashCls: null,             // css class to be applied to flash box
            }
        }

        editor() { throw new Error("not implemented") }
        viewer() {
            /* By default, calls .widget() of a parent schema. Override in subclasses with a custom viewer implementation. */
            let {schema, ...props} = this.props
            return e(schema.widget.bind(schema), props)
        }

        open(e)         { this.setState({editing: true})  }                 // activate the editor and editing mode
        close(value)    { this.setState({editing: false, value}) }          // close the editor, store `value` internally but don't send to parent

        flash() {
            return DIV({
                    className: 'flash ' + (this.state.flashCls || 'flash-stop'),
                    onTransitionEnd: () => this.setState({flashCls: null}),
                },
                this.state.flashMsg)
        }
        notify(msg, positive = true) {
            this.setState({flashMsg: msg, flashCls: positive ? 'flash-good' : 'flash-warn'})
        }

        // confirm()
        key(e) {
                 if (this.keyAccept(e)) this.accept(e)
            else if (this.keyReject(e)) this.reject(e)
        }
        accept(e) {
            // e.preventDefault()
            let value = this.value()
            this.close(value)
            this.save(value)
        }
        reject(e) {                                         // rejected value is still preserved in state.value and reused on next open()
            let value = this.value()
            this.close(value)
            if (value !== this.props.value) this.notify("NOT SAVED", false)
        }
        save(value) {                                       // notify a new value to the parent
            if (value === this.props.value) return
            this.props.save(value)
            this.notify("SAVED")
        }

        render() {
            let block = this.state.editing ? this.editor() : this.viewer()
            return DIV({className: 'Schema', style: {position: 'relative'}}, block, this.flash())
        }
    }

    widget(props) {
        /* Functional component that is used as a .viewer() inside Widget if the latter is missing in a subclass.
           Does NOT provide a way to define css styles, unlike Widget.
           Subclasses may assume `this` is bound when this method is called.
         */
        return props.value.toString()
    }

    display(props) {
        return e(this.constructor.Widget, {schema: this, ...props})
        // let Widget = this.constructor.Widget || this.widget.bind(this)
        // return e(Widget, props)
    }

    getStyle() {
        /* Walk through all nested schema objects, collect their CSS styles and return as a Styles instance.
           this.collectStyles() is called internally - it should be overriden in subclasses instead of this method.
         */
        let style = new Styles()
        this.collectStyles(style)
        return style
    }
    collectStyles(styles) {
        /* For internal use. Override in subclasses to provide a custom way of collecting CSS styles from all nested schemas. */
        styles.add(this.constructor.Widget.collectStyles(styles))
        // styles.add(this.constructor.Widget.style())
    }
}

class TextWidget extends Schema.Widget {
    /* Universal text widget that can be configured to display and edit:
       - strings (one line),
       - plain text (multiline),
       - source code (with syntax highlighting),
       - rich text.
     */
    // this.props.editorType = 'string', 'text', 'code' (Ace), 'rich' (~Word)
    // this.props.editorMode = 'plain', 'json', 'yaml', 'markdown' ...
    // NOTE: re-mount after props change can be enforced by changing props.key - https://stackoverflow.com/a/48451229/1202674
}

class ObjectWidget extends Schema.Widget {
    /* Universal widget for structured data. The viewer displays a css-styled text summary,
       while the editor is a web form corresponding to the object's schema, displayed inline or in a modal box. */
}

/**********************************************************************************************************************
 **
 **  ATOMIC schema types
 **
 */

export class GENERIC extends Schema {
    /* Accept objects of any class, optionally restricted to the instances of this.type or this.constructor.type. */

    get _type() { return this.type || this.constructor.type }

    valid(obj) {
        return !this._type || obj instanceof this._type
        // let types = this._types
        // return !types || types.length === 0 || types.filter((base) => obj instanceof base).length > 0
    }
    encode(obj) {
        if (!this.valid(obj))
            throw new DataError(`invalid object type, expected an instance of ${this._type}, got ${obj} instead`)
            // throw new DataError(`invalid object type, expected one of [${this._types.map(t => t.name)}], got ${obj} instead`)
        return JSONx.encode(obj)
    }
    decode(state) {
        let obj = JSONx.decode(state)
        if (!this.valid(obj))
            throw new DataError(`invalid object type after decoding, expected an instance of ${this._type}, got ${obj} instead`)
            // throw new DataError(`invalid object type after decoding, expected one of [${this._types.map(t => t.name)}], got ${obj} instead`)
        return obj
    }

    static Widget = class extends Schema.Widget {
        viewer() {
            let {value, schema} = this.props
            let state = schema.encode(value)
            return JSON.stringify(state)            // GENERIC displays raw JSON representation of a value
        }
    }
}

// the most generic schema for encoding/decoding of objects of any types
export let generic_schema = new GENERIC()


/**********************************************************************************************************************/

export class SCHEMA extends GENERIC {
    static type = Schema

    static Widget = class extends GENERIC.Widget {
        static style(scope = '.Schema .SCHEMA') {       // TODO: automatically prepend scope of base classes (.Schema)
            return cssPrepend(scope) `
            .default { color: #888; }
            .info { font-style: italic; }
        `}

        viewer() {
            let {value: schema} = this.props
            let defalt = `${schema.default}`
            return SPAN({className: 'SCHEMA'},
                    `${schema}`,
                    schema.default !== undefined &&
                        SPAN({className: 'default', title: `default value: ${truncate(defalt,1000)}`},
                            ` (${truncate(defalt,100)})`),
                    schema.info &&
                        SPAN({className: 'info'}, ` • ${schema.info}`),
                        // smaller dot: &middot;
                        // larger dot: •
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

export class Primitive extends Schema {
    /* Base class for schemas of primitive JSON-serializable python types. */

    static stype        // the predefined standard type (typeof...) of app-layer values; same type for db-layer values

    check(value) {
        let t = this.constructor.stype
        if (typeof value === t || (this.blank && (value === null || value === undefined)))
            return true
        throw new DataError(`expected a primitive value of type "${t}", got ${value} instead`)
    }
    encode(value) {
        this.check(value)
        if (value === undefined) return null
        return value
    }
    decode(value) {
        this.check(value)
        return value
    }
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

        init()      { return this.props.value || this.empty() }
        empty()     { return I({style: {opacity: 0.3}}, "(empty)") }
        viewer()    { return DIV({onDoubleClick: e => this.open(e)}, this.init()) }
        editor()    { return INPUT({
                        defaultValue:   this.state.value, 
                        ref:            this.input, 
                        onKeyDown:      e => this.key(e),
                        onBlur:         e => this.reject(e),
                        autoFocus:      true,
                        type:           "text", 
                        style:          {width: "100%"},
                        })
                    }

        keyAccept(e)    { return e.key === "Enter"  }           // return true if the key pressed accepts the edits
        keyReject(e)    { return e.key === "Escape" }           // return true if the key pressed rejects the edits
        value()         { return this.input.current.value }     // retrieve an edited value from the editor
    }
}

export class STRING extends Textual {}

export class TEXT extends Textual
{
    static Widget = class extends Textual.Widget {
        viewer() { return PRE(DIV({className: 'use-scroll', onDoubleClick: e => this.open(e)}, this.init())) }
        editor() {
            return PRE(TEXTAREA({
                defaultValue:   this.state.value,
                ref:            this.input,
                onKeyDown:      e => this.key(e),
                onBlur:         e => this.reject(e),
                autoFocus:      true,
                rows:           1,
                wrap:           'off',
                style:          {width:'100%', height:'10em'}
            }))
        }
        keyAccept(e)    { return e.key === "Enter" && e.ctrlKey }       //e.shiftKey
        keyReject(e)    { return e.key === "Escape" }
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

        editorAce                               // an ACE editor object
        observer                                // a ResizeObserver to watch for user resizing the editor box

        editor() {
            return DIV({
                defaultValue:   this.state.value,
                ref:            this.input,
                autoFocus:      true,
                onKeyDown:      e => this.key(e),
                onBlur:         e => this.reject(e),
                className:      "ace-editor",
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
            editorAce.session.setValue(this.state.value)
            // editorAce.setTheme("ace/theme/textmate")
            // editorAce.session.setMode("ace/mode/javascript")

            this.observer = new ResizeObserver(() => editorAce.resize())
            this.observer.observe(div)                   // allow resizing of the editor box by a user, must update the Ace widget then

            editorAce.focus()
            // editorAce.gotoLine(1)
            // editorAce.session.setScrollTop(1)
        }

        value()      { return this.editorAce.session.getValue() }
        close(value) {
            super.close(value)
            this.editorAce.destroy()                   // destroy the ACE editor to free up resources
            this.observer.disconnect()
            delete this.editorAce
            delete this.observer
        }
    }
}

export class FILENAME extends STRING {}


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
    collectStyles(styles) {
        this._keys.collectStyles(styles)
        this._values.collectStyles(styles)
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
    collectStyles(styles) {
        for (let schema of Object.values(this.fields))
            schema.collectStyles(styles)
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

    get _keys() { return this.keys || this.constructor.keys_default }
    _schema()   { return this.values || this.constructor.values_default }

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
        let cat = new Catalog()
        let schema_keys = this._keys
        for (let [key, value] of Object.entries(state)) {
            key = schema_keys.decode(key)
            value = this._schema(key).decode(value)
            cat.set(key, value)
        }
        return cat
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

    collectStyles(styles) {
        this._keys.collectStyles(styles)
        this._schema().collectStyles(styles)
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
}

export class DATA extends CATALOG {
    /* Like CATALOG, but provides distinct value schemas for different predefined keys (fields) of a catalog.
       Primarily used for encoding Item.data. Not intended for other uses.
     */
    fields         // dict of field names and their schema; null for a key means a default schema should be used

    constructor(fields, keys = null, params = {}) {
        super(null, keys, params)
        this.fields = fields
    }
    _schema(key) {
        if (!this.fields.hasOwnProperty(key))
            throw new DataError(`unknown field "${key}", expected one of ${Object.getOwnPropertyNames(this.fields)}`)
        return this.fields[key] || this.constructor.values_default
    }
    collectStyles(styles) {
        for (let schema of Object.values(this.fields))
            schema.collectStyles(styles)
    }
}


/**********************************************************************************************************************/

