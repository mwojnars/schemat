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

// Object.prototype._toStringOriginal_ = Object.prototype.toString       // this makes React fail because of undeclared property
Object.prototype.toString = toString


/**********************************************************************************************************************
 **
 **  UTILITIES
 **
 */

export let print_stack = console.trace
export let print_trace = console.trace
export let print = console.log
print.stack = console.trace     // print.stack() is another way to print stack trace
print.trace = console.trace

export function assert(test, ...msg) {
    if (test) return true
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
    /* Same as `await import(path)`, but returns undefined if the import fails. The path must be absolute (!). */
    try {
        assert(!path.startsWith('.'), `tryimport(): path must be absolute, got '${path}'`)
        let module = await import(path)
        return property ? module[property] : module
    } catch(ex) {}
}

export const sleep = async (sec=0) => new Promise(resolve => setTimeout(resolve, sec * 1000))
export const sleep_ms = async (ms=0) => new Promise(resolve => setTimeout(resolve, ms))

export async function delay(ms, callback) {
    /* Run callback() after a delay [ms] and return its result. */
    return new Promise(resolve => setTimeout(() => resolve(callback?.()), ms))
}

export async function timeout(ms, error = new Error('Timeout'), unref = true) {
    /* Return a promise that rejects with `error` after `ms` milliseconds. */
    return new Promise((_, reject) => {
        let t = setTimeout(() => reject(error), ms)
        if (unref && SERVER) t.unref()
    })
}

export function utc() {
    /* Current UTC timestamp in human-readable format: "YYYY-MM-DD HH:mm:ss.sss", T/Z letters removed. */
    return new Date().toISOString().replace('T', ' ').replace('Z', '')
}


/*************************************************************************************************
 **
 **  ARRAYS
 **
 */

export function zip(...arrays) {
    /* Create an array of tuples, [(a1,b1), (a2,b2), ...], from multiple arrays. */
    const length = Math.min(...arrays.map(arr => arr.length))
    return Array.from({length}, (_, i) => arrays.map(arr => arr[i]))
}

export function concat(arrays) {
    /* Concatenate multiple arrays into a new array. */
    return [].concat(...arrays)
}

export function unique(array) {
    /* Filter out duplicates from `array` and return as a new array, order preserved. */
    return array.filter((x, i, a) => a.indexOf(x) === i)
}

export function deleteFirst(arr, x) {
    /* Find and delete the 1st occur. of `x` in the array. */
    let i = arr.indexOf(x);
    if (i > -1) arr.splice(i, 1);
    return (i > -1)
}

export function mapEntries(obj, fun) {
    /* Map entries of the object `obj` through the function, fun(key, value), and return as a new object.
       NO detection of collisions if two entries are mapped to the same key (!). */
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => fun(k, v)))
}

export async function amapEntries(obj, fun) {
    /* Like mapEntries, but for asynchronous fun(key, value). */
    return Object.fromEntries(await Promise.all(Object.entries(obj).map(([k, v]) => fun(k, v))))
}

export async function amap(arr, fun) {
    /* Async version of .map() for arrays. Awaits all individual promises returned by fun(). */
    return await Promise.all(arr.map(fun))
}

export async function arrayFromAsync(iterator) {
    /* Convert an async iterator into an array. */
    let arr = []
    if (isPromise(iterator)) iterator = await iterator
    for await (const v of iterator) arr.push(v)
    return arr
}


/*************************************************************************************************
 **
 **  OBJECTS
 **
 */

export function nullObject()    { return Object.create(null) }


// state management...

export function getstate(obj) {
    /* obj's class may define __getstate__() method to have full control over state generation;
       or __transient__ property to list attribute names to be excluded from an auto-generated state. */
    if (obj.__getstate__) return obj.__getstate__()
    if (obj.constructor?.__transient__) {
        let collect = []                            // combine __transient__ arrays from the prototype chain
        for (const trans of T.getInherited(obj.constructor, '__transient__'))
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

export function setstate(cls, state) {
    /* Create an object of class `cls` by calling cls.__setstate__(state); or create a plain object with cls's prototype
       and assign `state` to it directly. If cls.__setstate__() is async, setstate() returns a promise.
     */
    if (cls?.__setstate__) return cls.__setstate__(state)
    let obj = Object.create(cls?.prototype)
    // if (obj.__setstate__) return obj.__setstate__(state)     // __setstate__() must end with "return this" (!)
    return Object.assign(obj, state)
}

export function copy(obj, {class: _class, keep, drop} = {}) {
    /* Create a shallow copy of an object, `obj`. Copy all enumerable own properties, or only those listed in `keep`
       if present (an array or space-separated string). Skip the properties listed in `drop` (array/string).
       If class=true, the original class (prototype) of `obj` is preserved in the duplicate.
     */
    let dup = _class ? Object.create(Object.getPrototypeOf(obj)) : {}
    if (keep) {
        if (typeof keep === 'string') keep = keep.split(' ')
        for (let k of keep) dup[k] = obj[k]
    }
    else Object.assign(dup, obj)

    if (drop) {
        if (typeof drop === 'string') drop = drop.split(' ')
        for (let k of drop) delete dup[k]
    }
    return dup
}


/*************************************************************************************************
 **
 **  STRINGS
 **
 */

export function commonPrefix(s1, s2) {
    let N = Math.min(s1.length, s2.length)
    for (let i = 0; i < N; i++)
        if (s1[i] !== s2[i]) return s1.substring(0, i)
    return s1.substring(0, N)
}

export function commonSuffix(s1, s2) {
    let M = s1.length
    let N = s2.length
    let min = Math.min(M, N)
    for (let i = 0; i < min; i++)
        if (s1[M-i-1] !== s2[N-i-1]) return s1.substring(M-i)
    return s1.substring(M-N)
}

export function splitFirst(s, sep = ' ') {
    /* Split `s` on the first occurrence of `sep` and return BOTH substrings as [left, right].
       Return [s, ""] if no occurrence of `sep` was found. */
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

export function comma(items, sep = ', ') {
    /* Return a comma-separated (`sep`-separated) array of `items` without concatenating them as strings.
       Useful for React components that expect an array of children. */
    const list = []
    for (let i = 0; i < items.length; i++) {
        if (i > 0) list.push(sep)
        list.push(items[i])
    }
    return list
}


export function fileBaseName(filepath) {
    /* Extract the file name from the file path: drop the directory path and extension.
       Similar (although not identical) to: path.basename(filepath, path.extname(filepath))
       without importing the 'path' module.
     */
    return filepath.replace(/^.*\/|\.[^.]*$/g, '')
}

export function normalizePath(path) {
    /* Drop single dots '.' occurring as `path` segments; truncate parent segments wherever '..' occur. */
    while (path.includes('/./')) path = path.replaceAll('/./', '/')
    while (path.includes('//')) path = path.replaceAll('//', '/')
    let lead = path[0] === '/' ? path[0] : ''
    if (lead) path = path.slice(1)

    let parts = []
    for (const part of path.split('/'))
        if (part === '..')
            if (!parts.length) throw new Error(`incorrect path: '${path}'`)
            else parts.pop()
        else parts.push(part)

    return lead + parts.join('/')
}

export function joinPath(...parts) {
    /* Join path parts into a single path. */
    return normalizePath(parts.join('/'))
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

/*************************************************************************************************
 **
 **  TYPES
 **
 */

export class Types {
    /*
    A set of utility functions for working with objects and classes.
    Below, the term "dict" (dictionary) means an object of no specific class, i.e., an instance of Object;
    such objects are typically used to carry data, like <dict> in python, rather than to provide functionality.
    */

    // below, `null` is an expected (correct) argument, while `undefined` as incorrect, for all the functions;
    // getClass(null) returns null, getClass(3) returns Number, etc.

    static getOwnProperty = (obj, prop) => obj.hasOwnProperty(prop) ? obj[prop] : undefined
    static pop            = (obj, prop) => {        // getOwnProperty(obj) + delete prop + return value
        if (!obj.hasOwnProperty(prop)) return
        const val = obj[prop]
        delete obj[prop]
        return val
    }
    static subset       = (obj, ...props) => Object.fromEntries(props.map(p => [p, obj[p]]))    // return a new object with a subset of properties

    static getPrototype = (obj) => (obj == null) ? null : Object.getPrototypeOf(obj)
    static getClassName = (obj) => (obj == null) ? null : Object.getPrototypeOf(obj).constructor.name
    static getClass     = (obj) => (obj == null) ? null : Object.getPrototypeOf(obj).constructor      // reading constructor from prototype is slightly safer than directly from obj
    static setClass     = (obj,cls) => Object.setPrototypeOf(obj, cls.prototype)

    static isPrimitive      = (obj) => ["number", "string", "boolean"].includes(typeof obj) || obj === null
    static isPrimitiveClass = (cls) => [Number, String, Boolean, null].includes(cls)
    static isString       = (obj) => (typeof obj === 'string')
    static isNumber       = (obj) => (typeof obj === 'number' && !isNaN(obj))                 // true if obj is a valid number, not NaN
    static isArray        = (obj) => Array.isArray(obj)
    static isPOJO         = (obj) => (obj && Object.getPrototypeOf(obj) === Object.prototype) // true if obj is a plain object (POJO), no class assigned
    static isDict         = (obj) => (obj && Object.getPrototypeOf(obj) === null)             // true if obj is a null-prototype object (Object.create(null))
    static isPlain        = (obj) => (obj && (p => !p || p === Object.prototype)(Object.getPrototypeOf(obj)))   // true if obj is POJO or null-proto object
    static ofType         = (x, T) => (x && T && Object.getPrototypeOf(x) === T.prototype)    // true if x is an object of class T exactly (NOT of a subclass)
    static isFunction     = (f) => (f instanceof Function)                                    // true if f is a function; accepts class constructors, too (!)
    static isClass        = (C) => (typeof C === "function" && C.prototype !== undefined)     // true if C is a class (a constructor function with .prototype); false for arrays
    static isSubclass     = (C, B) => (C === B || C.prototype instanceof B)                   // true if C is subclass of B, including C===B
    static isNullish      = (obj) => (obj === null || obj === undefined)                      // true if obj is null or undefined
    static isEmpty        = (obj) => (!obj || Object.keys(obj).length === 0)
    static notEmpty       = (obj) => (obj && Object.keys(obj).length > 0)
    static isPromise      = (obj) => (obj instanceof Promise)

    // prototype chain & inheritance...

    static getAllPropertyNames(obj) {
        /* Return an array of all property names of `obj`, including inherited ones, also the ones from Object like toString(), constructor etc. */
        let attrs = []
        do {
            attrs.push(...Object.getOwnPropertyNames(obj))
            obj = Object.getPrototypeOf(obj)
        } while (obj)
        return Array.from(new Set(attrs))
    }

    static getPrototypes(obj) {
        /* Return a prototype chain (an array of all prototypes) of `obj`, starting at `obj` (included) and going upwards.
           `obj` can be an object (the chain ends at Object.prototype, excluded) or a class (the chain ends at Function.prototype, excluded).
         */
        const Object_proto = Object.prototype
        const Function_proto = Function.prototype
        let prototypes = []
        while (obj && obj !== Object_proto && obj !== Function_proto) {
            prototypes.push(obj)
            obj = Object.getPrototypeOf(obj)
        }
        return prototypes
    }

    static getInherited(obj, prop) {
        /* Return an array of all values of a property, `prop`, found in an object or class, `obj`, and its prototype chain.
           The array starts with the oldest value (from the top base class) and ends with the newest value (from `obj`). */
        return T.getPrototypes(obj).map(p => T.getOwnProperty(p, prop)).filter(v => v !== undefined).reverse()
    }
}

export const isPromise = Types.isPromise
export let T = Types                    // T is an alias for Types


/*************************************************************************************************
 **
 **  MATH
 **
 */

export function sum(...nums) {
    return nums.flat().reduce((a, b) => a + b, 0)
}

export function argmin(arr, order, direction = 1) {
    /* Position of the lowest element in `arr` according to the ordering function: order(a,b)*direction.
        If there are two or more such elements, their lowest index is returned.
     */
    if (!arr.length) return undefined
    if (!order) order = (a,b) => (a < b) ? -1 : (a > b) ? +1 : 0
    let pos = -1         // current position of the minimum
    arr.forEach((v,i) => { if ((v !== undefined) && (pos < 0 || order(v,arr[pos]) * direction < 0)) pos = i })
    return pos >= 0 ? pos : undefined
}
export function argmax(arr, order) { return argmin(arr, order, -1) }

export function min(arr, order) {
    /* Like Math.min(), but supports a custom ordering function, order(a,b), similar as array.sort() does;
        and auto-skips `undefined` values. The order(a,b) function should return -1, 0, or 1.
     */
    let pos = argmin(arr, order)
    if (pos === undefined) return undefined
    return arr[pos]
}

export function gcd(a, b) {
    /* Calculate the greatest common divisor using the Euclidean algorithm. */
    a = Math.abs(a)
    b = Math.abs(b)
    while (b) [a, b] = [b, a % b]
    return a
}

export function lcm(a, b) {
    /* Calculate the least common multiple using the formula: lcm(a,b) = |a*b|/gcd(a,b). */
    if (a === b) return a       // to speed up in this common case
    return Math.abs(a * b) / gcd(a, b)
}

export function randint(stop = Number.MAX_SAFE_INTEGER) {
    /* Random integer from 0 to stop-1. */
  return Math.floor(Math.random() * stop)
}

export function fluctuate(x, scale = 0.1) {
    /* Multiply `x` by random factor between (1-scale) and 1.0 to introduce some randomness. */
    return x * (1 - Math.random() * scale)
}

/**********************************************************************************************************************/

export async function *merge(order, ...streams) {
    /* Merge sorted streams according to the `order` function. Each stream should contain unique (non-equal) entries
       according to the `order`. If equal entries occur in different streams, only the "youngest" one
       (i.e., originating from a stream with the lowest index in `streams`) is included in the output.
       The streams can be asynchronous.
     */
    if (!order) order = (a,b) => (a < b) ? -1 : (a > b) ? +1 : 0

    // heads[i] is the next available element from the i'th stream; `undefined` if the stream is empty
    let heads = await amap(streams, async s => (await s.next()).value)
    let last, relation

    // drop empty streams
    streams = streams.filter((v,i) => (heads[i] !== undefined))
    heads   = heads.filter((v,i) => (v !== undefined))

    while (heads.length > 1 || (heads.length && relation === 0))
    {
        let pos = argmin(heads, order)          // index of the stream with the lowest next value
        assert(pos !== undefined)

        if (last !== undefined) {
            relation = order(last, heads[pos])
            if (relation > 0) throw new Error('ordering of an input stream is incompatible with the `order()` function')
        }

        if (last === undefined || relation < 0)
            yield (last = heads[pos])           // don't yield if relation==0 (a duplicate)

        heads[pos] = (await streams[pos].next()).value      // TODO (performance): drop await or pull batches of entries
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

/**********************************************************************************************************************/

export function Promises(check = false) {
    /* Creates a collection that will be filled with promises (.add()) to be awaited altogether (in parallel) at the end (await .all()). */

    let promises = []
    return {
        add: check ? 
            (p) => { if (p instanceof Promise) promises.push(p); return p } :
            (p) => { promises.push(p); return p },
        any: () => promises.length > 0,
        all: () => Promise.all(promises),
    }
}

export function PromisesChecked() {
    /* Like Promises, but skips non-promises during .add() to avoid unnecessary awaiting of synchronous code in .all(). */
    return Promises(true)
}
