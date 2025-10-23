import {A, cl, DIV, st} from '../web/react-utils.js'
import {assert, print, T} from '../common/utils.js'
import {ValidationError, NotImplemented, ValueError} from '../common/errors.js'
import {encode_uint, decode_uint, encode_int, decode_int} from "../common/binary.js";
import {ObjectsMap, Shard} from "../common/structs.js";
import {Catalog, Struct} from "../common/catalog.js";
import * as widgets from './widgets.js'
import {Component} from "../web/component.js";

let CatalogTable = import('./catalog_type.js').then(mod => {CatalogTable = mod.CatalogTable})



export function is_valid_field_name(name) {
    /* Check if a string is a valid field name. Dash "-" is allowed except for the 1st character. */
    return /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name)
}


/**********************************************************************************************************************
 **
 **  TYPE base class
 **
 */

export class Type extends Struct {

    is_compound()    { return false }   // compound types implement custom merge_inherited(), which prevents some optimizations
    is_dictionary()  { return false }
    is_CATALOG()     { return false }

    is_editable()    { return this.options.editable }

    // configuration options: some of them are used internally by the type itself, some others serve as annotations
    // that are read and used by other parts of the code; additional options can be defined in Type subclasses
    static options = {
        info     : undefined,       // human-readable description of this type: what values are accepted and how they are interpreted
        class    : undefined,       // if present, all values (except blank) must be instances of this JS class
        initial  : undefined,       // initial value to be proposed in the UI for a newly created element of this type
        default  : undefined,       // default value of a single-valued property when no explicit value was provided; appended to the list of (multiple) values in case of a multivalued property

        required : undefined,       // if true, the attribute/field described by this type must be present (not undefined)
        not_null : true,            // if true, `null` is not accepted as a valid value
        not_blank: true,            // if true, the value must be not-null and not-blank (type.is_blank(val)); missing values are accepted unless required=true
        // blank_as : undefined,       // if defined, its value (typically, `null`) is used as a replacement for blank values
        // null_as  : undefined,       // if defined, its value (typically, something like "") is used as a replacement for null values

        multiple : undefined,       // if true, the field described by this type can take on multiple values, typically inside a CATALOG/RECORD/SCHEMA;
                                    // all values (incl. inherited ones) can be retrieved via .field$; note that setting multiple=true has performance impact,
                                    // because inheritance tree must be inspected even when an occurrence was found in the child object

        inherited: true,            // if false, inheritance is disabled for this field (applied to certain system fields)
        mergeable: undefined,       // if true, and repeated=false, inherited values of this type get merged (merge_inherited()) rather than replaced with the youngest one

        impute   : undefined,       // a function or method name that should be called to impute the value if missing (f(obj) or obj.f());
                                    // only called when `default` is undefined and there are no explicit (inherited) values;
                                    // the function must be synchronous; if the property has value in DB, no imputation is done, unlike with
                                    // a getter method (getter=true) which overshadows all in-DB values simply because the getter occupies the same JS attribute

        virtual  : undefined,       // if true, the field cannot be directly assigned to, nor saved in DB, but still can be used in indexes (?);
                                    // when accessed, the value is generated with a getter, impute(), or default;
                                    // when virtual=true, inheritance is skipped during property calculation like if inherited=false

        alias    : undefined,       // name of a property that this one is an alias for; all reads and writes are redirected to the aliased property; only for top-level properties of web objects

        // setter                   // if true, the property's value is never saved in __data nor DB, but passed instead to a setter method, which may write to other props

        // save_imputed / impute_on_write / explicit / persistent: false  // if true, the imputed value of the field (virtual or regular) is saved to DB to avoid future recalculation or to facilitate indexing

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
        /* Return all options from the prototype chain combined, excluding undefined values. */
        const merged = Object.assign({}, ...T.getInherited(this, 'options'))
        return Object.fromEntries(Object.entries(merged).filter(([_, v]) => v !== undefined))   // remove explicit `undefined` values
    }

    _options = {}               // own config options of this type instance (without defaults)
    options                     // all config options of this type instance: own + defaults  (this._options + constructor.options)


    /***  Instantiation  ***/

    constructor(options = {}) {
        super()
        this._options = options || {}       // options=null/undefined is also valid
        this._init_options()
    }

    init() {}                   // called from Category.init(); subclasses should override this method as async to perform asynchronous initialization

    _init_options() {
        /* Create this.options by combining the constructor's default options (own and inherited) with instance options (this._options). */
        this.options = {...this.constructor.default_props(), ...this._options}
    }

    remove_option(...names) {
        /* Remove an own option(s) and revert its value to default. */
        for (let name of names) delete this._options[name]
        this._init_options()
    }

    instanceof(typeClass) {
        /* Check if this type is an instance of a particular `typeClass`, OR is a TypeWrapper
           around a `typeClass` (implemented in TypeWrapper.instanceof()). */
        return this instanceof typeClass
    }

    child(key)      { return this.subtype(key) }
    subtype(key)    {}
        /* In compound types, return the Type of values stored under `key`, or undefined if `key` is not allowed. */


    /***  Serialization of self  ***/

    __getstate__() { return this._options }

    static __setstate__(state) {
        assert(T.isPOJO(state))
        return new this(state)
    }


    /***  Validation of values  ***/

    is_blank(value) {
        /* Returns true if `value` is "empty", that is, it should be treated similar as null
           and rejected when required=true, like sometimes '' for strings or [] for arrays.
           Subclasses may override this behavior. No need to test against `null`, it is always treated as blank.
        */
        return false
    }

    validate(value) {
        /* Validate an object/value to be encoded, clean it up and convert to a canonical form if needed.
           Return the processed value, or raise an exception if the value is invalid.
         */
        if (value === undefined) throw new ValueError(`expected a value, got undefined`)

        let {not_null, not_blank, class: class_} = this.options
        let blank = (value == null) || this.is_blank(value)

        if (not_null && value == null) throw new ValueError(`expected a non-null value`)
        if (not_blank && blank) throw new ValueError(`expected a non-blank value`)
        if (class_ && !(value instanceof class_)) throw new ValueError(`expected instance of ${class_}, got ${value}`)

        if (blank) return undefined         // blank values are removed from record

        return value
    }

    // _validate(value) {
    //     /* Subclasses should override this method instead of validate(). This method  is only called after `value`
    //        was already checked against blanks and an incorrect class, so the subclass may assume that the value
    //        is non-blank and of the proper class. Every subclass implementation should first execute:
    //           value = super._validate(value)
    //        to allow for any super-class validation and normalization to take place.
    //      */
    //     let {class: class_} = this.options
    //     if (class_ && !(value instanceof class_))
    //         throw new ValueError(`expected instance of ${class_}, got ${value}`)
    //
    //     return value
    // }


    /***  Inheritance & Imputation  ***/

    combine_inherited(arrays, obj) {
        /* Combine arrays of inherited values that match this type, with the youngest value at the *first* position.
           Return an array of values (possibly a singleton array). The arrays are either concatenated, or the values are merged
           into one, depending on options (repeated, merged). In the latter case, the default value (if present)
           is also included in the merge. `obj` is an argument to downstream impute().
         */
        let {multiple, mergeable, default: default_} = this.options
        let values = arrays.flat()                              // concatenate the arrays

        if (default_ !== undefined) values.push(default_)       // include default value, if present, even if explicit values exist (!)

        if (!values.length) {
            let value = this._impute(obj)                       // use impute() if still no values
            values = (value !== undefined) ? [value] : []
        }

        if (multiple) return values                             // no merge if multivalued attribute

        // single-valued attribute: merge all values, if allowed, or return the first one only
        let value = (values.length > 1 && mergeable) ? this.merge_inherited(values, obj) : values[0]
        return value !== undefined ? [value] : []

        // let value =
        //     values.length > 1 && mergeable ? this.merge_inherited(values, obj) :   // merge if 2+ values and merging allowed
        //     values.length === 0            ? this._impute(obj) :                   // impute if no values
        //                                      values[0]

        // // if no value in `arrays`, use impute/getter/default to impute one...
        // let value
        // if (!values.length) value = this._impute(obj)
        //
        // // otherwise, perform merging if allowed, or return the youngest value found
        // else if (mergeable) {
        //     // if (default_ !== undefined) values.push(default_)       // include default value in the merge, if present
        //     value = values.length > 1 ? this.merge_inherited(values, obj) : values[0]
        // }
        // else value = values[0]
        //
        // return value !== undefined ? [value] : []
    }

    merge_inherited(objects, obj) {
        /* Merge 1+ inherited `objects` matching this type (TODO: check against incompatible inheritance).
           The result may also incorporate the type's imputed value (options.impute()) or default (options.default).
         */
        return objects[0]      // no actual merging by default; override in subclasses
    }

    _impute(obj) {
        /* Calculate an imputed value for object's property `prop` as described by this type.
           This may run options.impute() function; or obj[options.impute]() method on the target object;
           or read obj[prop] if options.getter=true.
         */
        let {impute} = this.options
        if (!impute) return

        if (typeof impute === 'function') return impute(obj)
        if (typeof impute === 'string') {
            let method = obj[impute]
            if (typeof method === 'function') return method.call(obj)
            if (method !== undefined) throw new Error(`impute option does not point to a method (${impute})`)
        }
        else throw new Error(`incorrect type of 'impute' option (${typeof impute})`)

        // if (getter) {
        //     let value = obj[prop]
        //     if (value !== undefined) return value
        // }

        // // safety: when multiple instances read the same (composite) default and one of them tries (incorrectly) to modify it, cloning prevents interference
        // return Struct.clone(default_)
    }

    /***  Binary encoding for indexing  ***/

    write_binary(output, value, last = false) {
        /* Convert `value` to a binary sequence (Uint8Array) and append to `output` (BinaryOutput), for use in index keys.
           If last=false and the binary representation has variable length, the terminator symbol/sequence or length
           specification should be included in the output, so that binary_decode() can detect the length of the encoded
           sequence when another value follows. Typically, the value is decoded later with read_binary(), but in the future,
           in special cases like non-reversible encoding of Unicode strings with lossy getSortKey(), the decoding could be left
           unimplemented - in such case, the original value would have to be stored separately in the record's payload section.
         */
        throw new NotImplemented(`write_binary() is not implemented for ${this}`)
    }

    read_binary(input, last = false) {
        /* Decode the next value of this type from BinaryInput, `input`, back to an application-level value or object.
           If last=false, the encoded value may be followed by another value in the input,
           so the decoder must be able to detect the end of the encoded value by itself.
         */
        throw new NotImplemented(`read_binary() is not implemented for ${this}`)
    }

    // binary_encode(value, last = false) {
    //     throw new NotImplemented(`binary_encode() is not implemented for ${this}`)
    // }
    //
    // binary_decode(input, last = false) {
    //     throw new NotImplemented(`binary_decode() is not implemented for ${this}`)
    // }


    /***  UI  ***/

    get_initial() {
        /* `options.initial` can be a value or a function; this method provides support for both cases. */
        let {initial} = this.options //this.constructor.initial
        return (typeof initial === 'function') ? initial() : initial
    }

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
 **  PRIMITIVE data types
 **
 */

export class Primitive extends Type {
    /* Base class for schemas of primitive JSON-serializable python types. */

    static stype        // the predefined standard type (typeof...) of app-layer values; same type for db-layer values

    validate(value) {
        value = super.validate(value)
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
    validate(value) {
        value = super.validate(value)
        let {accept_string, min, max} = this.options
        if (accept_string && typeof value === 'string') value = Number(value)
        if (min !== undefined && value < min) throw new ValueError(`the number (${value}) is out of bounds, should be >= ${min}`)
        if (max !== undefined && value > max) throw new ValueError(`the number (${value}) is out of bounds, should be <= ${max}`)
        return value
    }
}

export class INTEGER extends NUMBER {
    /* An integer value. Like a NUMBER, but with additional constraints and monotonic binary encoding (can be used in index keys). */

    static options = {
        signed:  true,          // if true, values can be negative
        length:  undefined,     // number of bytes to be used to store values in DB indexes; adaptive encoding if undefined (for uint), or 6 (for signed int)
    }

    validate(value) {
        value = super.validate(value)
        if (!Number.isInteger(value)) throw new ValueError(`expected an integer, got ${value} instead`)
        if (!this.options.signed && value < 0) throw new ValueError(`expected a positive integer, got ${value} instead`)
        if (value < Number.MIN_SAFE_INTEGER) throw new ValueError(`the integer (${value}) is too small to be stored in JavaScript`)
        if (value > Number.MAX_SAFE_INTEGER) throw new ValueError(`the integer (${value}) is too large to be stored in JavaScript`)
        return value
    }

    write_binary(output, value) {
        value = this.validate(value)
        let {signed, length} = this.options
        signed ? output.write_int(value, length) : output.write_uint(value, length)
    }

    read_binary(input, last = false) {
        let {signed, length} = this.options
        return signed ? input.read_int(length) : input.read_uint(length)
    }
}

export class UNSIGNED extends INTEGER {
    static options = {signed: false}
}

export class OBJECT_ID extends UNSIGNED {
    /* Database ID of an object. */
    static options = {min: 1}
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
        min_length: undefined,
        max_length: undefined,
        // collator                 // optional collator object that defines the sort order and provides a (possibly one-way!) binary encoding for indexing
        // charcase: false,         // 'upper'/'lower' - only upper/lower case characters allowed
    }

    is_blank(value) { return value === '' }

    validate(str) {
        str = super.validate(str)
        let {charset, min_length, max_length} = this.options
        if (min_length != null && str.length < min_length)
            throw new ValueError(`the string (${str}) is too short, should be >= ${min_length} characters`)
        if (max_length != null && str.length > max_length)
            throw new ValueError(`the string (${str}) is too long, should be <= ${max_length} characters`)
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
    validate(str) {
        str = super.validate(str)
        return this.options.trim ? str.trim() : str               // trim leading/trailing whitespace
    }
}

export let generic_string = new STRING()


export class FIELD extends STRING {
    /* A STRING than only contains alphanumeric characters (Unicode allowed!), "_", "-", "$", "*",
       but no punctuation, spaces or other control chars.
     */
    static options = {charset: 'a-zA-Z0-9_\\-\\$\\*\\p{L}\\p{N}'}
}

export class IDENTIFIER extends STRING {
    /* A STRING than only contains ASCII alphanumeric characters and "_", but no punctuation, "-", spaces or control chars. */
    static options = {charset: 'a-zA-Z0-9_'}
}

export class URL extends STRING {
    /* URL type that allows URLs with or without protocol. The Widget automatically appends the protocol if needed. */

    // basic URL validation using a regular expression that allows URLs without protocol
    static pattern = /^([a-z]{3,6}:\/\/)?[a-z\d.-]+\.[a-z]{2,}(?:\/[^\s]*)?$/i
    // static pattern = /^([a-z]{3,6}:\/\/)?((([a-z\d]([a-z\d-]*[a-z\d])*)\.)+[a-z]{2,}|((\d{1,3}\.){3}\d{1,3}))(\:\d+)?(\/[-a-z\d%_.~+]*)*(\?[;&a-z\d%_.~+=-]*)?(\#[-a-z\d_]*)?$/i

    validate(url) {
        url = super.validate(url)
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
    /* Import path of the form "a/b/c.../file.js" or ".../file.js:object_name", pointing to a module or symbol
       (class, function etc.) inside a JS module. During validation, a class/function can be passed as `value`,
       which will be converted to an import path through
     */
    validate(value) {
        let path = (typeof path !== "string") ? schemat.get_classpath(value) : value
        return super.validate(path)
    }
}


/**********************************************************************************************************************
 **
 **  GENERIC data type
 **
 */

export class GENERIC extends Type {
    /* Accept all types of values like the base Type, but display them with a generic JSON widget. */
    static Widget = widgets.JSON_Widget
    subtype(key) { return generic_type }
}

// the most generic type for encoding/decoding of objects of any types
export let generic_type = new GENERIC({multiple: true})


/**********************************************************************************************************************
 **
 **  Other ATOMIC data types
 **
 */

export class Atomic extends GENERIC {
    subtype(key) {}
}

export class REF extends Type {
    /* Reference to a WebObject, encoded as {"@": id} or {"@": __index_id} during serialization through JSONx.
       Newly created objects with `__provisional_id` instead of `id` are accepted.
       REF without parameters is equivalent to GENERIC(WebObject), however, REF can also be parameterized,
       which is not possible with GENERIC.
     */
    static options = {
        // category:  undefined,       // if present, the referenced object must be loaded and belong to `category`
        // exact:     false,           // if true, the objects must belong to this exact `category`, not any of its subcategories
        autoload: false,    // if true, and the type defines a top-level attribute of an object, the referenced object is automatically loaded with the referrer;
                            // if "server" or "client", the autoloading only takes place in this environment, not the other
        strong:   false,    // if true, the referenced object is considered an essential part of the current one ("strong ownership")
                            // and is removed automatically when the parent is deleted (but NOT when the parent is updated and the link alone is removed!)
    }
    static Widget = widgets.REF_Widget

    is_strong() { return this.options.strong }

    validate(obj) {
        obj = super.validate(obj)
        if (!(obj instanceof schemat.WebObject)) throw new ValueError(`expected a WebObject, got ${obj} instead`)
        if (!obj.id) throw new ValueError(`found a reference to newborn object ${obj}, it should be inserted first`)

        // let {category, exact} = this.options
        // if (category) {
        //     if (!obj.is_loaded()) throw new ValueError(`cannot verify if ${obj} belongs to category ${category} because the object is not loaded`)
        //     if (!exact && !obj.instanceof(category)) throw new ValueError(`object ${obj} does not belong to category ${category}`)
        //     if (exact && !obj.__category?.is(category)) throw new ValueError(`object ${obj} does not belong exactly to category ${category}`)
        // }
        return obj
    }

    write_binary(output, value) { output.write_uint(this.validate(value)?.id) }

    read_binary(input) {
        let id = input.read_uint()
        if (id) return schemat.get_object(id)
    }
}


export class BINARY extends Atomic {
    /* Type of Uint8Array objects. */
    static options = {class: Uint8Array}
}


export class ENUM extends Atomic {
    /* Atomic value selected from a list of predefined choices. */
    static options = {
        choices: {},        // eligible choice values (as keys); values can be HTML labels, or dicts with arbitrary info, or nulls;
                            // alternatively, `choices` can be an array of values (no metadata)
    }

    validate(value) {
        value = super.validate(value)
        let choices = this._choices()
        if (!choices.includes(value)) throw new ValueError(`invalid choice: ${value}, expected one of [${choices.join(', ')}]`)
        return value
    }

    _choices() {
        /* Flat list of all possible values without metadata. */
        let {choices} = this.options
        return Array.isArray(choices) ? choices : Object.keys(choices)
    }

    static Widget = class extends widgets.TypeWidget {
        view(value) {
            let {choices} = this.type.options
            if (Array.isArray(choices)) return value
            
            // If choices contain HTML labels or metadata, display the label if available
            let meta = choices[value]
            if (meta && typeof meta === 'object' && meta.label) return meta.label
            if (typeof meta === 'string') return meta
            return value
        }
    }
}


/**********************************************************************************************************************
 **
 **  DATE & TIME
 **
 */

 export class DATE extends Atomic {
    /* Accepts objects of Date class, they represent timestamps as milliseconds since Unix epoch. If needed, converts
       a number (milliseconds since epoch), or string (YYYY-MM-DD, YYYY-MM-DD hh:mm:ss, ISO UTC format) to a Date.
       When converting from a non-ISO-UTC string, local timezone is assumed (!).
     */
    static options = {
        initial: () => new Date(),
    }

    validate(value) {
        let date = (value instanceof Date) ? value : new Date(value)    // convert from milliseconds since epoch, or from date/datetime string
        if (isNaN(date.getTime())) throw new ValueError(`invalid date: ${value}`)
        return super.validate(date)
    }

    static Widget = class extends widgets.TypeWidget {
        encode(date) { return date.toISOString() }
        decode(str)  { return new Date(str) }
    }
}

// export class CALENDAR_DATE extends Atomic {
//     /* Calendar date as an object of CalendarDate instance that keeps "days since epoch" internally. */
// }


/**********************************************************************************************************************/

export class CUSTOM_OBJECT extends Atomic {
    /* Accept objects of specific `class` (Object by default) as atomic values, with optional validation of their attributes. */
    static options = {
        class:  Object,
        strict: true,           // if true, and `attrs` is defined, the object must not have any own attributes beyond those specified in attrs
        attrs:  undefined,      // optional plain object interpreted as a dictionary of allowed attributes, {attr: type};
                                // values of attributes are *not* replaced during validation
    }
    validate(obj) {
        obj = super.validate(obj)
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
//     validate(cls) {
//         cls = super.validate(cls)
//         if (!T.isClass(cls)) throw new ValueError(`expected a class, got ${cls} instead`)
//         return cls
//     }
// }


/**********************************************************************************************************************
 **
 **  Compound data types
 **
 */

export class Compound extends Type {
    /* Base class for compound data types: arrays, maps, etc. */
    static options = {
        multiple:  false,
        mergeable: true,    // values of compound types are merged by default during inheritance rather than replaced or repeated
    }
    is_compound() { return true }
}


export class ArrayLike extends Compound {
    static options = {
        type:       generic_type,   // type of elements, as a Type instance
        inline:     true,           // if true, items are listed on the same line in UI; otherwise, they're separated by <br/>
    }
    static Widget = widgets.ARRAY_Widget

    subtype(key)    { return this.options.type }
    collect(assets) { this.options.type.collect(assets) }

    toString() {
        let {type} = this.options
        let name = this.constructor.name
        return type === generic_type ? name : `${name}(${type})`
    }
}

export class ARRAY extends ArrayLike {
    /* Type of arrays (Array class) of objects of a given `type` (generic_type by default). */
    static options = {
        class: Array,
        initial: () => [],
    }

    is_blank(arr) { return arr?.length === 0 }

    validate(arr) {
        arr = super.validate(arr)
        let {type} = this.options
        return arr.map(elem => type.validate(elem))
    }

    merge_inherited(arrays) { return arrays.flat() }
}


export class SET extends ArrayLike {
    /* Type of sets (Set class) of objects of a given `type`. */
    static options = {
        class: Set,
        initial: () => new Set(),
    }

    is_blank(set) { return set?.size === 0 }

    validate(set) {
        let {type} = this.options
        if (set instanceof Array) set = new Set(set)
        set = super.validate(set)
        return new Set([...set].map(elem => type.validate(elem)))
    }

    merge_inherited(sets) {
        // multiple reversing is needed to preserve the order of elements: youngest at the beginning
        return new Set(sets.map(s => [...s].reverse()).reverse().flat().reverse())
    }
}


/**********************************************************************************************************************/

export class TYPE extends Compound {
    /* Values of this type are Type instances, `type`, which internally contain options, `type.options`,
       which could be merged during inheritance. For this reason, TYPE is treated as compound.
     */
    static options = {class: Type}
    static Widget = widgets.TYPE_Widget

    merge_inherited(types) {
        /* If the youngest Type instance (types[0]) has compatible class (same or subclass) with older instances,
           merge their options. Otherwise, return types[0].
         */
        let type  = types[0]
        let merge = [type]
        let child = type

        // reduce the `types` list to the instances that have a compatible class with their respective child in the chain
        for (let parent of types.slice(1))
            if (child instanceof parent.constructor) merge.push(child = parent)
            else break

        if (merge.length > 1) {
            let options = Object.assign({}, ...merge.map(t => t._options).reverse())
            type = new type.constructor(options)
        }
        // schemat._print(`TYPE.merge_inherited() merged:`, type)
        // schemat._print(`TYPE.merge_inherited() ...from:`, types)
        return type
    }
}

/**********************************************************************************************************************
 **
 **  DICTIONARY-like types
 **
 */

export class DictLike extends Compound {
    /* Base class for dictionary-like compound types: OBJECT, MAP, CATALOG. */

    static options = {
        key_type:       new FIELD(),    // type of keys; must be an instance of STRING or its subclass
        value_type:     generic_type,   // type of values
    }

    get Widget()    { return CatalogTable }
    is_dictionary() { return true }
    subtype(key)    { return this.options.value_type }     // type of values at `key`; subclasses should throw an exception or return undefined if `key` is not allowed

    get_fields_editable() {}            // for record-like collections only

    collect(assets) {
        this.options.key_type.collect(assets)
        this.options.value_type.collect(assets)
        super.collect(assets)
    }

    toString() {
        let name = this.constructor.name
        let {key_type, value_type} = this.options
        return T.ofType(key_type, FIELD) ? `${name}(${value_type})` : `${name}(${key_type} > ${value_type})`
    }

    validate(obj, record = false) {
        obj = super.validate(obj)
        if (record) return obj

        let {key_type, value_type} = this.options
        let entries = []
        let dirty = false

        for (let [key, val] of this._entries(obj)) {
            let new_key = key_type.validate(key)
            let new_val = value_type.validate(val)
            entries.push([new_key, new_val])
            if (new_key !== key || new_val !== val)
                dirty = true
        }

        if (dirty) this._rebuild(obj, entries)
        return obj
    }

    _entries(obj)           { return [...obj.entries()] }
    _rebuild(obj, entries)  { /* remove and re-add all entries in `obj` */ }
}


export class OBJECT extends DictLike {
    /* Accept plain JavaScript objects (POJO or null-prototype objects) used as data containers (dictionaries).
       The objects must *not* belong to any class other than Object.
       This type can be used as a replacement for MAP or CATALOG when a simpler data structure is needed for holding
       collections of named attributes. During inheritance, OBJECT-type objects are merged by default,
       with younger attributes overriding the same-named older ones.
     */
    static options = {
        initial: () => {return {}},
    }
    is_blank(obj) { return Object.keys(obj).length === 0 }

    validate(obj) {
        obj = super.validate(obj)
        if (!T.isPlain(obj)) throw new ValueError(`expected a plain object (no custom class), got ${obj}`)
        return obj
    }

    _entries(obj) { return Object.entries(obj) }

    _rebuild(obj, entries) {
        for (let key of Object.keys(obj))     // remove all entries
            delete obj[key]
        for (let [key, value] of entries)     // add new entries
            obj[key] = value
    }

    merge_inherited(objects) {
        return Object.assign({}, ...objects.toReversed())       // TODO: multiple reverse() is needed for proper ordering
    }
}


export class MAP extends DictLike {
    /* Data type for instances of the Map class. */

    static options = {
        class:      Map,
        initial:    () => new Map(),
    }
    is_blank(obj) { return obj?.size === 0 }

    validate(obj) {
        obj = super.validate(obj)
        if (obj instanceof Catalog) return new Map(obj)             // auto-convert Catalogs to Maps
        if (T.isPlain(obj)) return new Map(Object.entries(obj))     // auto-convert POJOs to Maps
        return obj
    }

    _rebuild(obj, entries) {
        obj.clear()
        for (let [key, value] of entries)
            obj.set(key, value)
    }

    merge_inherited(maps) {
        return new Map([...maps.toReversed()].flatMap(map => [...map.entries()]))       // TODO: multiple reverse() is needed for proper ordering
    }
}


// NOT USED...
export class OBJECTS_MAP extends GENERIC {  // TODO: extends DictLike
    /* Accepts instances of ObjectsMap class. */
    static options = {
        class:      ObjectsMap,
        value_type: generic_type,
    }

    collect(assets) {
        this.options.value_type.collect(assets)
    }

    validate(map) {
        map = super.validate(map)
        let schema = this.options.value_type
        return new ObjectsMap([...map.entries_encoded()].map(([k, v]) => [k, schema.validate(v)]))
    }

    toString() {
        let name = this.constructor.name
        return `${name}(${this.options.value_type})`
    }
}

// CATALOG located in a separate file


/**********************************************************************************************************************
 **
 **  RECORD-like types
 **
 */

export class RECORD extends DictLike {
    /* Accepts objects containing predefined fields, like in a database record. Each field may have its own type,
       unlike in a MAP/CATALOG/OBJECT, where all values share the same type.
    */
    static options = {
        fields: {},         // POJO dictionary of field names and their types, {field: type}
        strict: true,       // if true, only fields listed in `fields` are allowed; generic_type is assumed for other fields otherwise
    }

    validate(obj) {
        obj = super.validate(obj, true)
        let {fields, strict} = this.options

        for (let key of Object.keys(obj)) {
            let type = fields[key]
            if (type) obj[key] = type.validate(obj[key])
            else if (strict) throw new ValidationError(`unknown field "${key}", expected one of [${this.get_fields()}]`)
        }

        // check that all required fields are present
        for (let [key, type] of Object.entries(fields))
            if (type.options.required && obj[key] === undefined)
                throw new ValidationError(`missing required field "${key}" in ${obj}`)

        return obj
    }

    has(key) { return !!this.options.fields[key] }      // true if `key` is EXPLICITLY declared here as a valid field
    get(key) { return this.options.fields[key] || (!this.options.strict && generic_type) || undefined }

    subtype(key) {
        let {fields, strict} = this.options
        if (strict && !fields.hasOwnProperty(key))
            throw new ValidationError(`unknown field "${key}", expected one of [${this.get_fields()}]`)
        return fields[key] || generic_type
    }

    get_fields() { return Object.getOwnPropertyNames(this.options.fields) }

    get_fields_editable() {
        let names = this.get_fields().filter(f => this.options.fields[f].is_editable())     // only keep user-editable fields
        return names.sort()
    }

    get_types() {
        /* List of all types that may occur inside this collection. */
        let types = Object.values(this.options.fields)
        if (!this.options.strict) types.push(generic_type)
        return [...new Set(types)]
    }

    collect(assets) {
        for (let type of this.get_types())
            type.collect(assets)
        super.collect(assets)
    }
}


export class SCHEMA extends RECORD {
    /* Type specification for WebObject.__data, instantiated locally as `obj.__schema`, not intended for other uses. */
    // isValidKey(key) {return is_valid_field_name(key) && (!this.options.strict || Object.hasOwn(this.options.fields, key))}
}


export class SCHEMA_GENERIC extends SCHEMA {
    /* Generic SCHEMA used when schema for a web object is missing. All field names are allowed, their type is `generic_type`. */
    static options = {strict: false}
}


/**********************************************************************************************************************
 **
 **  Classes below are NOT USED ...
 **
 */

export class VARIANT extends Type {
    /* Selection from a number of predefined (sub)types, as a plain object of the form {variant: value},
       where `variant` is one of the eligible variant names, and `value` matches this variant's corresponding type.
     */
    static options = {
        types: {},          // POJO dictionary of variant names and their types, {name: type}
    }
}


/**********************************************************************************************************************
 **
 **  TYPE WRAPPER (data type stored in DB) -- NOT USED
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

