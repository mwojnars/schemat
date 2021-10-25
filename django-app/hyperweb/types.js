/**********************************************************************************************************************
 **
 **  UTILITIES
 **
 */

export function assert(test, msg) {
    if (test) return
    throw `assertion failed: ${msg}`
    // console.assert(test)
}

export class Types {
    /*
    A set of utility functions for working with objects and classes.
    Below, the term "dict" (dictionary) means an object of no specific class, i.e., an instance of Object;
    such objects are typically used to carry data, like <dict> in python, rather than to provide functionality.
    */

    // below, `null` is an expected (correct) argument, while `undefined` as incorrect, for all the functions;
    // getClass(null) returns null, getClass(3) returns Number, etc.

    static getOwnProperty = (obj,prop) => obj.hasOwnProperty(prop) ? obj[prop] : undefined
    static get            = (obj,prop) => obj.hasOwnProperty(prop) ? obj[prop] : undefined      // alias for getOwnProperty()
    static pop            = (obj,prop) => {                         // pop() = get() own property of `obj`, delete, return value
        if (!obj.hasOwnProperty(prop)) return undefined
        let x = obj[prop]; delete obj[prop]; return x
    }
    static getPrototype   = (obj) => (obj == null) ? null : Object.getPrototypeOf(obj)
    static getClass       = (obj) => (obj == null) ? null : Object.getPrototypeOf(obj).constructor      // reading constructor from prototype is slightly safer than directly from obj

    static isPrimitiveObj = (obj) => ["number","string", "boolean"].includes(typeof obj) || obj === null
    static isPrimitiveCls = (cls) => [Number, String, Boolean, null].includes(cls)
    static isArray        = (obj) => (obj && Object.getPrototypeOf(obj) === Array.prototype)
    static isDict         = (obj) => (obj && Object.getPrototypeOf(obj) === Object.prototype)   // test if obj is a pure object (dict), no class assigned
    static ofType         = (x,T) => (x && T && Object.getPrototypeOf(x) === T.prototype)   // test if x is an object of class T exactly (NOT of a subclass)
    static isClass        = (C)   => (typeof C === "function" && C.prototype !== undefined) // test if C is a class (a constructor function with .prototype); false for arrays
    static isSubclass     = (C,B) => (C === B || C.prototype instanceof B)                  // test if C is subclass of B, including C===B
    static isMissing      = (obj) => (obj === null || obj === undefined)                    // test if obj is null or undefined (two cases of "missingness")
    static isEmpty        = (obj) => (!obj || Object.keys(obj).length === 0)
    static notEmpty       = (obj) => (obj && Object.keys(obj).length > 0)

    // create a new object (dict) by mapping items of `obj` to new [key,value] pairs;
    // does NOT detect if two entries are mapped to the same key (!)
    static mapDict        = (obj,fun)  => Object.fromEntries(Object.entries(obj).map(([k,v]) => fun(k,v)))

    static getstate       = (obj) => obj['__getstate__'] ? obj['__getstate__']() : obj
    static setstate       = (cls,state) => {        // create an object of class `cls` and call its __setstate__() if present, or assign `state` directly
        let obj = new cls()
        if (obj['__setstate__']) obj['__setstate__'](state)
        else Object.assign(obj, state)
        return obj
    }

}
export class T extends Types {}  // T is an alias for Types

export class DataError extends Error {}


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

    check(value) { if (!this.valid(value)) throw "Invalid" }
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

    toString() {
        return this.constructor.name
        // return JSON.stringify(this._fields).slice(0, 60)
    }
}

/**********************************************************************************************************************
 **
 **  ATOMIC schema types
 **
 */

export class OBJECT extends Schema {
    /*
    Accepts object of any class, optionally restricted to objects whose type(obj) is equal to one of
    predefined type(s) - the `type` parameter - or the object is an instance of one of predefined base classes
    - the `base` parameter; at least one of these conditions must hold.
    If there is only one type in `type`, and an empty `base`, the type name is excluded
    from serializated output and is implied automatically during deserialization.
    Types can be given as import paths (strings), which will be automatically converted to a type object.
    */
    get _types() { return this.types || this.constructor.types }

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
            throw `invalid object type, expected one of ${this._types}, but got ${getClass(obj)}`
        return JSONx.encode(obj)
    }
    decode(state) {
        let obj = JSONx.decode(state)
        if (!this.valid(obj))
            throw `invalid object type after decoding, expected one of ${this._types}, but got ${getClass(obj)}`
        return obj
    }
}

export class SCHEMA extends OBJECT {
    static types = [Schema]
}

// the most generic schema for encoding/decoding of objects of any types
export let generic_schema = new OBJECT()


/**********************************************************************************************************************/

export class CLASS extends Schema {
    /* Accepts any global python type and encodes as a string containing its full package-module name. */
    encode(value) {
        if (value === null) return null
        return globalThis.registry.get_path(value)
    }
    decode(value) {
        if (typeof value !== "string") throw `expected a string after decoding, not ${value}`
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
        if (typeof value !== t) throw `expected a primitive value of type "${t}", got ${value} instead`
    }
    encode(value) {
        this.check(value)
        return value
    }
    decode(value) {
        this.check(value)
        return value
    }
}

export class BOOLEAN extends Primitive {
    static type = "boolean"
}

export class FLOAT extends Primitive {
    static type = "number"
}
export class INTEGER extends FLOAT {
    /* Same value type as FLOAT's, but different constraints. */
}

export class STRING extends Primitive {
    static type = "string"
}
export class TEXT extends Primitive {
    static type = "string"
}
export class CODE extends TEXT {}
export class FILENAME extends STRING {}


/**********************************************************************************************************************/

export class ITEM extends Schema {
    /*
    Reference to an Item, encoded as ID=(CID,IID), or just IID if `category` was provided.
    ITEM without parameters is equivalent to OBJECT(Item), however, ITEM can also be parameterized,
    which is not possible with an OBJECT.
    */

    constructor(category, params = {}) {
        super(params)
        if (category) this.category = category      // (optional) category of items to be encoded; undefined means all items can be encoded
    }
    get cid() {
        return this.category ? this.category.iid : null
    }
    encode(item) {
        if (!item.has_id())
            throw `item to be encoded has missing or incomplete ID: ${item.id}`

        let cid = this.cid
        if (cid === null) return item.id
        if (cid === item.cid) return item.iid
        throw `incorrect CID=${item.cid} of an item ${item}, expected CID=${cid}`
    }
    decode(value) {
        let ref_cid = this.cid
        let cid, iid

        if (typeof value === "number")
            iid = value
            if (ref_cid === null) throw `expected a (CID,IID) tuple, but got only IID (${iid})`
        else
            if (value instanceof Array && value.length === 2)
                [cid, iid] = value
        else
            throw `expected a (CID,IID) tuple, got ${value} instead during decoding`

        if (!Number.isInteger(cid)) throw `expected CID to be an integer, got ${cid} instead during decoding`
        if (!Number.isInteger(iid)) throw `expected IID to be an integer, got ${iid} instead during decoding`
        if (cid === null)
            cid = ref_cid

        return globalThis.registry.get_item([cid, iid])
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
        if (!(d instanceof type)) throw `expected an object of type ${type}, got ${d} instead`

        let schema_keys   = this.keys || this.constructor.keys_default
        let schema_values = this.values || this.constructor.values_default
        let state = {}

        // encode keys & values through predefined field types
        for (let [key, value] of Object.entries(d)) {
            let k = schema_keys.encode(key)
            if (k in state) throw `two different keys encoded to the same state (${k}) in DICT, one of them: ${key}`
            state[k] = schema_values.encode(value)
        }
        return state
    }
    decode(state) {

        if (typeof state != "object") throw `expected an object as state for decoding, got ${state} instead`

        let schema_keys   = this.keys || this.constructor.keys_default
        let schema_values = this.values || this.constructor.values_default
        let d = new (this.type || Object)

        // decode keys & values through predefined field types
        for (let [key, value] of Object.entries(state)) {
            let k = schema_keys.decode(key)
            if (k in d) throw `two different keys of state decoded to the same key (${key}) of output object, one of them: ${k}`
            d[k] = schema_values.decode(value)
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
    Watch out the reversed ordering of arguments in constructor() !!
    */
    get is_catalog() { return true }
    static keys_default = new STRING

    constructor(values, keys, type, params = {}) {
        if (keys && !(keys instanceof STRING)) throw `schema of keys must be an instance of STRING or its subclass, not ${keys}`
        super(keys, values, type, params)
    }
    toString() {
        let name   = this.constructor.name
        let keys   = this.keys || this.constructor.keys_default
        let values = this.values || this.constructor.values_default
        if (Types.ofType(keys, STRING))
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

// export class Field {
//     /* Specification of a field in a FIELDS/RECORD catalog. */
//
//     // schema  = null          // instance of Schema
//     // default = undefined     // value assumed if this field is missing in an item; or MISSING if no default
//     // multi   = False         // whether this field can be repeated (take on multiple values)
//     // info    = null          // human-readable description of the field
//
//     constructor(schema, params = {}) {
//         let {default_, info, multi} = params
//         if (schema) this.schema = schema
//         if (info)   this.info = info
//         if (multi !== undefined)    this.multi = multi
//         if (default_ !== undefined) this['default'] = default_
//         if ('default' in params)    this['default'] = params['default']
//         // the 'default' property must be accessed through [...] to avoid syntax errors: "default" is a JS keyword
//     }
//
//     // __getstate__() {
//     //     if (Types.isMissing(this['default'])) {           // exclude explicit MISSING value from serialization
//     //         state = this.__dict__.copy()
//     //         del state['default']
//     //     } else
//     //         state = this.__dict__
//     //     return state
//     // }
//
//     encode_one(value) {
//         return this.schema.encode(value)
//     }
//     decode_one(state) {
//         return this.schema.decode(state)
//     }
//
//     // encode_many(values) {
//     //     /* There can be multiple `values` to encode if this.multi is true. `values` is a list. */
//     //     if (values.length >= 2 && !this.multi) throw `repeated keys are not allowed by ${this} schema`
//     //     let encoded = values.map((v) => this.schema.encode(v))
//     //
//     //     // compactify singleton lists
//     //     if (!this.multi || (encoded.length === 1 && !(encoded[0] instanceof Array)))
//     //         encoded = encoded[0]
//     //
//     //     return encoded
//     // }
//     // decode_many(encoded) {
//     //     /* Returns a list of value(s). */
//     //
//     //     // de-compactify singleton lists
//     //     if (!this.multi || !(encoded instanceof Array))
//     //         encoded = [encoded]
//     //
//     //     // schema-based decoding
//     //     return encoded.map((s) => this.schema.decode(s))
//     // }
// }
        
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
    static default_schema = new OBJECT(null, {multi: true})

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
        else if (!T.isDict(data)) throw new DataError(`expected a plain Object for encoding, got ${T.getClass(data)}`)

        // state encoding
        return T.mapDict(data, (name, value) => [name, this._schema(name).encode(value)])
    }
    decode(state) {

        if (!T.isDict(state)) throw new DataError(`expected a plain Object for decoding, got ${T.getClass(state)}`)
        let data = T.mapDict(state, (name, value) => [name, this._schema(name).decode(value)])
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

// export class FIELDS extends RECORD {
//     /*
//     Dict of item properties declared by a particular category, as field name -> Field object.
//     Provides methods for schema-aware encoding and decoding of item's data,
//     with every field value encoded through its dedicated field-specific schema.
//
//     Primarily used for schema definition inside categories.
//     Can also be used as a sub-schema in compound schema definitions. Instances of MultiDict
//     are valid objects for encoding. If standard dict-like functionality is desired, field.multi should be set
//     to False in all fields.
//     */
//
//     // static multi = True   -- TODO
// }
//
// export class FIELD extends RECORD {
//     /* Schema of a field specification in a category's list of fields. */
//
//     // static type = Field
//     static fields = RECORD._init_fields({
//         'schema':  new OBJECT(Schema),       // VARIANT(OBJECT(base=Schema), ITEM(schema-category))
//         'default': new OBJECT,
//         'multi':   new BOOLEAN,
//         'info':    new STRING,
//     })
// }