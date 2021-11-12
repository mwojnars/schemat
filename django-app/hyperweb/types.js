import {e, A,I,P, PRE, DIV, SPAN, INPUT, TABLE, TH, TR, TD, TBODY, TEXTAREA, FRAGMENT, HTML} from './utils.js'
import { useState, useRef, useEffect, delayed_render } from './utils.js'
import { T, truncate } from './utils.js'
import { JSONx } from './serialize.js'

export class DataError extends Error {}


export class multiple {}


/**********************************************************************************************************************
 **
 **  SCHEMA base class
 **
 */

export class Schema {

    default = undefined     // default value for a RECORD field or web forms, can be missing (undefined)
    info    = null          // human-readable description of this schema: what values are accepted and how they are interpreted
    multi   = false         // if true and the schema describes a RECORD field, the field can take on multiple values
    
    constructor(params = {}) {
        let {default_, info, multi} = params || {}                      // params=null is valid
        if (info !== undefined)     this.info = info
        if (multi !== undefined)    this.multi = multi
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

    async load_json(dump) {
        let state = JSON.parse(dump)
        return await this.decode(state)
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

    async decode(state) {
        /* Convert a serializable "state" as returned by encode() back to an original custom object. */
        return await JSONx.decode(state)
    }

    toString() {
        return this.constructor.name
        // return JSON.stringify(this._fields).slice(0, 60)
    }

    Widget({value, edit = true}) {
        /* A React-compatible component that displays a `value` of an item's field and (possibly) allows its editing. */
        return value.toString()
    }
}

/**********************************************************************************************************************
 **
 **  ATOMIC schema types
 **
 */

export class GENERIC extends Schema {
    /*
    Accepts objects of any class, optionally restricted to objects whose type(obj) is equal to one of
    predefined type(s) - the `type` parameter - or the object is an instance of one of predefined base classes
    - the `base` parameter; at least one of these conditions must hold.
    If there is only one type in `type`, and an empty `base`, the type name is excluded
    from serializated output and is implied automatically during deserialization.
    Types can be given as import paths (strings), which will be automatically converted to a type object.
    */
    get _types() { return this.types || this.constructor.types || [] }

    constructor(types = [], params = {}) {
        super(params)
        if (types === null) types = []
        if (T.isClass(types)) types = [types]           // wrap up a singleton type in an array
        if (types.length) this.types = types            // base type(s) for inheritance checks: obj instanceof T
    }
    valid(obj) {
        let types = this._types
        return !types || types.length === 0 || types.filter((base) => obj instanceof base).length > 0
    }
    encode(obj) {
        if (!this.valid(obj))
            throw new DataError(`invalid object type, expected one of [${this._types.map(t => t.name)}], got ${obj} instead`)
        return JSONx.encode(obj)
    }
    async decode(state) {
        let obj = await JSONx.decode(state)
        if (!this.valid(obj))
            throw new DataError(`invalid object type after decoding, expected one of [${this._types.map(t => t.name)}], got ${obj} instead`)
        return obj
    }
    Widget({value}) {
        let state = this.encode(value)
        return JSON.stringify(state)            // GENERIC displays raw JSON representation of a value
    }
}

export class SCHEMA extends GENERIC {
    static types = [Schema]

    Widget({value}) {
        let schema = value
        let defalt = `${schema.default}`
        return SPAN({className: 'field'},
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

// the most generic schema for encoding/decoding of objects of any types
export let generic_schema = new GENERIC()


/**********************************************************************************************************************/

export class CLASS extends Schema {
    /* Accepts any global python type and encodes as a string containing its full package-module name. */
    encode(value) {
        if (value === null) return null
        return globalThis.registry.get_path(value)
    }
    async decode(value) {
        if (typeof value !== "string") throw new DataError(`expected a string after decoding, got ${value} instead`)
        return globalThis.registry.get_class(value)
    }
}

export class Primitive extends Schema {
    /* Base class for schemas of primitive JSON-serializable python types. */

    // // the predefined standard type of all app-layer values; same type for db-layer values;
    // // must be declared as a getter method to allow efficient overriding in subclasses without an instance-level copy
    // get _type() { return null }

    static type         // the predefined standard type of all app-layer values; same type for db-layer values;

    check(value) {
        let t = this.constructor.type
        if (typeof value !== t) throw new DataError(`expected a primitive value of type "${t}", got ${value} instead`)
    }
    encode(value) {
        this.check(value)
        return value
    }
    async decode(value) {
        this.check(value)
        return value
    }
}

export class BOOLEAN extends Primitive {
    static type = "boolean"
}
export class NUMBER extends Primitive {
    /* Floating-point number */
    static type = "number"
}
export class INTEGER extends NUMBER {
    /* Same as NUMBER, but with additional constraints. */
}


export class Textual extends Primitive {
    /* Intermediate base class for string-based types: STRING, TEXT, CODE. Provides common widget implementation. */
    static type = "string"

    EmptyValue() { return  I({style: {opacity: 0.3}}, "(empty)") }

    Widget({value}) {
        let [editing, setEditing] = useState(false)
        let [currentValue, setValue] = useState(value)
        let editor = useRef(null)

        const show = (e) => {
            setEditing(true)
            // editor.current.focus()
        }
        const hide = (e) => {
            setValue(editor.current.value)
            setEditing(false)
        }
        return editing ? this.Editor(currentValue, hide, editor) : this.Viewer(currentValue, show)
    }
}

export class STRING extends Textual
{
    Viewer(value, show) {
        return DIV({onDoubleClick: show}, value || this.EmptyValue())
    }
    Editor(value, hide, ref) {
        return INPUT({defaultValue: value, ref: ref, onBlur: hide,
                onKeyUp: (e) => this.acceptKey(e) && hide(),
                autoFocus: true, type: "text", style: {width:"100%"}}
        )
    }
    acceptKey(event) { return ["Enter","Escape"].includes(event.key) }
}
export class TEXT extends Textual
{
    Viewer(value, show) {
        return PRE(DIV({className: 'scroll', onDoubleClick: show},
            value || this.EmptyValue()
        ))
    }
    Editor(value, hide, ref) {
        return PRE(TEXTAREA({
            defaultValue:   value,
            ref:            ref,
            onBlur:         hide,
            onKeyUp:        (e) => this.acceptKey(e) && hide(),
            autoFocus:      true,
            rows:           1,
            wrap:           'off',
            style:          {width:'100%', height:'10em'}
        }))
    }
    acceptKey(event) { return event.key === "Escape" || (event.key === "Enter" && event.shiftKey) }
}
export class CODE extends TEXT
{
    Editor(value, hide, ref) {
        return DIV({
            defaultValue:   value,
            ref:            ref,
            onBlur:         hide,
            onKeyUp:        (e) => this.acceptKey(e) && hide(),
            autoFocus:      true,
            className:      "ace-editor",
        })
    }

    // viewer_options = {
    //     mode:           "ace/mode/haml",
    //     theme:          "ace/theme/textmate",     // dreamweaver crimson_editor
    //     readOnly:               true,
    //     showGutter:             false,
    //     displayIndentGuides:    false,
    //     showPrintMargin:        false,
    //     highlightActiveLine:    false,
    // };
    editor_options = {
        mode:           "ace/mode/haml",
        theme:          "ace/theme/textmate",     // dreamweaver crimson_editor
        showGutter:             true,
        displayIndentGuides:    true,
        showPrintMargin:        true,
        highlightActiveLine:    true,
    };

    Widget({value}) {
        let [editing, setEditing] = useState(false)
        let [currentValue, setValue] = useState(value)
        let editor_div = useRef(null)
        let editor_ace = null

        useEffect(() => {
            if (!editing) return
            // viewer_ace = this.create_editor("#view", this.view_options);
            // viewer_ace.renderer.$cursorLayer.element.style.display = "none"      // no cursor in preview editor
            // viewer_ace.session.setValue(currentValue)

            let div = editor_div.current
            editor_ace = ace.edit(div, this.editor_options)
            editor_ace.session.setValue(currentValue)
            new ResizeObserver(() => editor_ace.resize()).observe(div)      // allow resizing of the editor box by a user, must update the Ace widget then
            editor_ace.focus()
            // editor_ace.gotoLine(1)
            // editor_ace.session.setScrollTop(1)

        }, [editing])

        const show = () => setEditing(true)
        const hide = () => {
            setValue(editor_ace.session.getValue())
            setEditing(false)
        }
        return editing ? this.Editor(currentValue, hide, editor_div) : this.Viewer(currentValue, show)
    }
    // ACE editor methods/props:
    //  editor.renderer.setAnnotations()
    //  editor.resize()
    //  editor.renderer.updateFull()
    //  position:relative
    //  editor.clearSelection(1)
    //  editor.gotoLine(1)
    //  editor.getSession().setScrollTop(1)
    //  editor.blur()
    //  editor.focus()
}

export class FILENAME extends STRING {}


/**********************************************************************************************************************/

export class ITEM extends Schema {
    /*
    Reference to an Item, encoded as ID=(CID,IID), or just IID if `category` was provided.
    ITEM without parameters is equivalent to GENERIC(Item), however, ITEM can also be parameterized,
    which is not possible with an GENERIC.
    */

    constructor(category, params = {}) {
        super(params)
        if (category) this.category = category      // (optional) category of items to be encoded; undefined means all items can be encoded
    }
    get _cid() {
        // if (!T.isMissing(this.cid)) return this.cid
        return this.category ? this.category.iid : null
    }
    encode(item) {
        if (!item.has_id())
            throw new DataError(`item to be encoded has missing or incomplete ID: ${item.id}`)

        let cid = this._cid
        if (cid === null) return item.id
        if (cid === item.cid) return item.iid
        throw new DataError(`incorrect CID=${item.cid} of an item ${item}, expected CID=${cid}`)
    }
    async decode(value) {
        let ref_cid = this._cid
        let cid, iid

        if (typeof value === "number") {
            if (ref_cid === null) throw new DataError(`expected a (CID,IID) tuple, but got only IID (${iid})`)
            cid = ref_cid
            iid = value
        } else
            if (value instanceof Array && value.length === 2)
                [cid, iid] = value
            else
                throw new DataError(`expected a (CID,IID) tuple, got ${value} instead during decoding`)

        // if (cid === null) cid = ref_cid
        if (!Number.isInteger(cid)) throw new DataError(`expected CID to be an integer, got ${cid} instead during decoding`)
        if (!Number.isInteger(iid)) throw new DataError(`expected IID to be an integer, got ${iid} instead during decoding`)

        return await globalThis.registry.get_item([cid, iid])
    }

    Widget({value}) {
        return delayed_render(async () => {
            let item = value
            let url  = await item.url(null, false)
            let name = await item.get('name', '')
            let ciid = HTML(await item.ciid({html: false, brackets: false}))

            if (name && url) {
                let note = await item.category.get('name', null)
                return FRAGMENT(
                    url ? A({href: url}, name) : name,
                    SPAN({style: {fontSize:'80%', paddingLeft:'3px'}, ...(note ? {} : ciid)}, note)
                )
            } else
                return FRAGMENT('[', url ? A({href: url, ...ciid}) : SPAN(ciid), ']')
        })
    }
}

/**********************************************************************************************************************
 **
 **  COMPOUND schema types
 **
 */

export class DICT extends Schema {
    /*
    Accepts dictionaries (pure Object instances) as data values, or objects of a given `type`.
    Outputs a dict with keys and values encoded through their own schema.
    If no schema is provided, `generic_schema` is used as a default.
    */

    // the defaults are configured at class level for easy subclassing and to reduce output when this schema is serialized
    static keys_default   = generic_schema
    static values_default = generic_schema

    constructor(keys, values, type, params = {}) {
        super(params)
        if (keys)   this.keys = keys            // schema of keys of app-layer dicts
        if (values) this.values = values        // schema of values of app-layer dicts
        if (type)   this.type = type            // optional subtype of <dict>; if present, only objects of this type are accepted for encoding
    }
    encode(d) {
        let type = this.type || Object
        if (!(d instanceof type)) throw new DataError(`expected an object of type ${type}, got ${d} instead`)

        let schema_keys   = this.keys || this.constructor.keys_default
        let schema_values = this.values || this.constructor.values_default
        let state = {}

        // encode keys & values through predefined field types
        for (let [key, value] of Object.entries(d)) {
            let k = schema_keys.encode(key)
            if (k in state) throw new DataError(`two different keys encoded to the same state (${k}) in DICT, one of them: ${key}`)
            state[k] = schema_values.encode(value)
        }
        return state
    }
    async decode(state) {

        if (typeof state != "object") throw new DataError(`expected an object as state for decoding, got ${state} instead`)

        let schema_keys   = this.keys || this.constructor.keys_default
        let schema_values = this.values || this.constructor.values_default
        let d = new (this.type || Object)

        // decode keys & values through predefined field types
        for (let [key, value] of Object.entries(state)) {
            let k = await schema_keys.decode(key)
            if (k in d) throw new DataError(`two different keys of state decoded to the same key (${key}) of output object, one of them: ${k}`)
            d[k] = await schema_values.decode(value)
        }
        return d
    }
    toString() {
        let name   = this.constructor.name
        let keys   = this.keys || this.constructor.keys_default
        let values = this.values || this.constructor.values_default
        return `${name}(${keys}, ${values})`
    }
}

export class CATALOG extends DICT {
    /*
    Schema of a catalog of items.
    Similar to DICT, but assumes keys are strings; and `type`, if present, must be a subclass of <catalog>.
    Provides tight integration with the UI: convenient layout for display of items,
    and access paths for locating form validation errors.
    Watch out the reversed ordering of arguments in constructor()!
    */
    get is_catalog() { return true }
    static keys_default = new STRING

    constructor(values, keys, type, params = {}) {
        if (keys && !(keys instanceof STRING)) throw new DataError(`schema of keys must be an instance of STRING or its subclass, not ${keys}`)
        super(keys, values, type, params)
    }
    toString() {
        let name   = this.constructor.name
        let keys   = this.keys || this.constructor.keys_default
        let values = this.values || this.constructor.values_default
        if (T.ofType(keys, STRING))
            return `${name}(${values})`
        else
            return `${name}(${keys}, ${values})`
        }
}


/**********************************************************************************************************************
 **
 **  RECORD
 **
 */

export class RECORD extends Schema {
    /*
    Schema of dict-like objects that contain a number of named fields, each one having ITS OWN schema
    - unlike in DICT, where all values share the same schema.
    RECORD does not encode keys, but passes them unmodified.

    The `type` of value objects can optionally be declared, for validation and more compact output representation.
    A MultiDict can be handled as a value type through its __getstate__ and __setstate__ methods.
    */

    get _fields() { return this.fields || this.constructor.fields }
    get _strict() { return this.strict || this.constructor.strict }
    get _type  () { return this.type   || this.constructor.type   }

    static fields = {}          // dict of field names and their schema
    static strict = false       // if true, only the fields present in `fields` can occur in the data being encoded
    static type   = null        // class (or prototype?) of values (optional); if present, only instances of this exact type (not subclasses)
                                // are accepted, and an object state is retrieved/stored through Types.getstate()/setstate()

    // default field specification to be used for fields not present in `fields` (if strict=false)
    static default_schema = new GENERIC(null, {multi: true})

    constructor(fields, params = {}) {
        let {strict, type, ...base_params} = params
        super(base_params)
        if (strict !== null) this.strict = strict
        if (type)   this.type   = type
        if (fields) this.fields = fields
    }
    encode(data) {
        /* Encode & compactify values of fields through per-field schema definitions. */

        // type checking & state extraction
        let type = this._type
        if (type) {
            if (!T.ofType(data, type)) throw new DataError(`expected an object of type ${type}, got ${data}`)
            data = T.getstate(data)
        }
        else if (!T.isDict(data)) throw new DataError(`expected a plain Object for encoding, got ${T.getClassName(data)}`)

        // state encoding
        return T.mapDict(data, (name, value) => [name, this._schema(name).encode(value)])
    }
    async decode(state) {

        if (!T.isDict(state)) throw new DataError(`expected a plain Object for decoding, got ${T.getClassName(state)}`)
        let data = await T.amapDict(state, async (name, value) => [name, await this._schema(name).decode(value)])
        let type = this._type
        if (type) return T.setstate(type, data)
        return data
    }
    _schema(name) {
        let fields = this._fields
        if (this._strict && !fields.hasOwnProperty(name))
            throw new DataError(`unknown field "${name}", expected one of ${Object.getOwnPropertyNames(fields)}`)
        return T.get(fields, name) || this.constructor.default_schema
    }
}

/**********************************************************************************************************************/

// export class SCHEMA extends RECORD {
//     /* Schema of a schema specification for an item's field. */
//
//     static type = Schema
//     static fields = {
//         'default': new GENERIC,
//         'multi':   new BOOLEAN,
//         'info':    new STRING,
//     }
// }