/* Serialization of objects of arbitrary classes. */

import { T } from './utils.js'


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
    static PATH_ITEM  = "schemat.item.Item"

    // static dump(obj, type = null) {
    //     let state = JSONx.encode(obj, type);
    //     return JSON.stringify(state);
    // }
    // static async load(dump, type = null) {
    //     let state = JSON.parse(dump);
    //     return await JSONx.decode(state, type);
    // }

    static encode(obj, type = null) {
        /*
        Return a `state` that carries all the information needed for reconstruction of `obj` with decode(),
        yet it contains only JSON-compatible values and collections (possibly nested).
        Objects of custom classes are converted to dicts that store object's attributes,
        with a special attribute "@" added to hold the class name. Nested objects are encoded recursively.
        Optional `type` constraint is a class (constructor function).
        */
        let registry = globalThis.registry
        let of_type = T.ofType(obj, type)
        let state

        if (obj === undefined)      throw "Can't encode an `undefined` value"
        if (T.isPrimitiveObj(obj))  return obj
        if (T.isArray(obj))         return JSONx.encode_list(obj)

        if (T.isDict(obj)) {
            obj = JSONx.encode_dict(obj)
            if (!(JSONx.ATTR_CLASS in obj)) return obj
            return {[JSONx.ATTR_STATE]: obj, [JSONx.ATTR_CLASS]: JSONx.FLAG_DICT}
        }

        let Item = registry.get_class(JSONx.PATH_ITEM)
        if (obj instanceof Item) {
            if (!obj.has_id()) throw `Non-serializable Item instance with missing or incomplete ID: ${obj.id}`
            if (of_type) return obj.id                      // `obj` is of `type_` exactly? no need to encode type info
            return {[JSONx.ATTR_STATE]: obj.id, [JSONx.ATTR_CLASS]: JSONx.FLAG_ITEM}
        }
        if (T.isClass(obj)) {
            state = registry.get_path(obj)
            return {[JSONx.ATTR_STATE]: state, [JSONx.ATTR_CLASS]: JSONx.FLAG_TYPE}
        }
        else if (obj instanceof Set)
            state = JSONx.encode_list(Array.from(obj))
        else if (obj instanceof Map)
            state = JSONx.encode_dict(Object.fromEntries(obj.entries()))
        else {
            state = T.getstate(obj)
            // if (obj !== state) state = JSONx.encode(state)
            // if (T.isDict(obj))
            state = JSONx.encode_dict(state)                // TODO: allow non-dict state from getstate()
            if (JSONx.ATTR_CLASS in state)
                throw `Non-serializable object state, a reserved character "${JSONx.ATTR_CLASS}" occurs as a key in the state dictionary`;
        }

        // if the exact class is known upfront, let's output compact state without adding "@" for class designation
        if (of_type) return state

        // wrap up the state in a dict, if needed, and append class designator
        if (!T.isDict(state))
            state = {[JSONx.ATTR_STATE]: state}

        let t = T.getPrototype(obj)
        state[JSONx.ATTR_CLASS] = registry.get_path(t)

        return state
    }

    static async decode(state, type = null) {
        /*
        Reverse operation to encode(): takes an encoded JSON-serializable `state` and converts back to an object.
        Optional `type` constraint is a class (constructor function).
        This function is MUTATING: the internal contents of `state` may get modified to avoid sub-object copy (!).
        */
        let registry = globalThis.registry
        let isdict = T.isDict(state)
        let cls

        // decoding of a wrapped-up dict that contained a pre-existing '@' key
        if (isdict && (state[JSONx.ATTR_CLASS] === JSONx.FLAG_DICT)) {
            if (JSONx.ATTR_STATE in state)
                state = state[JSONx.ATTR_STATE]
            return JSONx.decode_dict(state)
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
                return registry.get_item(state)
            cls = registry.get_class(classname)
        }
        else cls = Object

        console.assert(cls !== undefined, {msg: "`cls` is undefined", state, type})

        // instantiate the output object; special handling for standard JSON types and Item
        if (T.isPrimitiveCls(cls))  return state
        if (cls === Array)          return JSONx.decode_list(state)
        if (cls === Object)         return JSONx.decode_dict(state)
        if (cls === Set)            return new Set(await JSONx.decode_list(state))
        if (cls === Map)
            return new Map(Object.entries(await JSONx.decode_dict(state)))

        let Item = registry.get_class(JSONx.PATH_ITEM)
        if (T.isSubclass(cls, Item))            // all Item instances must be created/loaded through the Registry
            return registry.get_item(state)

        state = await JSONx.decode_dict(state)
        // let obj = JSONx.decode_dict(state)
        // Object.setPrototypeOf(obj, cls)
        // // let obj = Object.create(cls, obj)

        return T.setstate(cls, state)
    }

    static async encdec(obj)   { return await JSONx.decode(JSONx.encode(obj))   }       // for testing purposes
    static async decenc(state) { return JSONx.encode(await JSONx.decode(state)) }       // for testing purposes

    static encode_list(values) {
        /* Encode recursively all non-primitive objects inside a list. */
        return values.map(v => JSONx.encode(v))
    }
    static async decode_list(state) {
        /* Decode recursively all non-primitive objects inside a list. */
        return Promise.all(state.map(async v => await JSONx.decode(v)))
    }
    static encode_dict(obj) {
        /* Encode recursively all non-primitive objects inside `state` dictionary. Drop keys with `undefined` value. */
        for (let [key, value] of Object.entries(obj)) {
            if (typeof key !== "string")
                throw `Non-serializable object state, contains a non-string key: ${key}`
            if (value === undefined)
                delete obj[key]
        }
        return T.mapDict(obj, (k, v) => [k, JSONx.encode(v)])
        // let entries = Object.entries(obj).map(([k, v]) => [k, JSONx.encode(v)])
        // return Object.fromEntries(entries)
    }
    static async decode_dict(state) {
        /* Decode recursively all non-primitive objects inside `state` dictionary. */
        return T.amapDict(state, async (k, v) => [k, await JSONx.decode(v)])
        // let entries = await Promise.all(Object.entries(state).map(async ([k, v]) => [k, await JSONx.decode(v)]))
        // return Object.fromEntries(entries)
    }
}
