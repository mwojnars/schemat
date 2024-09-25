import {A} from '../web/react-utils.js'
import {assert, concat, print, T} from '../common/utils.js'
import {ValidationError, NotImplemented, ValueError} from '../common/errors.js'
import {byteLengthOfUnsignedInteger} from "../util/binary.js";
import * as widgets from './widgets.js'

// import { Temporal } from './libs/js-temporal/polyfill.js'
// print('Temporal:', Temporal)  -- improved data struct for date/time handling


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

    isCATALOG()     { return false }
    // isCompound() { return this.isCATALOG() }     // "compound" type implements a custom mergeEntries(), which prevents some optimizations
    isRepeated()    { return this.props.repeated }
    isEditable()    { return this.props.editable }

    // common properties of value types; can be utilized by subclasses or callers:
    static defaultProps = {
        info     : undefined,   // human-readable description of this type: what values are accepted and how they are interpreted
        blank    : undefined,   // if true, `null` and `undefined` are treated as a valid value: stored and then decoded as "null"
        class    : undefined,   // if present, all values (except blank) must be instances of this JS class
        initial  : undefined,   // initial value assigned to a newly created data element of this type
        default  : undefined,   // default value to be used for a non-repeated property when no explicit value was provided;
                                // since repeated properties behave like lists of varying length, and zero is a valid length,
                                // default value is NOT used for them and should be left undefined (TODO: check & enforce this constraint)

        repeated : undefined,   // if true, the field described by this type can have multiple occurrences, typically inside a CATALOG/RECORD/DATA
                                // - all the values (incl. inherited ones) can be retrieved via .field$ then; note that setting repeated=true has performance impact,
                                // as the inheritance chain must be inspected every time, even when an occurrence was already found in the child object;
                                // repeated fields of type CATALOG provide special behavior: they get merged altogether during the property's value computation

        inherit  : true,        // if false, inheritance is disabled for this field; used particularly for some system fields
        impute   : undefined,   // a function to be used for imputation of missing values; `this` references the item;
                                // only called for non-repeated properties, when `default`==undefined and there are no inherited values;
                                // the function must be *synchronous* and cannot return a Promise

        // virtual : undefined,    // if true, the field only supports imputation and cannot be directly assigned to
        // persisted : undefined   // if true, the imputed value of the field (virtual or regular) is being stored in the DB to avoid future recalculation or facilitate indexing
        // required : undefined,   // if true, the field described by this type must be present in the record or object's data during insert/update

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

    static default_props() {
        /* Return all defaultProps from the prototype chain combined. */
        return Object.assign({}, ...T.getInherited(this, 'defaultProps'))
    }

    __props = {}                // own properties of this type instance (without defaults)
    props                       // all properties of this type instance: own + defaults  (this.__props + constructor.props)


    constructor(props = {}) {
        this.__props = props || {}      // props=null/undefined is also valid
        this.initProps()
    }

    init() {}                   // called from Category.init(); subclasses should override this method as async to perform asynchronous initialization

    initProps() {
        /* Create this.props by combining the constructor's defaultProps (own and inherited) with own props (this.__props). */
        this.props = {...this.constructor.default_props(), ...this.__props}
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

        let class_ = this.props.class
        if (class_ && !(obj instanceof class_))
            throw new ValueError(`expected an instance of ${class_}, got ${obj} instead`)

        return this._validate(value)
    }

    _validate(value) {
        /* Subclasses should override this method instead of validate(). This method  is only called after `value`
           was already checked against blanks and an incorrect class, so the subclass may assume that the value
           is non-blank and of the proper class. Every subclass implementation should first execute:
              value = super._validate(value)
           to allow for any super-class validation and normalization to take place.
         */
        return value
    }

    toString()      { return this.constructor.name }            //JSON.stringify(this._fields).slice(0, 60)

    combine_inherited(arrays, obj = null) {
        /* Combine arrays of inherited values that match this type. Return an array of values.
           The arrays are either concatenated, or the values are merged into one, depending on `prop.repeated`.
           In the latter case, the default value (if present) is also included in the merge.
           `obj` is an argument to downstream impute().
         */
        if (this.isRepeated()) return concat(arrays)
        let value = this.merge_inherited(arrays, obj)
        return value !== undefined ? [value] : []
    }

    merge_inherited(arrays, obj = null) {
        /* Only used for single-valued schemas (when prop.repeated == false).
           Merge multiple inherited arrays of values matching this type (TODO: check against incompatible inheritance).
           Return the merged value, or undefined if it cannot be determined.
           The merged value may include or consist of the type's imputed value (props.impute()) or default (props.default).
           Base class implementation returns the first value of `arrays`, or the default value, or imputed value.
           Only the CATALOG and its subclasses provide a different implementation that performs a merge of catalogs
           across all prototypes of a given object.
         */
        assert(!this.isRepeated())
        for (let values of arrays) {
            if (!values.length) continue
            // if (values.length > 1) throw new Error("multiple values present for a key in a single-valued type")
            return values[0]
        }
        return this._impute(obj)                        // if no values were found, use `default` or impute()
    }

    _impute(obj = null) {
        /* Impute a value for an object`s field described by this type. This may return the default value (if present),
           or run the props.impute() function, or run the obj[props.impute] method on the target object.
         */
        let {default: value, impute} = this.props
        if (value !== undefined) return value
        if (!impute || !obj) return undefined

        if (typeof impute === 'function')
            return impute.call(obj, obj)                // impute() function may take `obj` via `this` or via regular argument
        if (typeof impute === 'string')
            return obj[impute]?.call(obj)

        throw new Error(`incorrect type of 'impute' property`)
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

    collect(assets) {
        /* Walk through all nested Type objects, widgets and components, collect their CSS styles and assets,
           and store them in the provided Assets instance (`assets`). Override in subclasses.
         */
        this.Widget.collect(assets)
    }

    get Widget() {
        /* React component, a subclass of TypeWidget, that displays a value of this Type and allows its editing.
           In addition to rendering, it must provide a static method collect(assets) that collects CSS styles and assets,
           that is why it cannot be a function component.
         */
        return this.constructor.Widget
    }

    static Widget = widgets.TypeWidget
}


/**********************************************************************************************************************
 **
 **  PRIMITIVE data types
 **
 */

export class Primitive extends Type {
    /* Base class for schemas of primitive JSON-serializable python types. */

    static stype        // the predefined standard type (typeof...) of app-layer values; same type for db-layer values

    _validate(value) {
        let t = this.constructor.stype
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
        // initial: 0,
        min:            undefined,         // minimum value allowed (>=)
        max:            undefined,         // maximum value allowed (<=)
        min_decimals:   0,
        max_decimals:   undefined,
    }
    _validate(value) {
        value = super._validate(value)
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

    _validate(value) {
        value = super._validate(value)
        if (!Number.isInteger(value)) throw new ValueError(`expected an integer, got ${value} instead`)
        if (!this.props.signed && value < 0) throw new ValueError(`expected a positive integer, got ${value} instead`)
        if (value < Number.MIN_SAFE_INTEGER) throw new ValueError(`the integer (${value}) is too small to be stored in JavaScript`)
        if (value > Number.MAX_SAFE_INTEGER) throw new ValueError(`the integer (${value}) is too large to be stored in JavaScript`)
        return value
    }

    binary_encode(value, last = false) {
        value = this.validate(value)
        let {signed, length} = this.props
        if (!signed) return this.encode_uint(value, length)

        // for signed integers, shift the value range upwards and encode as unsigned
        length = length || this.constructor.DEFAULT_LENGTH_SIGNED
        value += Math.pow(2, 8*length - 1)                  // TODO: memorize all Math.pow(2,k) here and below
        assert(value >= 0)
        return this.encode_uint(value, length)
    }

    binary_decode(input, last = false) {
        let {signed, length} = this.props
        if (!signed) return this.decode_uint(input, length)

        // decode as unsigned and shift the value range downwards after decoding to restore the original signed value
        length = length || this.constructor.DEFAULT_LENGTH_SIGNED
        const shift = Math.pow(2, 8*length - 1)
        return this.decode_uint(input, length) - shift
    }

    encode_uint(value, length = 0) {
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

    decode_uint(input, length = 0) {
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

    static Widget = widgets.TextualWidget
}

export class STRING extends Textual {
    static defaultProps = {
        trim: true,                 // if true (default), the strings are trimmed before insertion to DB
    }
    _validate(value) {
        value = super._validate(value)
        return this.props.trim ? value.trim() : value           // trim leading/trailing whitespace
    }
}
export class URL extends STRING {
    /* For now, URL type does NOT check if the string is a valid URL, only modifies the display to make the string a hyperlink. */
    static Widget = class extends widgets.TextualWidget {
        view(v) { return A({href: v}, v) }
    }
}

export class TEXT extends Textual
{
    static Widget = widgets.TEXT_Widget
}

export class CODE extends TEXT
{
    static Widget = widgets.CODE_Widget
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

    _validate(value) {
        value = super._validate(value)
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

    static Widget = widgets.GENERIC_Widget
}

// the most generic type for encoding/decoding of objects of any types
export let generic_type = new GENERIC()
export let generic_string = new STRING()


/**********************************************************************************************************************/

export class TYPE extends GENERIC {
    static defaultProps = {class: Type}
    static Widget = widgets.TYPE_Widget
}

// export class CLASS extends GENERIC {
//     /* Accept objects that represent classes to be encoded through Classpath. */
//
//     _validate(cls) {
//         cls = super._validate(cls)
//         if (!T.isClass(cls)) throw new ValueError(`expected a class, got ${cls} instead`)
//         return cls
//     }
// }

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

export class REF extends Type {
    /*
    Reference to an Item, encoded as {"@": id} during serialization through JSONx.
    REF without parameters is equivalent to GENERIC(Item), however, REF can also be parameterized,
    which is not possible with a GENERIC.
    */
    static defaultProps = {
        category:  undefined,       // base category for all the items to be encoded
        exact:     false,           // if true, the items must belong to this exact `category`, not any of its subcategories
    }
    static Widget = widgets.REF_Widget

    _validate(obj) {
        obj = super._validate(obj)
        // TODO: check that props.category.__id is present in the list of object's ancestors, obj.__ancestor_ids
        return obj
    }
}


/**********************************************************************************************************************
 **
 **  COMPOUND data types
 **
 */

export class ARRAY extends GENERIC {
    /* Represents arrays of objects, all of the same type (`type`, generic_type by default). */

    static defaultProps = {
        type: generic_type,                 // type of all elements in the array, as a Type instance
    }

    collect(assets) {
        this.props.type.collect(assets)
    }

    _validate(value) {
        value = super._validate(value)
        if (!Array.isArray(value)) throw new ValueError(`expected an array, got ${typeof value}`)
        return value.map(elem => this.props.type.validate(elem))
    }

    toString() {
        return `${this.constructor.name}(${this.props.type})`
    }
}

 
export class MAP extends Type {
    /*
    Accepts plain objects as data values, or objects of a given `type`.
    Outputs an object with keys and values encoded through their own type.
    If no type is provided, `generic_type` is used as a default for values, or STRING() for keys.
    */

    static defaultProps = {
        class:      Object,                     // class of input objects
        keys:       new STRING(),               // Type of keys of app-layer dicts
        values:     generic_type,               // Type of values of app-layer dicts
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
        fields: {},                     // object containing field names and their schemas
    }

    collect(assets) {
        for (let type of Object.values(this.props.fields))
            type.collect(assets)
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
//         if (!compute) throw new ValidationError(`virtual field ${this.name} has no compute() function`)
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
        // let {TypeItem} = await import('./type_item.js')
        // assert(type_item instanceof TypeItem, type_item)
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

