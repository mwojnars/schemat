/**********************************************************************************************************************
 **
 **  UTILITIES
 **
 */

export let print = console.log

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

