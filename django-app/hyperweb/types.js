
export class Types {
    // below, <null> is treated as a correct argument, while <undefined> as incorrect, for all the functions;
    // getClass(null) returns null, getClass(3) returns Number, etc.

    static getPrototype   = (obj) => (obj == null) ? null : Object.getPrototypeOf(obj)
    static getClass       = (obj) => (obj == null) ? null : Object.getPrototypeOf(obj).constructor      // reading constructor from prototype is slightly safer than directly from obj
    static isPrimitiveObj = (obj) => ["number","string", "boolean"].includes(typeof obj) || obj === null
    static isPrimitiveCls = (cls) => [Number, String, Boolean, null].includes(cls)
    static isArray        = (obj) => (obj && Object.getPrototypeOf(obj) === Array.prototype)
    static isDict         = (obj) => (obj && Object.getPrototypeOf(obj) === Object.prototype)
    static ofType         = (x,T) => (x && T && Object.getPrototypeOf(x) === T.prototype)      // test if x is an object of class T exactly (NOT of a subclass)
    static isClass        = (C)   => (typeof C === "function" && C.prototype !== undefined)    // test if C is a class (a constructor function with .prototype)
    static isSubclass     = (C,B) => (C === B || C.prototype instanceof B)                     // test if C is subclass of B, including C===B
}

export class Schema {

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
        Convert `value` - a possibly composite object matching the current schema (self) -
        to a JSON-serializable "state" that does not contain non-standard nested objects anymore.
        By default, generic object encoding (JSON.encode()) is performed.
        Subclasses may override this method to perform more compact, schema-aware encoding.
        */
        return JSON.encode(value)
    }

    decode(state) {
        /* Convert a serializable "state" as returned by encode() back to an original custom object. */
        return JSON.decode(state)
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
    constructor(...types) {
        super()
        if (types.length) this.types = types            // base type(s) for inheritance checks: obj instanceof T
    }
    valid(obj) {
        return !this.types || this.types.length === 0 || this.types.filter((base) => obj instanceof base).length > 0
    }
    encode(obj) {
        if (!this.valid(obj))
            throw `invalid object type, expected one of ${this.types}, but got ${getClass(obj)}`
        return JSON.encode(obj)
    }
    decode(state) {
        let obj = JSON.decode(state)
        if (!this.valid(obj))
            throw `invalid object type after decoding, expected one of ${this.types}, but got ${getClass(obj)}`
        return obj
    }
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

    constructor(category) {
        super()
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
    Accepts <dict> objects as data values, or objects of a given `type` which should be a subclass of <dict>.
    Outputs a dict with keys and values encoded through their own schema.
    If no schema is provided, `generic_schema` is used as a default.
    */

    // the defaults are configured at class level for easy subclassing and to reduce output when this schema is serialized
    static keys_default   = generic_schema
    static values_default = generic_schema

    constructor(keys, values, type) {
        super()
        if (keys)   this.keys = keys            // schema of keys of app-layer dicts
        if (values) this.values = values        // schema of values of app-layer dicts
        if (type)   this.type = type            // optional subtype of <dict>; if present, only objects of this type are accepted for encoding
    }
    encode(d) {

        let type = this.type || Object
        if (!(d instanceof type)) throw `expected an object of type ${type}, got ${d} instead`
        let state = {}

        let schema_keys   = this.keys || this.constructor.keys_default
        let schema_values = this.values || this.constructor.values_default

        // encode keys & values through predefined field types
        Object.entries(d).forEach(([key, value]) => {
            let k = schema_keys.encode(key)
            if (k in state) throw `two different keys encoded to the same state (${k}) in DICT, one of them: ${key}`
            state[k] = schema_values.encode(value)
        })
        return state
    }
    decode(state) {

        if (typeof state != "object") throw `expected an object as state for decoding, got ${state} instead`
        let d = new (this.type || Object)()

        let schema_keys   = this.keys || this.constructor.keys_default
        let schema_values = this.values || this.constructor.values_default

        // decode keys & values through predefined field types
        Object.entries(state).forEach(([key, value]) => {
            let k = schema_keys.decode(key)
            if (k in d) throw `two different keys of state decoded to the same key (${key}) of output object, one of them: ${k}`
            d[k] = schema_values.decode(value)
        })
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
    static keys_default = new STRING()

    constructor(values, keys, type) {
        if (keys && !(keys instanceof STRING)) throw `schema of keys must be an instance of STRING or its subclass, not ${keys}`
        super(keys, values, type)
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
