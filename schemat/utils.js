// console.log("utils.js imported")

/**********************************************************************************************************************
 **
 **  GLOBAL CONFIGURATION
 **
 */

export function toString() {
    /* Replacement for the standard Object.toString(). Improves the output by printing more detailed information. */

    // let json = trycatch(() => JSON.stringify(this), null)    -- this does NOT work due to circular call to toString() in stringify()
    if (this === undefined) return "undefined"
    const value = (v) => typeof v === 'object' ? `[${v.constructor.name}]` : JSON.stringify(v)
    let isObject = (this.constructor === Object)
    let sep = (isObject ? ', ' : ' ')
    let entries = trycatch(() => Object.entries(this).map(([k, v]) => k + `:${value(v)}`).join(sep))
    let summary = entries ? truncate(entries, 40) : ''

    if (isObject) return `{${summary}}`         // special display form for plain Objects: {...} with no class name

    let gap = summary ? ' ' : ''
    return `[${this.constructor.name}${gap}${summary}]`
}

Object.prototype.toString = toString


/**********************************************************************************************************************
 **
 **  UTILITIES
 **
 */

export let print = console.log

export function assert(test, msg = null) {
    if (test) return
    throw new Error(msg ? `assertion failed: ${msg}` : `assertion failed`)
    // console.assert(test)
}

export function trycatch(func, fail = null) {
    /* Call a function, func(), and return its result if no exception was raised; otherwise return `fail` value. */
    try {
        return func()
    } catch (e) {
        return fail
    }
}

export async function tryimport(path, property = null) {
    /* Same as `await import(path)`, but returns undefined if the import fails. */
    try {
        let module = await import(path)
        if (property) return module[property]
        return module
    } catch(ex) {}
}

const htmlEscapes = {
    '&': '&amp',
    '<': '&lt',
    // '>': '&gt',
    //'"': '&quot',
    //"'": '&#39'
}
const reUnescapedHtml = /[&<]/g

export function escape_html(string) {
    // reduced version of Lodash's escape(): https://github.com/lodash/lodash/blob/9d11b48ce5758df247607dc837a98cbfe449784a/escape.js
    return string.replace(reUnescapedHtml, (chr) => htmlEscapes[chr]);
}

export function dedent(text) {
    /* Remove all leading whitespace in each line of `text` and drop empty lines. */
    return text.trimLeft().replace(/\n\s+/g, '\n')
}

export function truncate(s, length = 255, {end = '...', killwords = false, maxdrop = null, leeway = 0} = {}) {
    /*
    Truncate a string `s` to a given maximum length, with ellipsis.
    If `killwords` is false, the last word will be discarded, unless the resulting string
    gets shorter than `maxdrop` characters only due to word preservation,
    in which case the word still gets split (not discarded).
    */

    // the implementation inspired by Jinja's truncate(): https://github.com/pallets/jinja/blob/main/src/jinja2/filters.py
    assert(length >= end.length, `expected length >= ${end.length}, got ${length}`)
    assert(leeway >= 0, `expected leeway >= 0, got ${leeway}`)

    if (s.length <= length + leeway) return s

    let maxlen = length - end.length                // maximum string length before appending the `end`
    let short = s.slice(0, maxlen)

    if (killwords) return short + end

    // let result = s.slice(0, maxlen).rsplit(" ", 1)[0]
    let words = short.split(' ')
    let result = words.slice(0, -1).join(' ')

    if (maxdrop !== null && (result.length === 0 || result.length < maxlen - maxdrop))
        result = short

    return result + end
}

export function splitFirst(s, sep = ' ') {
    /* Split `s` on the first occurrence of `sep` and return BOTH parts as an array, [left,right];
       or return [s,""] if no occurrence of `sep` was found. */
    let left = s.split(sep, 1)[0]
    let right = s.slice(left.length + sep.length)
    return [left, right]
}

export function splitLast(s, sep = ' ') {
    /* Split `s` on the last occurrence of `sep` and return BOTH parts as an array, [left,right];
       or return ["",s] if no occurrence of `sep` was found. */
    let right = s.split(sep).pop()
    let left = s.substring(0, s.length - right.length - sep.length)
    return [left, right]
}

export function sleep(millis) {
    return new Promise(resolve => setTimeout(resolve, millis))
}

/*************************************************************************************************/

export class Types {
    /*
    A set of utility functions for working with objects and classes.
    Below, the term "dict" (dictionary) means an object of no specific class, i.e., an instance of Object;
    such objects are typically used to carry data, like <dict> in python, rather than to provide functionality.
    */

    // below, `null` is an expected (correct) argument, while `undefined` as incorrect, for all the functions;
    // getClass(null) returns null, getClass(3) returns Number, etc.

    static getOwnProperty = (obj, prop) => obj.hasOwnProperty(prop) ? obj[prop] : undefined
    static get            = (obj, prop) => obj.hasOwnProperty(prop) ? obj[prop] : undefined      // alias for getOwnProperty()
    static pop            = (obj, prop) => {                         // pop() = get() own property of `obj`, delete, return value
        if (!obj.hasOwnProperty(prop)) return undefined
        let x = obj[prop];
        delete obj[prop];
        return x
    }
    static getPrototype = (obj) => (obj == null) ? null : Object.getPrototypeOf(obj)
    static getClassName = (obj) => (obj == null) ? null : Object.getPrototypeOf(obj).constructor.name
    static getClass     = (obj) => (obj == null) ? null : Object.getPrototypeOf(obj).constructor      // reading constructor from prototype is slightly safer than directly from obj
    static setClass     = (obj,cls) => Object.setPrototypeOf(obj, cls.prototype)

    static isPrimitiveObj = (obj) => ["number", "string", "boolean"].includes(typeof obj) || obj === null
    static isPrimitiveCls = (cls) => [Number, String, Boolean, null].includes(cls)
    static isNumber       = (obj) => (typeof obj === 'number' && !isNaN(obj))                 // test if obj is a valid number, not NaN
    static isArray        = (obj) => (obj && Object.getPrototypeOf(obj) === Array.prototype)
    static isDict         = (obj) => (obj && Object.getPrototypeOf(obj) === Object.prototype) // test if obj is a pure object (dict), no class assigned
    static ofType         = (x, T) => (x && T && Object.getPrototypeOf(x) === T.prototype)    // test if x is an object of class T exactly (NOT of a subclass)
    static isClass        = (C) => (typeof C === "function" && C.prototype !== undefined)     // test if C is a class (a constructor function with .prototype); false for arrays
    static isSubclass     = (C, B) => (C === B || C.prototype instanceof B)             // test if C is subclass of B, including C===B
    static isMissing      = (obj) => (obj === null || obj === undefined)                // test if obj is null or undefined (two cases of "missingness")
    static isEmpty        = (obj) => (!obj || Object.keys(obj).length === 0)
    static notEmpty       = (obj) => (obj && Object.keys(obj).length > 0)

    static deleteFirst = (arr, x) => {
        let i = arr.indexOf(x);
        if (i > -1) arr.splice(i, 1);
        return (i > -1)
    }  // find and delete the 1st occur. of x in array

    // create a new object (dict) by mapping items of `obj` to new [key,value] pairs;
    // does NOT detect if two entries are mapped to the same key (!)
    static mapDict = (obj, fun) => Object.fromEntries(Object.entries(obj).map(([k, v]) => fun(k, v)))

    // like mapDict, but for asynchronous `fun`
    static amapDict = async (obj, fun) =>
        Object.fromEntries(await Promise.all(Object.entries(obj).map(async ([k, v]) => await fun(k, v))))

    static amap = async (arr, fun) => await Promise.all(arr.map(async v => await fun(v)))

    static getstate = (obj) => obj['__getstate__'] ? obj['__getstate__']() : obj
    static setstate = (cls, state) => {
        // create an object of class `cls` and call its __setstate__() if present, or assign `state` directly;
        // __setstate__() can be async, in such case setstate() returns a promise;
        // __setstate__() must end with "return this" (!)
        let obj = new cls()
        if (obj['__setstate__']) return obj['__setstate__'](state)
        return Object.assign(obj, state)
    }
    static clone = (obj) => Object.assign(Object.create(Object.getPrototypeOf(obj)), obj)
}

export class T extends Types {}     // T is an alias for Types


/**********************************************************************************************************************
 **
 **  ERRORS
 **
 */

export class DataError extends Error {}
export class ValueError extends DataError {}

export class ItemNotLoaded extends Error {
    constructor(item) {
        super(`item is not loaded yet, call 'await item.load()' first: ${item}`)
    }
}
export class ServerError extends Error {
    /* Raised on client side when an internal call to the server completed with a not-OK status code. */
    constructor(response) {
        super()
        this.response = response            // an original Response object as returned from fetch()
    }
}

