// console.log("utils.js imported") ...

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
    return `[${this.constructor?.name || 'Object'}${gap}${summary}]`
}

Object.prototype.toString = toString


/**********************************************************************************************************************
 **
 **  UTILITIES
 **
 */

export let print = console.log

export function assert(test, ...msg) {
    if (test) return
    throw new Error(msg.length ? `assertion failed: ${msg.length==1 ? msg[0] : msg}` : `assertion failed`)
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

// def del_indent(text, indent = None):
//     """
//     Remove `indent` string from the beginning of each line of `text`, wherever it is present as a line prefix.
//     If indent=None, maximum common indentation (get_indent()) is truncated.
//     """
//     if indent is None: indent = get_indent(text)
//     if text.startswith(indent): text = text[len(indent):]
//     return text.replace('\n' + indent, '\n')
//
// def get_indent(text):
//     """
//     Retrieve the longest indentation string fully composed of whitespace
//     that is shared by ALL non-empty lines in `text`, including the 1st line (if it contains a non-whitespace).
//     """
//     lines = text.split('\n')
//     lines = list(filter(None, [l.rstrip() for l in lines]))             # filter out empty or whitespace-only lines
//     # lines = list(filter(None, [l if l.strip() else '' for l in lines]))          # filter out empty lines
//     if not lines: return ''
//
//     # iterate over columns (!) of `text`, from left to right
//     for i, column in enumerate(zip(*lines)):        # zip() only eats up as many characters as the shortest line
//         if not column[0].isspace() or min(column) != max(column):
//             return lines[0][:i]
//     else:
//         size = min(map(len, lines))
//         return lines[0][:size]                      # when all lines are prefixes of each other take the shortest one

export function indent(text, prefix = ' ') {
    /* Return `text` with `prefix` prepended to every line. */
    return prefix + text.replace(/\n/g, '\n' + prefix)
}

export function dedentFull(text) {
    /* Remove all leading whitespace in each line of `text` and drop empty lines. */
    return text.trimLeft().replace(/\n\s+/g, '\n')
}

export function dedentCommon(text) {
    /* Remove the longest common whitespace prefix of non-empty lines. Drop leading empty lines & trailing whitespace. */
    if (!text.trim()) return text
    text = text.trimRight()
    text = text.replace(/^\s*\n/g, '')                          // drop leading empty lines
    text = text.replace(/\t/g, '    ')                          // replace each tab character with 4x spaces
    let prefixes = text.match(/(?<=^|\n) *(?=\S)/g)
    let common = Math.min(...prefixes.map(p => p.length))       // length of the shortest prefix
    if (!common) return text
    let pattern = new RegExp(`(?<=^|\\n) {${common}}`, 'g')
    text = text.replace(pattern, '')
    return text
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
       or return [s,""] if no occurrence of `sep` was found. */
    if (!s.includes(sep)) return [s, ""]
    let right = s.split(sep).pop()
    let left = s.substring(0, s.length - right.length - sep.length)
    return [left, right]
}


export function concat(...arrays) {
    /* Concatenate multiple arrays or iterators into an array. */
    return [].concat(...arrays)
}

export function unique(array) {
    /* Filter out duplicates from `array` and return as a new array, order preserved. */
    return array.filter((x, i, a) => a.indexOf(x) === i)
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
    static isFunction     = (f) => (f instanceof Function)                                    // test if f is a function; accepts class constructors, too (!)
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
        Object.fromEntries(await Promise.all(Object.entries(obj).map(([k, v]) => fun(k, v))))
        // Object.fromEntries(await Promise.all(Object.entries(obj).map(async ([k, v]) => await fun(k, v))))

    static amap = async (arr, fun) => await Promise.all(arr.map(fun))

    static inherited(cls, attr) {
        /* Return an array of all values of a static attribute, `attr`, found in `cls` and its prototype chain.
           Top base class'es value is placed at the beginning of the array, while the value found in `cls` is at the end. */
        let values = []
        while (true) {
            if (!cls || cls === Object || cls === Object.prototype) break
            if (Object.getOwnPropertyNames(cls).includes(attr)) values.push(cls[attr])
            cls = Object.getPrototypeOf(cls)
        }
        return values.reverse()
    }
    static inheritedMerge(cls, attr) {
        /* Like inherited(), but assumes the values are objects and returns them merged into a single object. */
        return Object.assign({}, ...T.inherited(cls, attr))
    }

    static getstate = (obj) => {
        /* obj's class may define __getstate__() method to have full control over state generation;
           or __transient__ property to with a list of attribute names to be excluded from an auto-generated state. */
        if (obj.__getstate__) return obj.__getstate__()
        if (obj.constructor?.__transient__) {
            let collect = []                            // combine __transient__ arrays from the prototype chain
            for (const trans of T.inherited(obj.constructor, '__transient__'))
                if (trans instanceof Array && trans !== collect[collect.length-1]) collect.push(trans)
            let transient = [].concat(...collect)
            if (transient.length) {
                let state = {...obj}
                transient.forEach(attr => {delete state[attr]})
                return state
            }
        }
        return obj
    }
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

export class Maths {
    /* Common math operations. */

    static argmin = (arr, order, direction = 1) => {
        if (!arr.length) return undefined
        if (!order) order = (a,b) => (a < b) ? -1 : (a > b) ? +1 : 0
        let pos = -1         // current position of the minimum
        arr.forEach((v,i) => { if ((v !== undefined) && (pos < 0 || order(v,arr[pos]) * direction < 0)) pos = i })
        return pos >= 0 ? pos : undefined
    }
    static argmax = (arr, order) => { return Maths.argmax(arr, order, -1) }

    static min = (arr, order) => {
        /* Like Math.min(), but supports a custom ordering function, order(a,b), similar as array.sort() does;
           and auto-skips `undefined` values. The order(a,b) function should return -1, 0, or 1.
         */
        let pos = Maths.argmin(arr, order)
        if (pos === undefined) return undefined
        return arr[pos]
    }
    // static min = (arr, order) => {
    //     if (!order) order = (a,b) => (a < b) ? -1 : (a > b) ? +1 : 0
    //     let min = arr[0]
    //     arr.forEach(v => {if (order(min,v) < 0) min = v})
    //     return min
    // }

}

export let T = Types                    // T is an alias for Types
export let M = Maths                    // M is an alias for Maths


/**********************************************************************************************************************
 **
 **  ERRORS
 **
 */

export class BaseError extends Error {
    static message = null           // default message
    static code    = 500            // default HTTP status code

    // instance attributes
    name                            // name of the error, typically a class name (default)
    code                            // HTTP status code for the client if the error is returned as a response
    args                            // object {...} with arbitrary error-specific fields providing additional context
    message                         // message string

    constructor(msg  = undefined,
                args = undefined,
                code = undefined,
                name = undefined)
    {
        super()
        this.name = name || this.constructor.name
        this.code = code || this.constructor.code
        this.args = args

        if (msg && typeof msg !== 'string') { args = msg; msg = null; }
        this.message = msg || this.constructor.message

        if (args) {     // TODO: drop this, it's a hack around JS engines NOT calling toString() when printing an exception
            let argss = Object.entries(args).map(([k, v]) => k + `=${JSON.stringify(v)}`).join(', ')
            if (this.message) this.message += ', ' + argss
            else this.message = argss
        }
    }

    toString() {

    }
}

export class NotFound extends BaseError {
    static message = "URL not found"
    static code    = 404
}

export class NotImplemented extends BaseError {
    static message = "not implemented"
}

export class DataError extends BaseError {}
export class ValueError extends DataError {}

export class ItemDataNotLoaded extends BaseError {
    constructor(item) { super(`item.data is not loaded yet, call 'await item.load()' first: ${item}`) }
}
export class ItemNotLoaded extends BaseError {
    constructor(item) { super(`item is not loaded yet, call 'await item.load()' first: ${item}`) }
}

export class ServerError extends BaseError {
    /* Raised on client side when an internal call to the server completed with a non-OK status code. */
    constructor(response) {
        super()
        this.response = response            // an original Response object as returned from fetch()
    }
}

export class RequestFailed extends BaseError {
    /* Raised client-side when an internal call to the server completed with an error status code. */
    constructor({message, args, code, name}) {
        super(message, args, code, name)
    }
}



/**********************************************************************************************************************/

export async function *merge(order, ...streams) {
    /* Merge sorted streams according to the `order` function. The streams can be asynchronous. */

    if (!order) order = (a,b) => (a < b) ? -1 : (a > b) ? +1 : 0

    // heads[i] is the next available element from the i'th stream; `undefined` if the stream is empty
    let heads = await T.amap(streams, async s => (await s.next()).value)
    let last

    // drop empty streams
    streams = streams.filter((v,i) => (heads[i] !== undefined))
    heads   = heads.filter((v,i) => (v !== undefined))

    while (heads.length > 1) {
        let pos = M.argmin(heads, order)        // index of the stream with the lowest next value
        assert(pos !== undefined)
        if (last !== undefined && order(last, heads[pos]) > 0)
            throw new Error('ordering of an input stream is incompatible with the `order()` function')
        yield (last = heads[pos])
        // last = heads[pos]
        // yield heads[pos]

        heads[pos] = (await streams[pos].next()).value
        if (heads[pos] === undefined) {         // drop the stream if no more elements
            streams.splice(pos, 1)
            heads.splice(pos, 1)
        }
    }
    if (heads.length) {                         // when a single source remains forward all of its contents without intermediate heads[] and argmin()
        yield heads[0]
        yield* streams[0]
    }
}
