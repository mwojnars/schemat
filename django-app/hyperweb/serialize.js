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

