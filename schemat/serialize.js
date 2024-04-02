/* Serialization of objects of arbitrary classes. */

import {assert, T} from './common/utils.js'


/*************************************************************************************************/

export class JSONx {
    /*
    Dump & load arbitrary objects to/from JSON strings.
    Encode & decode arbitrary objects to/from JSON-compatible "state" composed of serializable types.
    */
    static FLAG_TYPE  = "(class)"       // special value of ATTR_CLASS that informs the value is a class rather than an instance
    static FLAG_WRAP  = "(object)"      // special value of ATTR_CLASS that denotes a plain-object (POJO) wrapper for another object containing the reserved "@" key
    static ATTR_CLASS = "@"             // special attribute appended to object state to store a class name (with package) of the object being encoded
    static ATTR_STATE = "="             // special attribute to store a non-dict state of data types not handled by JSON: tuple, set, type ...

    constructor(transform) {
        // for now, this constructor is only used internally in static encode() & static decode()
        this.transform = transform      // optional preprocessing function applied to every nested object before it gets encoded;
                                        // can also be used to collect information about the objects being encoded
    }

    static stringify(obj, ...opts) {
        let state = this.encode(obj)
        return JSON.stringify(state, ...opts)
    }
    static parse(json) {
        let state = JSON.parse(json)
        return this.decode(state)
    }

    static encode(obj, transform)           { return new JSONx(transform).encode(obj) }
    static decode(state)                    { return new JSONx().decode(state) }

    static transform(json, transform) {
        /* Parse and decode a JSONx-encoded object, then encode and stringify it again while applying
           the `transform` function to all its (sub)objects. */
        let jsonx  = new JSONx(transform)
        let state1 = JSON.parse(json)
        let object = jsonx.decode(state1)
        let state2 = jsonx.encode(object)           // `transform` is applied here to `object` and nested sub-objects
        return JSON.stringify(state2)
    }

    encode(obj) {
        /*
        Return a `state` that carries all the information needed for reconstruction of `obj` with decode(),
        yet it contains only JSON-compatible values and collections (possibly nested).
        Objects of custom classes are converted to dicts that store object's attributes,
        with a special attribute "@" to hold the class name or item ID. Nested objects are encoded recursively.
        Optional `transform` function preprocesses the `obj` and every nested object before they get encoded.
        */
        assert(Item, "missing globalThis.Item")
        let state

        if (this.transform) {
            let transformed = this.transform(obj)
            if (transformed !== undefined) obj = transformed
        }

        if (obj === undefined)   throw new Error("Can't encode an undefined value")
        if (T.isPrimitive(obj))  return obj
        if (T.isArray(obj))      return this.encode_array(obj)

        if (T.isDict(obj)) {
            obj = this.encode_object(obj)
            if (!(JSONx.ATTR_CLASS in obj)) return obj
            return {[JSONx.ATTR_STATE]: obj, [JSONx.ATTR_CLASS]: JSONx.FLAG_WRAP}
        }

        if (obj instanceof Item) {
            let id = obj._get_write_id()
            if(id !== undefined) return {[JSONx.ATTR_CLASS]: id}
            else throw new Error(`Can't encode a newborn object (no ID): ${obj}`)
        }

        if (T.isClass(obj)) {
            state = schemat.get_classpath(obj)
            return {[JSONx.ATTR_STATE]: state, [JSONx.ATTR_CLASS]: JSONx.FLAG_TYPE}
        }
        else if (obj instanceof Set)
            state = this.encode_array(Array.from(obj))
        else if (obj instanceof Map)
            state = this.encode_object(Object.fromEntries(obj.entries()))
        else {
            state = T.getstate(obj)
            state = obj !== state ? this.encode(state) : this.encode_object(state)
            if (JSONx.ATTR_CLASS in state)
                throw new Error(`Non-serializable object state, a reserved character "${JSONx.ATTR_CLASS}" occurs as a key`)
        }

        // wrap up the state in a dict, if needed, and append class designator
        if (!T.isDict(state))
            state = {[JSONx.ATTR_STATE]: state}

        let t = T.getPrototype(obj)
        state[JSONx.ATTR_CLASS] = schemat.get_classpath(t)

        return state
    }

    decode(state) {
        /*
        Reverse operation to encode(): takes an encoded JSON-serializable `state` and converts back to an object.

        WARNING: the returned object may contain `state` or a part of it internally - any modifications in `state`
                 object after this call may indirectly change the result (!).
        */
        assert(Item, "missing globalThis.Item")
        let isdict = T.isDict(state)
        let cls

        // decoding of a wrapped-up object that contained a pre-existing '@' key
        if (isdict && (state[JSONx.ATTR_CLASS] === JSONx.FLAG_WRAP)) {
            if (JSONx.ATTR_STATE in state)
                state = state[JSONx.ATTR_STATE]
            return this.decode_object(state)
        }

        // decoding of a class object
        if (isdict && (state[JSONx.ATTR_CLASS] === JSONx.FLAG_TYPE)) {
            let classname = state[JSONx.ATTR_STATE]
            return schemat.get_class(classname)
        }

        // determine the expected class (constructor function) for the output object
        if (!isdict)                                // `state` encodes a primitive value, or a list, or null;
            cls = T.getClass(state)                 // cls=null denotes a class of null value

        else if (JSONx.ATTR_CLASS in state) {
            state = {...state}                      // avoid mutating the original `state` object when doing T.pop() below
            let classname = T.pop(state, JSONx.ATTR_CLASS)
            if (JSONx.ATTR_STATE in state) {
                let state_attr = T.pop(state, JSONx.ATTR_STATE)
                if (T.notEmpty(state))
                    throw new Error(`Invalid serialized state, expected only ${JSONx.ATTR_CLASS} and ${JSONx.ATTR_STATE} special keys but got others: ${state}`)
                state = state_attr
            }
            if (T.isNumber(classname))                      // `classname` can be an item ID instead of a class
                return schemat.get_object(classname)        // all web objects must be loaded through the global Schemat instance
            cls = schemat.get_class(classname)
        }
        else cls = Object

        console.assert(cls !== undefined, {msg: "`cls` is undefined", state})

        // instantiate the output object; special handling for standard JSON types and Item
        if (T.isPrimitiveClass(cls))  return state
        if (cls === Array)            return this.decode_array(state)
        if (cls === Object)           return this.decode_object(state)
        if (cls === Set)              return new Set(this.decode_array(state))
        if (cls === Map)
            return new Map(Object.entries(this.decode_object(state)))

        // if (T.isSubclass(cls, Item) && T.isNumber(state))
        //     return schemat.get_object(state)

        state = this.decode(state)

        return T.setstate(cls, state)
    }

    // static encdec(obj)   { return this.decode(this.encode(obj))   }       // for testing purposes
    // static decenc(state) { return this.encode(this.decode(state)) }       // for testing purposes

    encode_array(values) {
        /* Encode recursively all non-primitive objects inside an array. */
        return values.map(v => this.encode(v))
    }
    decode_array(state) {
        /* Decode recursively all non-primitive objects inside an array. */
        return state.map(v => this.decode(v))
    }
    encode_object(obj) {
        /* Encode recursively all properties of a plain object and return as a new object (`obj` stays untouched).
           Skip properties with `undefined` value.
         */
        let out = {...obj}

        for (let [key, value] of Object.entries(out))
            if (typeof key !== "string")
                throw new Error(`Non-serializable object state, contains a non-string key: ${key}`)
            else if (value === undefined)
                delete out[key]
            else
                out[key] = this.encode(value)

        return out
        // return T.mapDict(obj, (k, v) => [k, this.encode(v)])
    }
    decode_object(state) {
        /* Decode recursively all non-primitive objects inside `state` dictionary. */
        return T.mapDict(state, (k, v) => [k, this.decode(v)])
    }
}
