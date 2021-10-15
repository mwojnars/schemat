/*
Utilities for JSON-pickling and serialization of objects of arbitrary classes.
*/

import {import_module} from 'importlib';
//import {DecodeError, EncodeError} from './errors';

// function _pj_snippets(container) {
//     function in_es6(left, right) {
//         if (((right instanceof Array) || ((typeof right) === "string"))) {
//             return (right.indexOf(left) > (- 1));
//         } else {
//             if (((right instanceof Map) || (right instanceof Set) || (right instanceof WeakMap) || (right instanceof WeakSet))) {
//                 return right.has(left);
//             } else {
//                 return (left in right);
//             }
//         }
//     }
//     function set_properties(cls, props) {
//         let desc, value;
//         let _pj_a = props;
//         for (let p in _pj_a) {
//             if (_pj_a.hasOwnProperty(p)) {
//                 value = props[p];
//                 if (((((! ((value instanceof Map) || (value instanceof WeakMap))) && (value instanceof Object)) && ("get" in value)) && (value.get instanceof Function))) {
//                     desc = value;
//                 } else {
//                     desc = {"value": value, "enumerable": false, "configurable": true, "writable": true};
//                 }
//                 Object.defineProperty(cls.prototype, p, desc);
//             }
//         }
//     }
//     container["in_es6"] = in_es6;
//     container["set_properties"] = set_properties;
//     return container;
// }
// let _pj = {};
// _pj_snippets(_pj);

// function classname(obj = null, cls = null) {
//     /* Fully qualified class name of an object 'obj' or class 'cls'. */
//     let name;
//     if ((cls === null)) {
//         cls = obj.__class__;
//     }
//     name = ((cls.__module__ + ".") + cls.__name__);
//     return name;
// }
// function import_(fullname) {
//     /*
//     Dynamic import of a python class/function/variable given its full (dotted) package-module name.
//     If no module name is present, __main__ is used.
//     */
//     let mod, module, name;
//     if (!fullname.includes("."))
//         [mod, name] = ["__main__", fullname];
//     else
//         [mod, name] = fullname.rsplit(".", 1);
//
//     module = import_module(mod);
//     try {
//         return module[name];
//     } catch(e) {
//         throw new ImportError(`cannot import name '${name}' from '${mod}'`);
//     }
// }

// function getstate(obj) { return obj; }

// function getstate(obj) {
//     /*
//     Retrieve object's state with __getstate__() or take it from __dict__.
//     `obj` shall not be an instance of a standard type: int/float/list/tuple/dict/NoneType...
//     */
//     let getstate_method, state;
//     getstate_method = (obj["__getstate__"] || null);
//     if (getstate_method) {
//         if ((! ("__self__" in getstate_method))) {
//             throw new TypeError(`expected an instance in getstate(), got a class`);
//         }
//         state = getstate_method();
//         if ((! (state instanceof dict))) {
//             throw new TypeError(`The result of __getstate__() is not a dict in ${obj}`);
//         }
//     } else {
//         state = (obj["__dict__"] || null);
//         if ((state === null)) {
//             throw new TypeError(`cannot retrieve state of an object of type <${Object.getPrototypeOf(obj)}>: ${obj}`);
//         }
//     }
//     return state;
// }

// function setstate(cls, state) {
//     /*
//     Create an object of a given class and set its state using __setstate__(), if present,
//     or by assigning directly to __dict__ otherwise.
//     */
//     let _setstate, obj;
//     obj = cls();
//     _setstate = (obj["__setstate__"] || null);
//     if (_setstate) {
//         _setstate(state);
//     } else {
//         try {
//             obj.__dict__ = dict(state);
//         } catch(e) {
//             throw e;
//         }
//     }
//     return obj;
// }

class JSONx {
    /*
    Dump & load arbitrary objects to/from JSON strings.
    Encode & decode arbitrary objects to/from JSON-compatible "state" composed of serializable types.
    */
    static FLAG_ITEM  = "(item)"       // special value of ATTR_CLASS that denotes a reference to an Item
    static FLAG_TYPE  = "(type)"       // special value of ATTR_CLASS that informs the value is a class rather than an instance
    static FLAG_DICT  = "(dict)"       // special value of ATTR_CLASS that denotes a dict wrapper for another dict containing the reserved "@" key
    static ATTR_CLASS = "@"            // special attribute appended to object state to store a class name (with package) of the object being encoded
    static ATTR_STATE = "="            // special attribute to store a non-dict state of data types not handled by JSON: tuple, set, type ...

    static dump(obj, type = null) {
        let state = JSONx.encode(obj, type);
        return JSON.stringify(state);
    }
    static load(dump, type = null) {
        let state = JSON.parse(dump);
        return JSONx.decode(state, type);
    }

    static getPrototype   = (obj) => Object.getPrototypeOf(obj) ? obj !== null : null
    static getClass       = (obj) => Object.getPrototypeOf(obj).constructor ? obj !== null : null      // reading constructor from prototype is slightly safer than directly from obj
    static isPrimitiveObj = (obj) => ["number","string", "boolean"].includes(typeof obj) || obj === null || obj === undefined
    static isPrimitiveCls = (cls) => [Number, String, Boolean, null].includes(cls)
    static isArray        = (obj) => (obj && Object.getPrototypeOf(obj) === Array.prototype)
    static isDict         = (obj) => (obj && Object.getPrototypeOf(obj) === Object.prototype)
    static ofType         = (x,T) => (x && T && Object.getPrototypeOf(x) === T.prototype)      // test if x is an object of class T exactly (NOT of a subclass)
    static isClass        = (C)   => (typeof C === "function" && C.prototype !== undefined)    // test if C is a class (a constructor function with .prototype)
    static isSubclass     = (C,B) => (C === B || C.prototype instanceof B)                     // test if C is subclass of B, including C===B

    static encode(obj, type = null) {
        /*
        Return a `state` that carries all the information needed for reconstruction of `obj` with decode(),
        yet it contains only JSON-compatible values and collections (possibly nested).
        Objects of custom classes are converted to dicts that store object's attributes,
        with a special attribute "@" added to hold the class name. Nested objects are encoded recursively.
        Optional `type` constraint is a class (constructor function).
        */
        let registry = globalThis.registry
        let of_type = JSONx.ofType(obj, type)
        let state

        if (JSONx.isPrimitiveObj(obj))  return obj
        if (JSONx.isArray(obj))         return JSONx.encode_list(obj)

        if (JSONx.isDict(obj)) {
            obj = JSONx.encode_dict(obj)
            if (! JSONx.ATTR_CLASS in obj) return obj
            return {[JSONx.ATTR_STATE]: obj, [JSONx.ATTR_CLASS]: JSONx.FLAG_DICT}
        }

        let Item = registry.get_class("hyperweb.core.Item")
        if (obj instanceof Item) {
            if (!obj.has_id()) throw `non-serializable Item instance with missing or incomplete ID: ${obj.id}`
            if (of_type) return obj.id                      // `obj` is of `type_` exactly? no need to encode type info
            return {[JSONx.ATTR_STATE]: obj.id, [JSONx.ATTR_CLASS]: JSONx.FLAG_ITEM}
        }
        if (JSONx.isClass(obj)) {
            state = registry.get_path(obj)
            return {[JSONx.ATTR_STATE]: state, [JSONx.ATTR_CLASS]: JSONx.FLAG_TYPE}
        }
        else
            if (obj instanceof Set)
                state = JSONx.encode_list(Array.from(obj))
            else {
                state = JSONx.encode_dict(obj)
                if (JSONx.ATTR_CLASS in state)
                    throw `non-serializable object state, a reserved character "${JSONx.ATTR_CLASS}" occurs as a key in the state dictionary`;
            }

        // if the exact class is known upfront, let's output compact state without adding "@" for class designation
        if (of_type) return state

        // wrap up the state in a dict, if needed, and append class designator
        if (!JSONx.isDict(state))
            state = {[JSONx.ATTR_STATE]: state}

        let t = JSONx.getPrototype(obj)
        state[JSONx.ATTR_CLASS] = registry.get_path(t);

        return state;
    }

    static decode(state, type = null) {
        /*
        Reverse operation to encode(): takes an encoded JSON-serializable `state` and converts back to an object.
        Optional `type` constraint is a class (constructor function).
        */
        let registry = globalThis.registry
        let isdict = JSONx.isDict(state)
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
                throw `ambiguous object state during decoding, the special key "${JSONx.ATTR_CLASS}" is not needed but present: ${state}`
            cls = type;
        }
        else if (!isdict)                               // `state` encodes a primitive value, or a list, or null;
            cls = JSONx.getClass(state)                 // cls=null denotes a class of null value

        else if (JSONx.ATTR_CLASS in state) {
            let classname = state[JSONx.ATTR_CLASS]
            delete state[JSONx.ATTR_CLASS]

            if (JSONx.ATTR_STATE in state) {
                let state_attr = state[JSONx.ATTR_STATE]
                if (state)
                    throw `invalid serialized state, expected only ${JSONx.ATTR_CLASS} and ${JSONx.ATTR_STATE} special keys but got others: ${state}`
                state = state_attr;
            }
            if (classname === JSONx.FLAG_ITEM)
                return registry.get_item(state);
            cls = registry.get_class(classname);
        }
        else cls = Object

        console.assert(cls !== undefined, {msg: "`cls` is undefined", state: state, type: type})

        // instantiate the output object; special handling for standard JSON types and Item
        if (JSONx.isPrimitiveCls(cls))  return state
        if (cls === Array)              return JSONx.decode_list(state)
        if (cls === Object)             return JSONx.decode_dict(state)
        if (cls === Set)                return new cls(JSONx.decode_list(state))

        let Item = registry.get_class("hyperweb.core.Item")
        if (JSONx.isSubclass(cls, Item))            // all Item instances must be created/loaded through the Registry
            return registry.get_item(state)

        let obj = JSONx.decode_dict(state)

        // return Object.create(cls, obj)
        return Object.setPrototypeOf(obj, cls)
    }

    static encode_list(values) {
        /* Encode recursively all non-primitive objects inside a list. */
        return values.map(JSONx.encode)
    }
    static decode_list(state) {
        /* Decode recursively all non-primitive objects inside a list. */
        return state.map(JSONx.decode)
    }
    static encode_dict(obj) {
        /* Encode recursively all non-primitive objects inside `state` dictionary. */
        for (const key of Object.getOwnPropertyNames(obj))
            if (typeof key !== "string")
                throw `non-serializable object state, contains a non-string key: ${key}`

        let entries = Object.entries(obj).map(([k, v]) => [k, JSONx.encode(v)])
        return Object.fromEntries(entries)

    }
    static decode_dict(state) {
        /* Decode recursively all non-primitive objects inside `state` dictionary. */
        let entries = Object.entries(state).map(([k, v]) => [k, JSONx.decode(v)])
        return Object.fromEntries(entries)
    }
}
