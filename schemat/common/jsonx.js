/* Serialization of objects of arbitrary classes. */

import {assert, print, T, mapEntries, getstate, setstate} from './utils.js'
import {bin_to_hex, hex_to_bin} from "./binary.js"


/*************************************************************************************************/

export class State {
    /* Wrapper for any object that needs to be encoded/decoded and serialized/deserialized, back and forth, via JSONx.
       Internally, it keeps the stringified state of the object only, but gives access to its intermediate forms via getters:
          .object  >  .plain   >  .json
       Every access to .object or .plain returns a new object, so the objects can be owned and modified by the caller.
     */

    json            // base internal representation of the object
    get plain()     { return JSON.parse(this.json) }
    get object()    { return JSONx.parse(this.json) }

    constructor(object_or_json) {
        this.json = (typeof object_or_json === 'string') ? object_or_json : JSONx.stringify(object_or_json)
    }
}

/*************************************************************************************************/

export class JSONx {
    /*
    Dump & load arbitrary objects to/from JSON strings.
    Encode & decode arbitrary objects to/from JSON-compatible "state" composed of serializable types.
    */
    static FLAG_BIGINT = "%big"     // special value of ATTR_CLASS that informs the value is a BigInt decimal string
    static FLAG_BIN   = "%hex"      // special value of ATTR_CLASS that informs the value is a hex-encoded Uint8Array instance
    static FLAG_TYPE  = "%class"    // special value of ATTR_CLASS that informs the value is a class rather than an instance
    static FLAG_WRAP  = "%wrap"     // special value of ATTR_CLASS that denotes a plain-object (POJO) wrapper for another object containing the reserved "@" key
    static ATTR_CLASS = "@"         // special attribute appended to object state to store a class name (with package) of the object being encoded
    static ATTR_STATE = "="         // special attribute to store a non-dict state of data types not handled by JSON: tuple, set, type ...

    #references = new Set()          // track object references to detect cycles

    // constructor(transform) {
    //     // for now, this constructor is only used internally in static encode() & static decode()
    //     this.transform = transform      // optional preprocessing function applied to every nested object before it gets encoded;
    //                                     // can also be used to collect information about the objects being encoded
    // }

    static stringify(obj, ...opts) {
        let state = this.encode(obj)
        return JSON.stringify(state, ...opts)
    }
    static parse(json) {
        let state = JSON.parse(json)
        return this.decode(state)
    }

    static encode(obj)      { return new JSONx().encode(obj) }
    static decode(state)    { return jsonx.decode(state) }
    static deepcopy(obj)    { return JSONx.parse(JSONx.stringify(obj)) }

    static encode_checked(obj)      { if (obj !== undefined) return new JSONx().encode(obj) }   // undefined is a valid value (encoded as undefined)
    static decode_checked(state)    { if (state !== undefined) return jsonx.decode(state) }     // undefined is a valid value (decoded as undefined)

    // static transform(json, transform) {
    //     /* Parse and decode a JSONx-encoded object, then encode and stringify it again while applying
    //        the `transform` function to all its (sub)objects. */
    //     let jsonx  = new JSONx(transform)
    //     let state1 = JSON.parse(json)
    //     let object = jsonx.decode(state1)
    //     let state2 = jsonx.encode(object)           // `transform` is applied here to `object` and nested sub-objects
    //     return JSON.stringify(state2)
    // }


    encode(obj) {
        /*
        Return a `state` that carries all the information needed for reconstruction of `obj` with decode(),
        yet it contains only JSON-compatible values and collections (possibly nested).
        Objects of custom classes are converted to dicts that store object's attributes,
        with a special attribute "@" to hold the class name or item ID. Nested objects are encoded recursively.
        */
        assert(schemat.WebObject, "missing global schemat.WebObject")

        // if (this.transform) {
        //     let transformed = this.transform(obj)
        //     if (transformed !== undefined) obj = transformed
        // }

        if (obj === undefined)   throw new Error("can't encode an undefined value")
        if (T.isPrimitive(obj))  return obj

        // check for cyclic references
        if (this.#references.has(obj))
            throw new Error(`cyclic reference detected while encoding object: ${obj}`)
        this.#references.add(obj)

        // find the top-most base class of the object
        let baseclass
        let proto = obj && (typeof obj === 'object') && Object.getPrototypeOf(obj)
        while (proto && proto !== Object.prototype) {
            baseclass = proto.constructor
            proto = Object.getPrototypeOf(proto)
        }

        try {
            if (baseclass === Array) return this.encode_array(obj)
            // if (Array.isArray(obj)) return this.encode_array(obj)

            if (T.isPlain(obj)) {
                obj = this.encode_object(obj)
                if (!(JSONx.ATTR_CLASS in obj)) return obj
                return {[JSONx.ATTR_STATE]: obj, [JSONx.ATTR_CLASS]: JSONx.FLAG_WRAP}
            }

            if (baseclass === schemat.WebObject) {
                if (obj.__index_id) return {[JSONx.ATTR_CLASS]: obj.__index_id}     // ref to a newly created object uses __provisional_id
                throw new Error(`can't encode a reference to a newborn object without a provisional ID: ${obj}`)
            }

            if (obj instanceof Uint8Array) {
                let state = bin_to_hex(obj)
                return {[JSONx.ATTR_STATE]: state, [JSONx.ATTR_CLASS]: JSONx.FLAG_BIN}
            }
            
            // if (typeof obj === 'bigint')    // handle BigInt values
            if (baseclass === BigInt)
                return {[JSONx.ATTR_STATE]: obj.toString(), [JSONx.ATTR_CLASS]: JSONx.FLAG_BIGINT}

            if (T.isClass(obj)) {
                let state = schemat.get_classpath(obj)
                return {[JSONx.ATTR_STATE]: state, [JSONx.ATTR_CLASS]: JSONx.FLAG_TYPE}
            }

            let state
            if (baseclass === Map)
                state = this.encode_object(Object.fromEntries(obj.entries()))
            else {
                state = getstate(obj)
                state = (obj !== state) ? this.encode(state) : this.encode_object(state)
            }

            // wrap up the state in a dict, if needed, and append class designator
            if (!state || typeof state !== 'object' || Array.isArray(state) || JSONx.ATTR_CLASS in state)
                state = {[JSONx.ATTR_STATE]: state}

            let t = T.getPrototype(obj)
            state[JSONx.ATTR_CLASS] = schemat.get_classpath(t)

            return state
        } finally {
            this.#references.delete(obj)  // cleanup after encoding is done
        }
    }

    decode(state) {
        /*
        Reverse operation to encode(): takes an encoded JSON-serializable `state` and converts back to an object.

        WARNING: the returned object may contain `state` or a part of it internally - any modifications in `state`
                 object after this call may indirectly change the result (!).
        */
        let _state = state
        let plain = T.isPlain(state)        // plain JS object (no custom class)
        let type = state?.[JSONx.ATTR_CLASS]
        let cls

        if (plain && type) {
            if (type === JSONx.FLAG_BIN)            // decoding of a Uint8Array
                return hex_to_bin(state[JSONx.ATTR_STATE])

            if (type === JSONx.FLAG_BIGINT)         // handle BigInt decoding
                return BigInt(state[JSONx.ATTR_STATE])

            if (type === JSONx.FLAG_TYPE) {         // decoding of a class object
                let classname = state[JSONx.ATTR_STATE]
                return schemat.get_builtin(classname)
            }
            if (type === JSONx.FLAG_WRAP) {         // decoding of a wrapped-up object that contained a pre-existing '@' key
                if (JSONx.ATTR_STATE in state)
                    state = state[JSONx.ATTR_STATE]
                return this.decode_object(state)
            }
        }

        // determine the expected class (constructor function) for the output object
        if (!plain)                                 // `state` encodes a primitive value, or a list, or null;
            cls = T.getClass(state)                 // cls=null denotes a class of null value

        else if (type) {
            state = {...state}                      // avoid mutating the original `state` object when doing T.pop() below
            let classname = T.pop(state, JSONx.ATTR_CLASS)
            if (JSONx.ATTR_STATE in state) {
                let state_attr = T.pop(state, JSONx.ATTR_STATE)
                if (T.notEmpty(state))
                    throw new Error(`invalid serialized state, expected only ${JSONx.ATTR_CLASS} and ${JSONx.ATTR_STATE} special keys but got others: ${state}`)
                state = state_attr
            }
            if (T.isNumber(classname)) {                // `classname` can be a web object ID, not a class name
                let id = classname
                return (id > 0) ?
                    schemat.get_object(id) :            // all web objects must be loaded through the global Schemat instance;
                    schemat.get_provisional(-id)        // special handling for references to newborn objects - represented by negative ID
            }
            cls = schemat.get_builtin(classname)
        }
        else cls = Object

        if (cls === undefined) throw new Error(`can't detect the class of object during decoding`)

        // instantiate the output object; special handling for standard JSON types
        if (T.isPrimitiveClass(cls))  return state
        if (cls === Object)           return this.decode_object(state)
        if (cls === Array)            return this.decode_array(state)
        if (cls === Map)              return new Map(Object.entries(this.decode_object(state)))
        // if (cls === Set)              return new Set(this.decode_array(state))

        // if (T.isSubclass(cls, schemat.WebObject) && T.isNumber(state))
        //     return schemat.get_object(state)

        if (state === _state)
            assert(false, "JSONx.decode(): no actual decoding performed leading to infinite recursion")

        state = this.decode(state)

        return setstate(cls, state)
    }

    // static encdec(obj)   { return this.decode(this.encode(obj))   }       // for testing purposes
    // static decenc(state) { return this.encode(this.decode(state)) }       // for testing purposes

    encode_array(values) {
        /* Recursively encode all non-primitive objects inside an array. */
        return values.map(v => this.encode(v))
    }
    decode_array(state) {
        /* Recursively decode all non-primitive objects inside an array. */
        return state.map(v => this.decode(v))
    }
    encode_object(obj) {
        /* Recursively encode all properties of a plain object and return as a new object (`obj` stays untouched).
           Skip properties with `undefined` value.
         */
        let out = {...obj}

        for (let [key, value] of Object.entries(out))
            if (typeof key !== "string")
                throw new Error(`non-serializable object state, contains a non-string key: ${key}`)
            else if (value === undefined)
                delete out[key]
            else
                out[key] = this.encode(value)

        return out
        // return mapEntries(obj, (k, v) => [k, this.encode(v)])
    }
    decode_object(state) {
        /* Recursively decode all non-primitive objects inside `state` dictionary. */
        return mapEntries(state, (k, v) => [k, this.decode(v)])
    }
}


const jsonx = new JSONx()
