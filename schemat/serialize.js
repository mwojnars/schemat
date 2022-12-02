/* Serialization of objects of arbitrary classes. */

import { T } from './utils.js'
import { Item } from './item.js'


/*************************************************************************************************/

export class JSONx {
    /*
    Dump & load arbitrary objects to/from JSON strings.
    Encode & decode arbitrary objects to/from JSON-compatible "state" composed of serializable types.
    */
    static FLAG_ITEM  = "(item)"       // special value of ATTR_CLASS that denotes a reference to an Item
    static FLAG_TYPE  = "(type)"       // special value of ATTR_CLASS that informs the value is a class rather than an instance
    static FLAG_DICT  = "(dict)"       // special value of ATTR_CLASS that denotes a dict wrapper for another dict containing the reserved "@" key
    static ATTR_CLASS = "@"            // special attribute appended to object state to store a class name (with package) of the object being encoded
    static ATTR_STATE = "="            // special attribute to store a non-dict state of data types not handled by JSON: tuple, set, type ...

    constructor() {
        // for now, this constructor is only used internally in static encode() & static decode()
        this.registry = globalThis.registry
    }

    static stringify(obj, type = null) {
        let flat = this.encode(obj, type)
        return JSON.stringify(flat)
    }
    static parse(dump, type = null) {
        let flat = JSON.parse(dump)
        return this.decode(flat, type)
    }

    static encode(obj, type = null)     { return new JSONx().encode(obj, type) }
    static decode(flat, type = null)    { return new JSONx().decode(flat, type) }

    encode(obj, type = null) {
        /*
        Return a `state` that carries all the information needed for reconstruction of `obj` with decode(),
        yet it contains only JSON-compatible values and collections (possibly nested).
        Objects of custom classes are converted to dicts that store object's attributes,
        with a special attribute "@" added to hold the class name. Nested objects are encoded recursively.
        Optional `type` constraint is a class (constructor function).
        */
        let registry = this.registry
        let of_type  = T.ofType(obj, type)
        let state

        if (obj === undefined)      throw "Can't encode an `undefined` value"
        if (T.isPrimitiveObj(obj))  return obj
        if (T.isArray(obj))         return this.encode_list(obj)

        if (T.isDict(obj)) {
            obj = this.encode_dict(obj)
            if (!(JSONx.ATTR_CLASS in obj)) return obj
            return {[JSONx.ATTR_STATE]: obj, [JSONx.ATTR_CLASS]: JSONx.FLAG_DICT}
        }

        if (obj instanceof Item && obj.has_id()) {
            // if (!obj.has_id()) throw `Non-serializable Item instance with missing or incomplete ID: ${obj.id}`
            if (of_type) return obj.id                      // `obj` is of `type_` exactly? no need to encode type info
            return {[JSONx.ATTR_STATE]: obj.id, [JSONx.ATTR_CLASS]: JSONx.FLAG_ITEM}
        }
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
            // state = this.encode_dict(state)                // TODO: allow non-dict state from getstate()
            if (JSONx.ATTR_CLASS in state)
                throw `Non-serializable object state, a reserved character "${JSONx.ATTR_CLASS}" occurs as a key in the state dictionary`;
        }

        // if the exact class is known upfront, let's output compact state without adding "@" for class designation
        if (of_type) return state

        // wrap up the state in a dict, if needed, and append class designator
        if (!T.isDict(state))
            state = {[JSONx.ATTR_STATE]: state}

        let t = T.getPrototype(obj)
        state[JSONx.ATTR_CLASS] = registry.getPath(t)

        return state
    }

    decode(state, type = null) {
        /*
        Reverse operation to encode(): takes an encoded JSON-serializable `state` and converts back to an object.
        Optional `type` constraint is a class (constructor function).
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
        if (type) {
            if (isdict && (JSONx.ATTR_CLASS in state) && !(JSONx.ATTR_STATE in state))
                throw `Ambiguous object state during decoding, the special key "${JSONx.ATTR_CLASS}" is not needed but present: ${state}`
            cls = type
        }
        else if (!isdict)                           // `state` encodes a primitive value, or a list, or null;
            cls = T.getClass(state)                 // cls=null denotes a class of null value

        else if (JSONx.ATTR_CLASS in state) {
            let classname = T.pop(state, JSONx.ATTR_CLASS)
            if (JSONx.ATTR_STATE in state) {
                let state_attr = T.pop(state, JSONx.ATTR_STATE)
                if (T.notEmpty(state))
                    throw `Invalid serialized state, expected only ${JSONx.ATTR_CLASS} and ${JSONx.ATTR_STATE} special keys but got others: ${state}`
                state = state_attr
            }
            if (classname === JSONx.FLAG_ITEM)
                return registry.getItem(state)
            cls = registry.getClass(classname)
        }
        else cls = Object

        console.assert(cls !== undefined, {msg: "`cls` is undefined", state, type})

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
        // state = this.decode_dict(state)

        // let obj = this.decode_dict(state)
        // Object.setPrototypeOf(obj, cls)
        // // let obj = Object.create(cls, obj)

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
        // return Promise.all(state.map(v => this.decode(v)))
    }
    encode_dict(obj) {
        /* Encode recursively all non-primitive objects inside `state` dictionary. Drop keys with `undefined` value. */
        for (let [key, value] of Object.entries(obj)) {
            if (typeof key !== "string")
                throw `Non-serializable object state, contains a non-string key: ${key}`
            if (value === undefined)
                delete obj[key]
        }
        return T.mapDict(obj, (k, v) => [k, this.encode(v)])
        // let entries = Object.entries(obj).map(([k, v]) => [k, this.encode(v)])
        // return Object.fromEntries(entries)
    }
    decode_dict(state) {
        /* Decode recursively all non-primitive objects inside `state` dictionary. */
        return T.mapDict(state, (k, v) => [k, this.decode(v)])
    }
}
