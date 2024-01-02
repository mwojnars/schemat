// import { Temporal } from './libs/js-temporal/polyfill.js'

import { MaterialUI } from './ui/resources.js'
import { e, cl, st, useState } from './ui/react-utils.js'
import { A, B, I, P, PRE, DIV, SPAN, STYLE, INPUT, SELECT, OPTION, TEXTAREA, BUTTON, FLEX, FRAGMENT, HTML, NBSP } from './ui/react-utils.js'
import { ItemLoadingHOC } from './ui/react-utils.js'
import { T, assert, print, trycatch, truncate, concat } from './common/utils.js'
import {DataError, NotImplemented, ValueError} from './common/errors.js'
import { JSONx } from './serialize.js'
import { Catalog, Path } from './data.js'
import { Assets, Component } from './ui/component.js'
import {TypeWidget, TextualWidget, TEXT_Widget, CODE_Widget, GENERIC_Widget} from './ui/widgets.js'
import {byteLengthOfSignedInteger, byteLengthOfUnsignedInteger} from "./util/binary.js";

// print('Temporal:', Temporal)

export function is_valid_field_name(name) {
    /* Check if a string is a valid field name. Dash "-" is allowed except for the 1st character. */
    return /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name)
}


/**********************************************************************************************************************
 **
 **  TYPE base class
 **
 */

export class Type {

    isCatalog()     { return false }
    isCompound()    { return this.isCatalog() }     // "compound" type implements a custom mergeEntries(), which prevents some optimizations
    isRepeated()    { return this.props.repeated }
    isEditable()    { return this.props.editable }

    // common properties of schemas; can be utilized by subclasses or callers:
    static defaultProps = {
        info     : undefined,   // human-readable description of this type: what values are accepted and how they are interpreted
        blank    : undefined,   // if true, `null` and `undefined` are treated as a valid value: stored and then decoded as "null"
        initial  : undefined,   // initial value assigned to a newly created data element of this type
        repeated : undefined,   // if true, the field described by this type can be repeated, typically inside a CATALOG/RECORD/DATA
        default  : undefined,   // default value to be used for a non-repeated property when no explicit value was provided;
                                // since repeated properties behave like lists of varying length, and zero is a valid length,
                                // default value is NOT used for them and should be left undefined (TODO: check & enforce this constraint)

        inherit  : true,        // if false, inheritance is disabled for this field; used particularly for some system fields
        impute   : undefined,   // a function to be used for imputation of missing values; `this` references the item;
                                // only called for non-repeated properties, when `default`==undefined and there are no inherited values;
                                // the function must be *synchronous* and cannot return a Promise

        // readonly : undefined,   // if true, the field described by this type cannot be edited by the user;
        // hidden   : undefined,   // if true, the field described by this type is not displayed in the UI;

        // locked  : undefined,   // if true, the field described by this type cannot be modified by the user in the UI
        editable : true,        // if false, the field described by this type cannot be edited by the user in the UI;
                                // typically set to false for imputed fields

        immutable: undefined,   // if true, the property described by this type cannot be modified after item's creation, neither by the user nor by the system;
                                // for example, immutable=true for the `source` sequence of a derived index (to change the source you should recreate the index)

        // collation: undefined,  // collation to be used for sorting and comparison of values of this type; if undefined, the default collation is used
        // descending           // if true, the field sorts in descending order in UI and/or in DB indexes

        // TODO: to be added in the future...
        // deprecated: undefined,   // indicator that this field should no longer be used; for smooth transition from one type to another
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

    instanceof(typeClass) {
        /* Check if this type is an instance of a particular `typeClass`, OR is a TypeWrapper
           around a `typeClass` (implemented in TypeWrapper.instanceof()). */
        return this instanceof typeClass
    }

    validate(value) {
        /* Validate an object/value to be encoded, clean it up and convert to a canonical form if needed.
           Return the processed value, or raise an exception if the value is invalid.
         */
        if (value === null || value === undefined)
            if (this.props.blank) return null
            else throw new ValueError(`expected a non-blank (non-missing) value, got '${value}' instead`)
        return value
    }

    toString()      { return this.constructor.name }            //JSON.stringify(this._fields).slice(0, 60)

    combine_inherited(arrays, item) {
        /* Combine arrays of inherited values that match this type. Return an array of values.
           The arrays are either concatenated, or the values are merged into one, depending on `prop.repeated`.
           In the latter case, the default value (if present) is also included in the merge.
           `item` is an argument to downstream impute().
         */
        if (this.isRepeated()) return concat(arrays)
        let value = this.merge_inherited(arrays, item)
        return value !== undefined ? [value] : []
    }

    merge_inherited(arrays, item) {
        /* Only used for single-valued schemas (when prop.repeated == false).
           Merge multiple inherited arrays of values matching this type (TODO: check against incompatible inheritance).
           Return the merged value, or undefined if it cannot be determined.
           The merged value may include or consist of the type's imputed value (props.impute()) or default (props.default).
           Base class implementation returns the first value of `arrays`, or the default value, or imputed value.
           Subclasses may provide a different implementation - in such case the type is considered "compound"
           and should return isCompound() == true to prevent simplified merging in Item._compute_property().
         */
        assert(!this.isRepeated())
        for (let values of arrays) {
            if (!values.length) continue
            // if (values.length > 1) throw new Error("multiple values present for a key in a single-valued type")
            return values[0]
        }
        return this.impute(item)                        // if no values were found, impute a value
    }

    impute(item) {
        /* Impute a value for an `item`s field described by this type.
           This may return the default value (if present), or run the props.impute() property function.
         */
        let value = this.props.default
        if (value !== undefined) return value

        let impute = this.props.impute
        // if (typeof impute === 'string') { ... compile `impute` to a function ... }

        if (typeof impute === 'function')
            return impute.call(item)
    }

    /*** binary encoding for indexing ***/

    binary_encode(value, last = false) {
        /* Create a sort key and return as Uint8Array. If last=false and the binary representation has variable length,
           the terminator symbol/sequence or length specification should be included in the output,
           so that binary_decode() can detect the length of the encoded sequence when another value follows.
           The encoding may or may NOT be reversible, depending on the type.
           For example, it may be irreversible for some collated strings - such objects can still be used
           inside keys, but typically their original value must be stored separately in the record's value field.
         */
        throw new NotImplemented(`binary_encode() is not implemented for ${this}`)
    }

    binary_decode(input, last = false) {
        /* Decode a binary input (Uint8Array) back into an application-level value or object.
           If last=false, the encoded value may be followed by another value in the input,
           so the decoder must be able to detect the end of the encoded value by itself.
         */
        throw new NotImplemented(`binary_decode() is not implemented for ${this}`)
    }


    /***  User Interface  ***/

    // Clients should call getAssets() and display(), other methods & attrs are for internal use ...

    getAssets() {
        /* Walk through all nested Type objects, collect their CSS styles and assets and return as an Assets instance.
           this.collect() is called internally - it should be overriden in subclasses instead of this method.
         */
        let assets = new Assets()
        this.collect(assets)
        return assets
    }

    collect(assets) {
        /* For internal use. Override in subclasses to provide a custom way of collecting CSS styles & assets from all nested schemas. */
        this.Widget.collect(assets)
    }

    get Widget() {
        /* React component, a subclass of TypeWidget, that displays a value of this Type and allows its editing.
           In addition to rendering, it must provide a static method collect(assets) that collects CSS styles and assets,
           that is why it cannot be a function component.
         */
        return this.constructor.Widget
    }

    static Widget = TypeWidget
}


/**********************************************************************************************************************
 **
 **  PRIMITIVE data types
 **
 */

export class Primitive extends Type {
    /* Base class for schemas of primitive JSON-serializable python types. */

    static stype        // the predefined standard type (typeof...) of app-layer values; same type for db-layer values

    validate(value) {
        if ((value = super.validate(value)) === null) return value
        let t = this.constructor.stype
        // if (typeof value === t || (this.props.blank && (value === null || value === undefined))) return value
        if (typeof value !== t) throw new ValueError(`expected a primitive value of type "${t}", got "${typeof value}" instead (${value})`)
        return value
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
    validate(value) {
        if ((value = super.validate(value)) === null) return value
        let {min, max} = this.props
        if (min !== undefined && value < min) throw new ValueError(`the number (${value}) is out of bounds, should be >= ${min}`)
        if (max !== undefined && value > max) throw new ValueError(`the number (${value}) is out of bounds, should be <= ${max}`)
        return value
    }
}

export class INTEGER extends NUMBER {
    /* An integer value. Like a NUMBER, but with additional constraints and different binary encoding. */

    static DEFAULT_LENGTH_SIGNED = 6    // default length of the binary representation in bytes, for signed integers

    static defaultProps = {
        signed:  false,         // if true, values can be negative
        length:  undefined,     // number of bytes to be used to store values in DB indexes; adaptive encoding if undefined (for uint), or 6 (for signed int)
    }

    validate(value) {
        if ((value = super.validate(value)) === null) return value
        if (!Number.isInteger(value)) throw new ValueError(`expected an integer, got ${value} instead`)
        if (!this.props.signed && value < 0) throw new ValueError(`expected a positive integer, got ${value} instead`)
        if (value < Number.MIN_SAFE_INTEGER) throw new ValueError(`the integer (${value}) is too small to be stored in JavaScript`)
        if (value > Number.MAX_SAFE_INTEGER) throw new ValueError(`the integer (${value}) is too large to be stored in JavaScript`)
        return value
    }

    binary_encode(value, last = false) {
        value = this.validate(value)
        let {signed, length} = this.props
        if (!signed) return this._encode_uint(value, length)

        // for signed integers, shift the value range upwards and encode as unsigned
        length = length || this.constructor.DEFAULT_LENGTH_SIGNED
        value += Math.pow(2, 8*length - 1)                  // TODO: memorize all Math.pow(2,k) here and below
        assert(value >= 0)
        return this._encode_uint(value, length)
    }

    binary_decode(input, last = false) {
        let {signed, length} = this.props
        if (!signed) return this._decode_uint(input, length)

        // decode as unsigned and shift the value range downwards after decoding to restore the original signed value
        length = length || this.constructor.DEFAULT_LENGTH_SIGNED
        const shift = Math.pow(2, 8*length - 1)
        return this._decode_uint(input, length) - shift
    }

    _encode_uint(value, length = 0) {
        /* Binary encoding of an unsigned integer in a field of `length` bytes.
           If length is missing or 0, magnitude of the value is detected automatically and the value
           is encoded on the minimum required no. of bytes, between 1 and 7 (larger values exceed MAX_SAFE_INTEGER)
           - in such case the detected byte length is written to the output in the first byte.
         */
        const {blank} = this.props
        const adaptive = !length
        const offset = adaptive ? 1 : 0

        if (!blank) assert(value !== null)

        if (adaptive)
            length = (value !== null) ? byteLengthOfUnsignedInteger(value) : 0          // length=0 encodes null in adaptive mode
        else if (blank)
            if (value === null) value = 0                       // in non-adaptive mode, 0 is reserved for "null", hence shifting all values by +1
            else value += 1

        const buffer = new Uint8Array(length + offset)          // +1 for the length byte in adaptive mode
        if (adaptive) buffer[0] = length

        for (let i = offset + length - 1; i >= offset; i--) {
            buffer[i] = value & 0xFF
            value = Math.floor(value / 256)             // bitwise ops (value >>= 8) are incorrect for higher bytes
        }
        return buffer
    }

    _decode_uint(input, length = 0) {
        /* `input` must be a BinaryInput. */
        const {blank} = this.props
        const adaptive = !length
        const offset = adaptive ? 1 : 0
        const buffer = input.current()

        if (adaptive) length = buffer[0]

        let value = 0
        for (let i = 0; i < length; i++)
            value += buffer[offset + i] * Math.pow(2, 8 * (length - i - 1))
            // value = (value << 8) | buffer[i]

        if (adaptive && length === 0) {
            assert(blank)
            value = null                                        // length=0 encodes null in adaptive mode
        }

        if (!adaptive && blank)
            if (value === 0) value = null                       // in non-adaptive mode, 0 is reserved for "null"
            else value -= 1

        input.move(length + offset)
        return value
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
        // collator                 // optional collator object that defines the sort order and provides a (possibly one-way!) binary encoding for indexing
        // charcase: false,         // 'upper'/'lower' - only upper/lower case characters allowed
    }

    static Widget = TextualWidget
}

export class STRING extends Textual {
    validate(value) {
        return super.validate(value).trim()             // trim leading/trailing whitespace
    }
}
export class URL extends STRING {
    /* For now, URL type does NOT check if the string is a valid URL, only modifies the display to make the string a hyperlink. */
    static Widget = class extends TextualWidget {
        view(v) { return A({href: v}, v) }
    }
}

export class TEXT extends Textual
{
    static Widget = TEXT_Widget
}

export class CODE extends TEXT
{
    static Widget = CODE_Widget
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

    validate(value) {
        if ((value = super.validate(value)) === null) return value
        if (!(value instanceof Date)) throw new ValueError(`expected a Date, got ${value} instead`)
        return value
    }
}

export class DATETIME extends STRING {
    /* Date+time. May contain a timezone specification. Serialized to a string. */
}

/**********************************************************************************************************************
 **
 **  ATOMIC data types
 **
 */

export class GENERIC extends Type {
    /* Accept objects of any class, optionally restricted to the instances of this.type or this.constructor.type. */

    static defaultProps = {
        class: undefined,
        //types: undefined,
        inherit: false,
    }

    validate(obj) {
        if ((obj = super.validate(obj)) === null) return obj
        let {class: class_} = this.props
        if (class_ && !(obj instanceof class_))
            throw new ValueError(`invalid object type, expected an instance of ${class_}, got ${obj} instead`)
        return obj
        // let types = this._types
        // return !types || types.length === 0 || types.filter((base) => obj instanceof base).length > 0
    }

    static Widget = GENERIC_Widget
}

// the most generic type for encoding/decoding of objects of any types
export let generic_type = new GENERIC()
export let generic_string = new STRING()


/**********************************************************************************************************************/

export class TYPE extends GENERIC {
    static defaultProps = {class: Type}

    static Widget = class extends GENERIC_Widget {
        scope = 'TYPE'
        static style = () => this.safeCSS({stopper: '|'})
        `
            .default|   { color: #888; }
            .info|      { font-style: italic; }
        `
        viewer()  { return TypeWidget.prototype.viewer.call(this) }
        view() {
            let {value: type} = this.props
            if (type instanceof TypeWrapper) {
                if (!type.real_type) return "TypeWrapper (not loaded)"
                type = type.real_type
            }
            let dflt = `${type.props.default}`
            return SPAN(`${type}`,
                    type.props.default !== undefined &&
                        SPAN(cl('default'), {title: `default value: ${truncate(dflt,1000)}`}, ` (${truncate(dflt,100)})`),
                    type.props.info &&
                        SPAN(cl('info'), ` • ${type.props.info}`),   // smaller dot: &middot;  larger dot: •
                    )
        }
    }
}

export class CLASS extends GENERIC {
    /* Accept objects that represent classes to be encoded through Classpath. */

    validate(cls) {
        if ((cls = super.validate(cls)) === null) return cls
        if (!T.isClass(cls)) throw new ValueError(`expected a class, got ${cls} instead`)
        return cls
    }
}

// export class FIELD extends TYPE {
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
//       1) impute on read -- similar to using a category default when value missing (but there, the value is declared with a type)
//       2) impute on write
//     */
// }

/**********************************************************************************************************************/

export class ITEM extends Type {
    /*
    Reference to an Item, encoded as {"@": id} during serialization through JSONx.
    ITEM without parameters is equivalent to GENERIC(Item), however, ITEM can also be parameterized,
    which is not possible with a GENERIC.
    */
    static defaultProps = {
        category:  undefined,       // base category for all the items to be encoded
        exact:     false,           // if true, the items must belong to this exact `category`, not any of its subcategories
    }

    static Widget = ItemLoadingHOC(class extends TypeWidget {
        view() {
            let {value: item, loaded} = this.props      // `loaded` function is provided by a HOC wrapper, ItemLoadingHOC
            if (!loaded(item))                          // SSR outputs "loading..." only (no actual item loading), hence warnings must be suppressed client-side
                return SPAN({suppressHydrationWarning: true}, "loading...")

            let url = item.url()
            let name = item.name
            let stamp = HTML(item.make_stamp({html: false, brackets: false}))

            if (name && url) {
                let note = item._category_.name || null
                return SPAN(
                    url ? A({href: url}, name) : name,
                    SPAN({style: {fontSize:'80%', paddingLeft:'3px'}, ...(note ? {} : stamp)}, note)
                )
            } else
                return SPAN('[', url ? A({href: url, ...stamp}) : SPAN(stamp), ']')
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
    //     let stamp = HTML(item.make_stamp({html: false, brackets: false}))
    //
    //     if (name && url) {
    //         let note = item.category.get('name', null)
    //         return SPAN(
    //             url ? A({href: url}, name) : name,
    //             SPAN({style: {fontSize:'80%', paddingLeft:'3px'}, ...(note ? {} : stamp)}, note)
    //         )
    //     } else
    //         return SPAN('[', url ? A({href: url, ...stamp}) : SPAN(stamp), ']')
    // }
}


/**********************************************************************************************************************
 **
 **  COMPOUND data types
 **
 */

export class MAP extends Type {
    /*
    Accepts plain objects as data values, or objects of a given `type`.
    Outputs an object with keys and values encoded through their own type.
    If no type is provided, `generic_type` is used as a default for values, or STRING() for keys.
    */

    static defaultProps = {
        class:      Object,                     // class of input objects
        keys:       new STRING(),               // Type of keys of app-layer dicts
        values:     generic_type,             // Type of values of app-layer dicts
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

export class RECORD extends Type {
    /*
    Data type of dict-like objects that contain a number of named fields, each one having ITS OWN type
    - unlike in MAP, where all values share the same type. RECORD does not encode keys, but passes them unmodified.
    `this.type`, if present, is an exact class (NOT a base class) of accepted objects.
    */

    static defaultProps = {
        class:  undefined,
        fields: {},                     // object containing field names and their schemas
    }

    collect(assets) {
        for (let type of Object.values(this.props.fields))
            type.collect(assets)
    }
}

/**********************************************************************************************************************
 **
 **  CATALOG & DATA
 **
 */

export class CATALOG extends Type {
    /*
    Data type of objects of the Catalog class or its subclass.
    Validates each `value` of a catalog's entry through a particular "subtype" - the subtype may depend
    on the entry's key, or be shared by all entries regardless of the key.

    The type instance may restrict the set of permitted keys in different ways:
    - require that a key name belongs to a predefined set of "fields"
    - no duplicate key names (across all non-missing names)
    - no duplicates for a particular key name -- encoded in the key's subtype, subtype.repeated=false
    other constraints:
    - mandatory keys (empty key='' allowed)
    - empty key not allowed (by default key_empty_allowed=false)
    - keys not allowed (what about labels then?)
     */

    isCatalog() { return true }

    static defaultProps = {
        keys:       new STRING({blank: true}),      // Type of all keys in the catalog; must be an instance of STRING or its subclass; mainly for validation
        values:     new GENERIC({multi: true}),     // Type of all values in the catalog
        initial:    () => new Catalog(),
        repeated:   false,                          // typically, CATALOG fields are not repeated, so that their content gets merged during inheritance (which requires repeated=false)
        // keys_mandatory : false,
        // keys_forbidden : false,
        // keys_unique    : false,
        // keys_empty_ok  : false,
    }

    subtype(key)  { return this.props.values }    // Type of values of a `key`; subclasses should throw an exception or return undefined if `key` is not allowed
    getValidKeys()  { return undefined }

    constructor(props = {}) {
        super(props)
        let {keys} = props
        if (keys && !(keys.instanceof(STRING))) throw new DataError(`data type of keys must be an instance of STRING or its subclass, not ${keys}`)
    }

    collect(assets) {
        this.props.keys.collect(assets)
        this.props.values.collect(assets)
        CatalogTable.collect(assets)
    }

    toString() {
        let name = this.constructor.name
        let {keys, values} = this.props
        if (T.ofType(keys, STRING))  return `${name}(${values})`
        else                         return `${name}(${values}, ${keys})`
    }

    find(path = null) {
        /* Return a (nested) type at a given `path`, or `this` if `path` is empty.
           The path is an array of keys on subsequent levels of nesting, some keys can be missing (null/undefined)
           if the corresponding subcatalog accepts this. The path may span nested CATALOGs at arbitrary depths.
         */
        return Path.find(this, path, (type, key) => {
            if (!type.isCatalog()) throw new Error(`data type path not found: ${path}`)
            return [type.subtype(key)]
        })
    }

    merge_inherited(arrays, item) {
        let values = concat(arrays)
        if (!values.length) return this.impute(item)

        // include the default value in the merge, if present
        let default_ = this.props.default
        let catalogs = (default_ !== undefined) ? [...values, default_] : values

        return Catalog.merge(catalogs, !this.isRepeated())          // merge all values (catalogs) into a single catalog

        // TODO: inside Catalog.merge(), if repeated=false, overlapping values should be merged recursively
        //       through combine() of props.values type
    }

    display_table(props) { return e(CatalogTable, {path: [], type: this, ...props}) }
}

class CatalogTable extends Component {
    /* React class component that displays a Catalog in a tabular form. */

    static scope = 'CATALOG'
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

    move(up, down) {
        let hide = st({visibility: 'hidden'})
        return DIV(cl('move'),
                   DIV(cl('moveup'),   {onClick: e => up(),   title: "Move up"},   !up   && hide),
                   DIV(cl('movedown'), {onClick: e => down(), title: "Move down"}, !down && hide))
    }
    delete(action)  { return DIV(cl('delete'), {onClick: action, title: "Delete this entry"}) }

    // info(type)    { return type.info ? {title: type.info} : null }
    //     if (!type.info) return null
    //     return I(cl('icon-info'), {title: type.info}, '?')
    //     // return I(cl('icon-info material-icons'), {title: type.info}, 'help_outline') //'question_mark','\ue88e','info'
    //     // return I(cl("bi bi-info-circle icon-info"), {title: type.info})
    //     // return I(cl("icon-info"), st({fontFamily: 'bootstrap-icons !important'}), {title: type.info}, '\uf431')
    //     // let text = FRAGMENT(type.info, '\n', A({href: "./readmore"}, "read more..."))
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
        let widget = (entry.id === 'new') ? CatalogTable.NewKeyWidget : CatalogTable.KeyWidget
        let props  = {value: current, flash, error, save: initKey || save, keyNames, type: generic_string}

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

    static KeyWidget = class extends TextualWidget {
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

    static NewKeyWidget = class extends CatalogTable.KeyWidget {
        static defaultProps = {
            editing:  true,         // this widget starts in edit mode
        }
        reject(e)   { this.props.save(undefined) }      // save() must be called to inform that no initial value was provided
    }

    EntryAtomic({item, path, entry, type, ops}) {
        /* A table row containing an atomic entry: a key and its value (not a subcatalog).
           The argument `key_` must have a "_" in its name to avoid collision with React's special prop, "key".
           `entry.value` and `type` can be undefined for a newly created entry, then no value widget is displayed.
           If value is undefined, but type is present, the value is displayed as "missing".
         */
        // useState() treats function arguments in a special way, that's why we must wrap up classes and functions in an array
        let wrap = (T.isClass(entry.value) || T.isFunction(entry.value))

        let [value, setValue] = useState(wrap ? [entry.value] : entry.value)
        let isnew = (value === undefined) || entry.saveNew

        const save = async (newValue) => {
            // print(`save: path [${path}], value ${newValue}, type ${type}`)
            let action = entry.saveNew || ops.updateValue       // saveNew: an entire entry is saved for the first time
            await action(newValue)
            setValue(newValue)
        }
        let [flash, flashBox] = this.flash()            // components for value editing; for key editing created in key() instead
        let [error, errorBox] = this.error()
        let props = {value: wrap && T.isArray(value) ? value[0] : value,
                     editing: isnew,                    // a newly created entry (no value) starts in edit mode
                     save, flash, error, type}

        let valueElement = type && this.embed(type.Widget, props)

        return DIV(cl('entry-head'),
                  DIV(cl('cell cell-key'),   this.key(entry, type?.props.info, ops)),
                  DIV(cl('cell cell-value'), valueElement, flashBox, errorBox),
               )
    }

    EntrySubcat({item, path, entry, type, color, ops}) {
        let [folded, setFolded] = useState(false)
        let subcat = entry.value
        let empty  = false //!subcat.length   -- this becomes INVALID when entries are inserted/deleted inside `subcat`
        let toggle = () => !empty && setFolded(f => !f)
        let expand = {state: empty && 'empty' || folded && 'folded' || 'expanded', toggle}
        let key    = this.key(entry, type?.props.info, ops, expand)

        return FRAGMENT(
            DIV(cl('entry-head'), {key: 'head'},
                DIV(cl('cell cell-key'), key, folded ? null : st({borderRight:'none'})),
                DIV(cl('cell cell-value'))
            ),
            DIV({key: 'cat'}, folded && st({display: 'none'}),
                e(this.Catalog, {item, path, value: subcat, type, color})),
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

    // validKey(pos, key, entries, type) {
    //     /* Check that the key name at position `pos` in `entries` is allowed to be changed to `key`
    //        according to the `type`; return true, or alert the user and raise an exception. */
    //     // verify that a `key` name is allowed by the catalog's type
    //     let subtype = trycatch(() => type.subtype(key))
    //     if (!subtype) {
    //         let msg = `The name "${key}" for a key is not permitted by the type.`
    //         alert(msg); throw new Error(msg)
    //     }
    //     // check against duplicate names, if duplicates are not allowed
    //     if (!subtype.repeated)
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

            let type = trycatch(() => catalogSchema.subtype(key))
            if (key !== undefined && !type) {                  // verify if `key` name is allowed by the parent catalog
                alert(`The name "${key}" for a key is not permitted.`)
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

                let value = type.getInitial()
                let ids = [-1, ...prev.map(e => e.id)]
                let id  = Math.max(...ids.filter(Number.isInteger)) + 1     // IDs are needed internally as keys in React subcomponents
                prev[pos] = {id, key, value}

                if (type.isCatalog()) item.action.insert_field(path, pos, {key, value: JSONx.encode(value) })
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
        updateValue: (pos, newValue, type) => {
            return item.action.update_field([...path, pos], {value: JSONx.encode(newValue)})
        }
    }}

    Catalog({item, value, type, path, color, start_color}) {
        /* If `start_color` is undefined, the same `color` is used for all rows. */
        assert(value instanceof Catalog)
        assert(type.instanceof(CATALOG))

        let catalog  = value
        let getColor = pos => start_color ? 1 + (start_color + pos - 1) % 2 : color

        // `id` of an entry is used to identify subcomponents through React's "key" property
        let [entries, setEntries] = useState(catalog.getEntries().map((ent, pos) => ({...ent, id: pos})))
        let run = this.actions({item, path, setEntries})

        let keyNames = type.getValidKeys()
        let N = entries.length

        let rows = entries.map((entry, pos) =>
        {
            let {key}   = entry
            let isnew   = (entry.id === 'new')
            let vschema = isnew ? undefined : type.subtype(key)
            let color   = getColor(pos)

            // insert `pos` as the 1st arg in all actions of `run`
            let ops     = T.mapDict(run, (name, fun) => [name, (...args) => fun(pos, ...args)])

            // some actions in `ops` must be defined separately
            ops.moveup   = pos > 0   ? () => run.move(pos,-1) : null        // moveup() is only present if there is a position available above
            ops.movedown = pos < N-1 ? () => run.move(pos,+1) : null        // similar for movedown()
            ops.initKey  = isnew ? key => run.initKey(pos, key, type) : null
            ops.keyNames = keyNames
            ops.updateValue = val => run.updateValue(pos, val, vschema)

            let props   = {item, path: [...path, pos], entry, type: vschema, color, ops}
            let row     = e(vschema?.isCatalog() ? this.EntrySubcat : this.EntryAtomic, props)
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
    /* Like CATALOG, but provides distinct value types for different predefined keys (fields) of a catalog.
       Primarily used as a data type for Item.data, not intended for other uses.
     */

    static defaultProps = {
        fields: {},             // object with field names and their types; null means a default data type should be used for a given field
        strict: true,           // if true, only fields listed in `fields` are allowed; generic_type is assumed for other fields
    }

    isValidKey(key) {
        return is_valid_field_name(key) && (!this.props.strict || Object.hasOwn(this.props.fields, key))
    }

    get(key) { return this.props.fields[key] || (!this.props.strict && generic_type) || undefined }

    subtype(key) {
        let {fields} = this.props
        if (!fields.hasOwnProperty(key))
            throw new DataError(`unknown data field "${key}", expected one of [${Object.getOwnPropertyNames(fields)}]`)
        return fields[key] || this.props.values
    }
    collect(assets) {
        for (let type of this._all_subtypes())
            type.collect(assets)
        CatalogTable.collect(assets)
    }
    _all_subtypes() { return Object.values(this.props.fields) }

    getValidKeys() {
        let fields = Object.getOwnPropertyNames(this.props.fields)
        fields = fields.filter(f => this.props.fields[f].isEditable())      // only keep user-editable fields
        return fields.sort()
    }

    display_table(props)   { return super.display_table({value: props.item._data_, start_color: 1, ...props}) }
}

export class DATA_GENERIC extends DATA {
    /* Generic item's DATA schema, used when there's no category for an item. */
    static defaultProps = {
        fields: {},
        strict: false,
    }
    subtype(key)  { return this.props.fields[key] || generic_type }
    _all_subtypes()  { return [...super._all_subtypes(), generic_type] }
}


export class ITEM_SCHEMA extends TYPE {
    /* An (imputed) instance of DATA schema for items in a category (the category's `fields` combined into a DATA instance). */

    static defaultProps = {
        editable: false,
        impute() {
            /* `this` is expected to be a Category object that defines items' schema through its `fields` property. */
            // assert(this instanceof Category)
            let fields = this.fields
            let custom = this.allow_custom_fields
            return new DATA({fields: fields.object(), strict: custom !== true})
        }
    }
}

/**********************************************************************************************************************/

// export class VIRTUAL_FIELD extends Type {
//     /* A virtual field is a field that is not stored in the database, but is computed on the fly from other fields.
//        It is used to implement computed fields, such as "name" for a person (first_name + last_name).
//        The value is computed lazily (upon request) by a function `compute` that takes the item as an argument.
//        By default, the computed value is cached. To disable caching, set `cache` to false.
//      */
//
//     static defaultProps = {
//         compute:    undefined,          // function(item) that computes the value of the field
//         cache:      true,               // if true, the computed value is cached
//     }
//
//     cache = undefined                   // cached computed value of the field
//
//     compute(item) {
//         if (this.cache !== undefined) return this.cache
//         let {compute, cache} = this.props
//         if (!compute) throw new DataError(`virtual field ${this.name} has no compute() function`)
//         let value = compute(item)
//         if (cache) this.cache = value
//         return value
//     }
// }
//
// export class VIRTUAL_ITEM_SCHEMA extends VIRTUAL_FIELD {
// }


/**********************************************************************************************************************
 **
 **  TYPE WRAPPER (data type stored in DB)
 **
 */

export class TypeWrapper extends Type {
    /* Wrapper for a data type implemented as an item of the Type category (object of TypeItem class).
       Specifies a type item + property values (type constraints etc.).
     */

    static defaultProps = {
        type_item:  undefined,          // item of the Type category (instance of TypeItem) implementing this.real_type
        properties: {},                 // properties to be passed to `type_item` to create this.real_type
    }

    real_type                           // the actual Type instance provided by `type_item` during init()
    
    async init() {
        if (this.real_type) return
        let {type_item, properties} = this.props
        await type_item.load()
        let {TypeItem} = await import('./type_item.js')
        assert(type_item instanceof TypeItem)
        this.real_type = await type_item.create_real_type(properties)
    }
    instanceof(cls)     { return this.real_type instanceof cls }
    validate(obj)       { return this.real_type.validate(obj) }
    display(props)      { return this.real_type.display(props) }

    __getstate__()          { return [this.props.type_item, this.props.properties] }
    __setstate__(state)     {
        [this.__props.type_item, this.__props.properties] = state
        this.initProps()
        return this
    }
}

