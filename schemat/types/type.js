import {A} from '../web/react-utils.js'
import {assert, concat, print, T} from '../common/utils.js'
import {ValidationError, NotImplemented, ValueError} from '../common/errors.js'
import {bytes_uint} from "../common/binary.js";
import {Shard} from "../common/structs.js";
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
    isRepeated()    { return this.options.repeated }
    isEditable()    { return this.options.editable }

    static options = {              // configuration options shared by all types...
        info     : undefined,       // human-readable description of this type: what values are accepted and how they are interpreted
        blank    : true,            // if true, `null` and `undefined` are treated as a valid value: both are stored and decoded as "null"
        class    : undefined,       // if present, all values (except blank) must be instances of this JS class
        initial  : undefined,       // initial value assigned to a newly created data element of this type
        default  : undefined,       // default value to be used for a non-repeated property when no explicit value was provided;
                                    // since repeated properties behave like lists of varying length, and zero is a valid length,
                                    // default value is NOT used for them and should be left undefined (TODO: check & enforce this constraint)

        repeated : undefined,       // if true, the field described by this type can have multiple occurrences, typically inside a CATALOG/RECORD/SCHEMA
                                    // - all the values (incl. inherited ones) can be retrieved via .field$ then; note that setting repeated=true has performance impact,
                                    // as the inheritance chain must be inspected every time, even when an occurrence was already found in the child object;
                                    // repeated fields of type CATALOG provide special behavior: they get merged altogether during the property's value computation

        inherit  : true,            // if false, inheritance is disabled for this field; used especially for some system fields
        impute   : undefined,       // name of function to be used for imputation of missing values; inside the function, `this` references the containing object;
                                    // only called for non-repeated properties, when `default`==undefined and there are no inherited values;
                                    // the function must be *synchronous* and cannot return a Promise; if the property value is present in DB, no imputation is done (!),
                                    // unlike with a getter method (getter=true) which overshadows all in-DB values simply because the getter uses the same JS attribute name

        getter   : undefined,       // if true, the value of the object's corresponding property is imputed from the same-named getter method of the object;
                                    // similar to impute=true, but does not require explicit function designation, and the function is implemented as a getter which can be more intuitive;
                                    // although the getter method (if present) hides any persisted value of the property, assigning to the property is *allowed* because the getter method may not be universally present (say, it exists in a subclass, but not in the base class);
                                    // having a getter alone, without it being explicitly declared as a property with a type, in many cases is good enough, but prevents the property from being used in indexes (missing type definition);
                                    // this option only has effect for top-level properties of web objects

        alias    : undefined,       // name of a property that this one is an alias for; all reads and writes are redirected to the aliased property; only for top-level properties of web objects

        // virtual  : undefined,       // if true, the field is never stored in DB and cannot be directly assigned to, impute() or default value is used instead;
        //                             // when virtual=true, inheritance is skipped during property calculation like if inherit=false

        // explicit / persistent: false  // if true, the imputed value of the field (virtual or regular) is being stored in the DB to avoid future recalculation or facilitate indexing
        // required : undefined,   // if true, the field described by this type must be present in the record or object's data during insert/update

        // readonly : undefined,   // if true, the field described by this type cannot be edited by the user;
        // hidden   : undefined,   // if true, the field described by this type is not displayed in the UI;
        // deprecated: undefined,  // indicator that this field should no longer be used; for smooth transition from one type to another

        // locked  : undefined,   // if true, the field described by this type cannot be modified by the user in the UI
        editable : true,        // if false, the field described by this type cannot be edited by the user in the UI;
                                // typically set to false for imputed fields

        immutable: undefined,   // if true, the property described by this type cannot be modified after item's creation, neither by the user nor by the system;
                                // for example, immutable=true for the `source` sequence of a derived index (to change the source you should recreate the index)

        // collation: undefined,  // collation to be used for sorting and comparison of values of this type; if undefined, the default collation is used
        // descending           // if true, the field sorts in descending order in UI and/or in DB indexes
    }

    static default_props() {
        /* Return all options from the prototype chain combined. */
        return Object.assign({}, ...T.getInherited(this, 'options'))
    }

    _options = {}               // own config options of this type instance (without defaults)
    options                     // all config options of this type instance: own + defaults  (this._options + constructor.options)


    constructor(options = {}) {
        this._options = options || {}       // options=null/undefined is also valid
        this._init_options()
    }

    init() {}                   // called from Category.init(); subclasses should override this method as async to perform asynchronous initialization

    _init_options() {
        /* Create this.options by combining the constructor's default options (own and inherited) with instance options (this._options). */
        this.options = {...this.constructor.default_props(), ...this._options}
    }

    __getstate__()      { return this._options }

    static __setstate__(state) {
        assert(T.isPOJO(state))
        return new this(state)
    }

    get_initial() {
        /* `options.initial` can be a value or a function; this method provides support for both cases. */
        let {initial} = this.options //this.constructor.initial
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
            if (this.options.blank) return null
            else throw new ValueError(`expected a non-blank (non-missing) value, got '${value}' instead`)

        let class_ = this.options.class
        if (class_ && !(value instanceof class_))
            throw new ValueError(`expected an instance of ${class_}, got ${value} instead`)

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

    combine_inherited(arrays, obj, prop) {
        /* Combine arrays of inherited values that match this type. Return an array of values.
           The arrays are either concatenated, or the values are merged into one, depending on `prop.repeated`.
           In the latter case, the default value (if present) is also included in the merge.
           `obj` is an argument to downstream impute().
         */
        if (this.isRepeated()) return concat(arrays)
        let value = this.merge_inherited(arrays, obj, prop)
        return value !== undefined ? [value] : []
    }

    merge_inherited(arrays, obj, prop) {
        /* Only used for single-valued schemas (when prop.repeated == false).
           Merge multiple inherited arrays of values matching this type (TODO: check against incompatible inheritance).
           Return the merged value, or undefined if it cannot be determined.
           The merged value may include or consist of the type's imputed value (options.impute()) or default (options.default).
           Base class implementation returns the first value of `arrays`, or the default value, or impute()
           Only the CATALOG and its subclasses provide a different implementation that performs a merge of catalogs
           across all prototypes of a given object.
         */
        assert(!this.isRepeated())
        for (let values of arrays) {
            if (values.length) return values[0]
            // if (values.length > 1) throw new Error("multiple values present for a key in a single-valued type")
        }
        return this._impute(obj, prop)                      // if no value found, use impute/getter/default to impute one
    }

    _impute(obj, prop) {
        /* Calculate and return the imputed value for an object's property `prop` described by this type.
           This may run the options.impute() function, or the obj[options.impute] method on the target object,
           or use obj[prop] if options.getter=true, or return the options.default value.
         */
        let {default: default_, impute, getter} = this.options
        if (!obj) return default_

        if (impute) {
            if (typeof impute === 'function')
                return impute.call(obj, obj)                // impute() function may take `obj` via `this` or via regular argument
            if (typeof impute === 'string') {
                let method = obj[impute]
                if (typeof method === 'function') return method.call(obj)
                if (method !== undefined) throw new Error(`incorrect value of 'impute' option (${impute}), expected a method name`)
            }
            else throw new Error(`incorrect type of 'impute' option (${typeof impute})`)
        }

        if (getter) {
            let value = obj[prop]
            if (value !== undefined) return value
        }

        return default_
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

    toString() { return this.constructor.name }         //JSON.stringify(this._fields).slice(0, 60)

    label() {
        /* May return a string or a React component for display on admin page. */
        return `${this}`
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
 **  GENERIC data type
 **
 */

export class GENERIC extends Type {
    /* Accept all types of values like the base Type, but display them with a generic JSON widget. */
    static Widget = widgets.GENERIC_Widget
}

// the most generic type for encoding/decoding of objects of any types
export let generic_type = new GENERIC({repeated: true})


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
    static options = {initial: false}
}

export class NUMBER extends Primitive {
    /* Floating-point number */
    static stype = "number"
    static options = {
        // initial: 0,
        min:            undefined,         // minimum value allowed (>=)
        max:            undefined,         // maximum value allowed (<=)
        min_decimals:   0,
        max_decimals:   undefined,
        accept_string:  true,
    }
    _validate(value) {
        value = super._validate(value)
        let {accept_string, min, max} = this.options
        if (accept_string && typeof value === 'string') value = Number(value)
        if (min !== undefined && value < min) throw new ValueError(`the number (${value}) is out of bounds, should be >= ${min}`)
        if (max !== undefined && value > max) throw new ValueError(`the number (${value}) is out of bounds, should be <= ${max}`)
        return value
    }
}

export class INTEGER extends NUMBER {
    /* An integer value. Like a NUMBER, but with additional constraints and different binary encoding. */

    static DEFAULT_LENGTH_SIGNED = 6    // default length of the binary representation in bytes, for signed integers

    static options = {
        signed:  false,         // if true, values can be negative
        length:  undefined,     // number of bytes to be used to store values in DB indexes; adaptive encoding if undefined (for uint), or 6 (for signed int)
    }

    _validate(value) {
        value = super._validate(value)
        if (!Number.isInteger(value)) throw new ValueError(`expected an integer, got ${value} instead`)
        if (!this.options.signed && value < 0) throw new ValueError(`expected a positive integer, got ${value} instead`)
        if (value < Number.MIN_SAFE_INTEGER) throw new ValueError(`the integer (${value}) is too small to be stored in JavaScript`)
        if (value > Number.MAX_SAFE_INTEGER) throw new ValueError(`the integer (${value}) is too large to be stored in JavaScript`)
        return value
    }

    binary_encode(value, last = false) {
        value = this.validate(value)
        let {signed, length} = this.options
        if (!signed) return this.encode_uint(value, length)

        // for signed integers, shift the value range upwards and encode as unsigned
        length = length || this.constructor.DEFAULT_LENGTH_SIGNED
        value += Math.pow(2, 8*length - 1)                  // TODO: memorize all Math.pow(2,k) here and below
        assert(value >= 0)
        return this.encode_uint(value, length)
    }

    binary_decode(input, last = false) {
        let {signed, length} = this.options
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
        const {blank} = this.options
        const adaptive = !length
        const offset = adaptive ? 1 : 0

        if (!blank) assert(value !== null)

        if (adaptive)
            length = (value !== null) ? bytes_uint(value) : 0   // length=0 encodes null in adaptive mode
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
        const {blank} = this.options
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

export class ID extends INTEGER {
    /* Database ID of an object. */
    static options = {
        min: 1,
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
    static options = {
        initial:    '',
        charset:    undefined,
        // collator                 // optional collator object that defines the sort order and provides a (possibly one-way!) binary encoding for indexing
        // charcase: false,         // 'upper'/'lower' - only upper/lower case characters allowed
    }

    _validate(str) {
        str = super._validate(str)
        let {charset} = this.options
        if (charset) {
            let regex = new RegExp(`^[${charset}]*$`, 'u')
            if (!regex.test(str)) throw new ValueError(`some characters are outside the charset (${charset})`)
        }
        return str
    }

    static Widget = widgets.TextualWidget
}

export class STRING extends Textual {
    static options = {
        trim: true,                 // if true (default), the strings are trimmed before insertion to DB
    }
    _validate(str) {
        str = super._validate(str)
        return this.options.trim ? str.trim() : str               // trim leading/trailing whitespace
    }
}

export let generic_string = new STRING()


export class FIELD extends STRING {
    /* A STRING than only contains alphanumeric characters (Unicode allowed!), "_" and "-",
       but no punctuation, spaces or control chars.
     */
    static options = {charset: 'a-zA-Z0-9_\\-\\p{L}\\p{N}'}
}

export class IDENTIFIER extends STRING {
    /* A STRING than only contains ASCII alphanumeric characters and "_", but no punctuation, "-", spaces or control chars. */
    static options = {charset: 'a-zA-Z0-9_'}
}

export class URL extends STRING {
    /* URL type that allows URLs with or without protocol. The Widget automatically appends the protocol if needed. */

    // basic URL validation using a regular expression that allows URLs without protocol
    static pattern = /^([a-z]{3,6}:\/\/)?((([a-z\d]([a-z\d-]*[a-z\d])*)\.)+[a-z]{2,}|((\d{1,3}\.){3}\d{1,3}))(\:\d+)?(\/[-a-z\d%_.~+]*)*(\?[;&a-z\d%_.~+=-]*)?(\#[-a-z\d_]*)?$/i
    
    _validate(url) {
        url = super._validate(url)
        if (!this.constructor.pattern.test(url)) throw new ValueError(`invalid URL: ${url}`)
        return url
    }

    static Widget = class extends widgets.TextualWidget {
        view(v) {
            let href = v.includes('://') ? v : 'https://' + v
            return A({href}, v)
        }
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

export class IMPORT extends STRING {
    /* Import path of the form "a/b/c.../file.js" or ".../file.js:object_name", pointing to a module or a symbol
       (class, function etc.) inside a JS module.
     */
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
 **  OTHER atomic data types
 **
 */

export class BINARY extends GENERIC {
    /* Type of Uint8Array objects. */
    static options = {class: Uint8Array}
}

export class TYPE extends GENERIC {
    static options = {class: Type}
    static Widget = widgets.TYPE_Widget
}

export class CUSTOM_OBJECT extends GENERIC {
    /* Accept objects of a given `class` (Object by default), with optional validation of their attributes. */
    static options = {
        class:  Object,
        strict: true,           // if true, and `attrs` is defined, the object must not have any own attributes beyond those specified in attrs
        attrs:  undefined,      // optional plain object interpreted as a dictionary of allowed attributes, {attr: type};
                                // values of attributes are *not* replaced during validation
    }
    _validate(obj) {
        obj = super._validate(obj)
        let {attrs, strict} = this.options
        if (!attrs) return obj
        if (strict)
            for (let attr of Object.keys(obj))
                if (!(attr in attrs)) throw new ValueError(`object has unexpected attribute '${attr}'`)
        for (let attr of Object.keys(attrs))
            attrs[attr].validate(obj[attr])
        return obj
    }
}

export class SHARD extends CUSTOM_OBJECT {
    /* Accept objects of the Shard class. */
    static options = {
        class: Shard,
        attrs: {
            offset: new INTEGER({min: 0}),
            base:   new INTEGER({min: 1}),
        }
    }
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

/**********************************************************************************************************************/

export class REF extends Type {
    /* Reference to a WebObject, encoded as {"@": id} during serialization through JSONx.
       REF without parameters is equivalent to GENERIC(WebObject), however, REF can also be parameterized,
       which is not possible with a GENERIC.
     */
    static options = {
        category:  undefined,       // base category for all the items to be encoded
        exact:     false,           // if true, the items must belong to this exact `category`, not any of its subcategories
    }
    static Widget = widgets.REF_Widget

    _validate(obj) {
        obj = super._validate(obj)
        if (!(obj instanceof schemat.WebObject)) throw new ValueError(`expected a WebObject, got ${obj} instead`)
        if (!obj.id) throw new ValueError(`found a reference to a newborn object (no ID): ${obj}`)
        if (obj.id < 0) throw new ValueError(`found a reference to an object with provisional ID=${obj.id} (${obj})`)
        // TODO: check that options.category.id is present in the list of object's ancestors, obj.__ancestor_ids
        return obj
    }
}

export class REF_CATEGORY extends REF {
    _init_options() {
        super._init_options()
        this.options.category ??= schemat.root_category
    }
}


/**********************************************************************************************************************
 **
 **  COMPOUND data types
 **
 */

export class CHOICE extends Type {
    /* List of choices, the value must be one of them. */
    static options = {
        values: [],             // eligible choice values
    }
}


export class VARIANT extends Type {
    /* Selection from a number of predefined (sub)types. The value must be a plain object of the form {choice: value},
       where `choice` is one of the eligible choice names, and `value` matches this choice's corresponding type.
     */
    static options = {
        choices: {},            // plain object interpreted as a dictionary of choices, {choice-name: type-definition}
    }
}


export class ARRAY extends GENERIC {
    /* Represents arrays of objects of a given `type` (generic_type by default). */

    static options = {
        type: generic_type,         // type of all elements in the array, as a Type instance
    }
    static Widget = widgets.ARRAY_Widget

    collect(assets) {
        this.options.type.collect(assets)
    }

    _validate(value) {
        value = super._validate(value)
        if (!Array.isArray(value)) throw new ValueError(`expected an array, got ${typeof value}`)
        return value.map(elem => this.options.type.validate(elem))
    }

    toString() {
        return `${this.constructor.name}(${this.options.type})`
    }
}

 
export class MAP extends Type {
    /*
    Accepts plain objects as data values, or objects of a given `type`.
    Outputs an object with keys and values encoded through their own type.
    If no type is provided, `generic_type` is used as a default for values, or STRING() for keys.
    */

    static options = {
        class:      Object,                     // class of input objects
        keys:       new STRING(),               // Type of keys of app-layer dicts
        values:     generic_type,               // Type of values of app-layer dicts
    }

    collect(assets) {
        this.options.keys.collect(assets)
        this.options.values.collect(assets)
    }

    toString() {
        let name   = this.constructor.name
        return `${name}(${this.options.values}, ${this.options.keys})`
    }
}


export class OBJECT extends GENERIC {
    /* Accept plain JavaScript objects used as data containers. The objects must *not* belong to any class other than Object.
       This type can be used as a replacement for MAP or CATALOG, when a simpler data structure is needed for holding
       a collection of named attributes. During inheritance, OBJECT-type objects can be merged, with younger attributes
       overriding the older ones in case of name conflict.
     */
}


export class RECORD extends Type {
    /*
    Value type for data objects containing some predefined fields, each one having ITS OWN type
    - unlike in a MAP, where all values share the same type.
    `this.type`, if present, is an exact class (NOT a base class) of accepted objects.
    */

    static options = {
        fields: {},                     // object containing field names and their schemas
    }

    collect(assets) {
        for (let type of Object.values(this.options.fields))
            type.collect(assets)
    }
}


/**********************************************************************************************************************
 **
 **  TYPE WRAPPER (data type stored in DB)
 **
 */

export class TypeWrapper extends Type {
    /* Wrapper for a data type implemented as an item of the Type category (object of TypeItem class).
       Specifies a type item + property values (type constraints etc.).
     */

    static options = {
        type_item:  undefined,          // web object of the Type category (instance of TypeItem) implementing this.real_type
        options: {},                    // config options to be passed to `type_item` to create this.real_type
    }

    real_type                           // the actual Type instance provided by `type_item` during init()
    
    async init() {
        if (this.real_type) return
        let {type_item, options} = this.options
        await type_item.load()
        // let {TypeItem} = await import('./type_item.js')
        // assert(type_item instanceof TypeItem, type_item)
        this.real_type = await type_item.create_real_type(options)
    }
    instanceof(cls)     { return this.real_type instanceof cls }
    validate(obj)       { return this.real_type.validate(obj) }
    display(props)      { return this.real_type.display(props) }

    __getstate__()          { return [this.options.type_item, this.options.options] }
    __setstate__(state)     {
        // TODO: convert to a static method
        [this._options.type_item, this._options.options] = state
        this._init_options()
        return this
    }
}

