/* Serialization of objects of arbitrary classes. */

import { T } from './utils.js'
import { Item } from './item.js'


/*************************************************************************************************/

export class JSONx {
    /*
    Dump & load arbitrary objects to/from JSON strings.
    Encode & decode arbitrary objects to/from JSON-compatible "state" composed of serializable types.
    */
    static FLAG_TYPE  = "class"         // special value of ATTR_CLASS that informs the value is a class rather than an instance
    static FLAG_DICT  = "Object"        // special value of ATTR_CLASS that denotes a plain-object (POJO) wrapper for another object containing the reserved "@" key
    static ATTR_CLASS = "@"             // special attribute appended to object state to store a class name (with package) of the object being encoded
    static ATTR_STATE = "="             // special attribute to store a non-dict state of data types not handled by JSON: tuple, set, type ...

    constructor(transform) {
        // for now, this constructor is only used internally in static encode() & static decode()
        this.registry = globalThis.registry
        this.transform = transform      // optional preprocessing function applied to every nested object before it gets encoded
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
        /* Parse and decode a JSONx-encoded object, then encode and stringify is again while applying
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
        let registry = this.registry
        let state

        if (this.transform) obj = this.transform(obj)

        if (obj === undefined)      throw new Error("Can't encode an undefined value")
        if (T.isPrimitiveObj(obj))  return obj
        if (T.isArray(obj))         return this.encode_list(obj)

        if (T.isDict(obj)) {
            obj = this.encode_dict(obj)
            if (!(JSONx.ATTR_CLASS in obj)) return obj
            return {[JSONx.ATTR_STATE]: obj, [JSONx.ATTR_CLASS]: JSONx.FLAG_DICT}
        }

        if (obj instanceof Item && obj.has_id())
            return {[JSONx.ATTR_CLASS]: obj.id}

        if (T.isClass(obj)) {
            state = registry.getPath(obj)
            return {[JSONx.ATTR_STATE]: state, [JSONx.ATTR_CLASS]: JSONx.FLAG_TYPE}
        }
        else if (obj instanceof Set)
            state = this.encode_list(Array.from(obj))
        else if (obj instanceof Map)
            state = this.encode_dict(Object.fromEntries(obj.entries()))
        else {
            state = T.getstate(obj)
            state = obj !== state ? this.encode(state) : this.encode_dict(state)
            if (JSONx.ATTR_CLASS in state)
                throw new Error(`Non-serializable object state, a reserved character "${JSONx.ATTR_CLASS}" occurs as a key`)
        }

        // wrap up the state in a dict, if needed, and append class designator
        if (!T.isDict(state))
            state = {[JSONx.ATTR_STATE]: state}

        let t = T.getPrototype(obj)
        state[JSONx.ATTR_CLASS] = registry.getPath(t)

        return state
    }

    decode(state) {
        /*
        Reverse operation to encode(): takes an encoded JSON-serializable `state` and converts back to an object.
        This function is MUTATING: the internal contents of `state` may get modified to avoid sub-object copy (!).
        */
        let registry = this.registry
        let isdict = T.isDict(state)
        let cls

        // decoding of a wrapped-up dict that contained a pre-existing '@' key
        if (isdict && (state[JSONx.ATTR_CLASS] === JSONx.FLAG_DICT)) {
            if (JSONx.ATTR_STATE in state)
                state = state[JSONx.ATTR_STATE]
            return this.decode_dict(state)
        }

        // determine the expected class (constructor function) for the output object
        if (!isdict)                                // `state` encodes a primitive value, or a list, or null;
            cls = T.getClass(state)                 // cls=null denotes a class of null value

        else if (JSONx.ATTR_CLASS in state) {
            let classname = T.pop(state, JSONx.ATTR_CLASS)
            if (JSONx.ATTR_STATE in state) {
                let state_attr = T.pop(state, JSONx.ATTR_STATE)
                if (T.notEmpty(state))
                    throw new Error(`Invalid serialized state, expected only ${JSONx.ATTR_CLASS} and ${JSONx.ATTR_STATE} special keys but got others: ${state}`)
                state = state_attr
            }
            if (T.isNumber(classname))                      // `classname` can be an item ID instead of a class
                return registry.getItem(classname)
            cls = registry.getClass(classname)
        }
        else cls = Object

        console.assert(cls !== undefined, {msg: "`cls` is undefined", state})

        // instantiate the output object; special handling for standard JSON types and Item
        if (T.isPrimitiveCls(cls))  return state
        if (cls === Array)          return this.decode_list(state)
        if (cls === Object)         return this.decode_dict(state)
        if (cls === Set)            return new Set(this.decode_list(state))
        if (cls === Map)
            return new Map(Object.entries(this.decode_dict(state)))

        if (T.isSubclass(cls, Item) && state instanceof Array)      // all Item instances except unlinked ones are created/loaded through Registry
            return registry.getItem(state)

        state = this.decode(state)

        return T.setstate(cls, state)
    }

    // static encdec(obj)   { return this.decode(this.encode(obj))   }       // for testing purposes
    // static decenc(state) { return this.encode(this.decode(state)) }       // for testing purposes

    encode_list(values) {
        /* Encode recursively all non-primitive objects inside a list. */
        return values.map(v => this.encode(v))
    }
    decode_list(state) {
        /* Decode recursively all non-primitive objects inside a list. */
        return state.map(v => this.decode(v))
    }
    encode_dict(obj) {
        /* Encode recursively all non-primitive objects inside `state` dictionary. Drop keys with `undefined` value. */
        for (let [key, value] of Object.entries(obj)) {
            if (typeof key !== "string")
                throw new Error(`Non-serializable object state, contains a non-string key: ${key}`)
            if (value === undefined)
                delete obj[key]
        }
        return T.mapDict(obj, (k, v) => [k, this.encode(v)])
    }
    decode_dict(state) {
        /* Decode recursively all non-primitive objects inside `state` dictionary. */
        return T.mapDict(state, (k, v) => [k, this.decode(v)])
    }
}
