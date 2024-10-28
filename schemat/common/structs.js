/*
    Common data structures and algorithms.
 */

import {assert, commonPrefix, commonSuffix} from "./utils.js";


/**********************************************************************************************************************/

export class CustomMap extends Map {
    /* A Map that holds custom objects as keys. The keys are converted to a primitive type and then inserted to the map.
       The conversion is done by a subclass-specific `convert()` method (mandatory).
       If `reverse()` method is also defined in a subclass, the conversion is reversible, and the original objects
       can be iterated over with keys() or entries(). Otherwise, these two methods return the converted keys.
     */

    constructor(iterable = null) {
        super()
        for (const [k, v] of iterable || []) this.set(k, v)
    }

    convert(key)    { throw new Error(`CustomMap.convert() must be overridden in a subclass`) }
    reverse(key)    { return key }      // by default, return the converted key not the original one

    has(key)        { return super.has(this.convert(key)) }
    get(key)        { return super.get(this.convert(key)) }
    set(key, value) { return super.set(this.convert(key), value) }
    delete(key)     { return super.delete(this.convert(key)) }

    *keys()         { for (const key of super.keys()) yield this.reverse(key) }
    *entries()      { for (const [key, value] of super.entries()) yield [this.reverse(key), value] }
    *[Symbol.iterator]() { yield* this.entries() }

    *keys_decoded()     { yield* this.keys() }
    *keys_encoded()     { yield* super.keys() }

    *entries_decoded()  { yield* this.entries() }
    *entries_encoded()  { yield* super.entries() }
}


/**********************************************************************************************************************/

export class Counter extends Map {
    /* A Map that holds counts of key occurrences. If a count drops to zero (or below), the key is removed. */
    increment(key, increment = 1) {
        let count = (this.get(key) || 0) + increment
        this.set(key, count)
        return count
    }
    decrement(key, decrement = 1) {
        let count = this.increment(key, -decrement)
        if (count <= 0) this.delete(key)
        return count
    }

    total()     { let t = 0; this.forEach(v => t += v); return t }
}


/**********************************************************************************************************************/

export class Stack extends Array {
    /* A stack with push/pop() that additionally allows to pop a specific element that's buried deeper below the top. */

    pop(elem) {
        if (elem === undefined) return super.pop()
        let i = this.lastIndexOf(elem)
        if (i < 0) throw new Error(`element not found: ${elem}`)
        return this.splice(i, 1)[0]
    }
}

export class DependenciesStack extends Stack {
    /* A list of dependencies (web objects / modules) currently being processed. With printing of debug info. */

    debug  = false
    prefix = 'loading:'

    push(obj) {
        super.push(obj)
        if (this.debug) print(`${this.prefix}  + ${this._head(obj)}  ${this._tail()}`)
    }
    pop(obj) {
        obj = super.pop(obj)
        if (this.debug) print(`${this.prefix}  - ${this._head(obj)}  ${this._tail()}`)
        return obj
    }

    _head(obj)  { return `${obj}`.padEnd(25) }
    _tail()     { return `[${this.map(obj => `${obj}`).join(', ')}]` }
}


/**********************************************************************************************************************/

export class ObjectSet {
    /* A Set of objects deduplicated by object.id. When an existing ID is to be overwritten,
       the `__meta.loaded_at` property is compared and the most recent object is kept.
     */
    objects = new Map()

    add(obj) {
        if (obj.id === undefined) throw new Error("missing 'id' for the object to be added to the ObjectSet")
        if (!this.hasNewer(obj))
            this.objects.set(obj.id, obj)
        return this
    }

    delete(obj)     { return this.objects.delete(obj.id) }
    has(obj)        { return this.objects.has(obj.id) }
    ids()           { return this.objects.keys() }
    keys()          { return this.objects.values() }                // for compatibility with Set interface
    values()        { return this.objects.values() }
    clear()         { this.objects.clear() }

    hasNewer(obj) {
        /* True if the set already contains an object with the same ID and a newer or equal `__meta.loaded_at`. */
        let prev = this.objects.get(obj.id)
        return prev && (obj.__meta.loaded_at || 0) <= (prev.__meta.loaded_at || 0)
    }

    get size()      { return this.objects.size }
    get length()    { return this.objects.size }

    [Symbol.iterator]() { return this.objects.values() }

    forEach(callbackFn, thisArg) {
        this.objects.forEach((value) => {
            callbackFn.call(thisArg, value, value, this)
        })
    }
}

/**********************************************************************************************************************/

export function fast_diff(s1, s2, max_depth = 3, num_patches = 15, min_len = 3, min_patches = 3, tips = true) {
    /* Compute a list of replacements of the form [start, length, new_string] that transform `s1` string into `s2`.
       If there are no such short replacements, undefined is returned, meaning that it is more efficient to replace the entire string.
     */

    if (s1 === s2) return []

    let M = s1.length
    let N = s2.length
    let fl = Math.floor
    let opts = [num_patches, min_len, min_patches, false]

    if (max_depth <= 0 || M > 5*N || N > 5*M) return undefined      // too deep, or too much discrepancy between string lengths

    // cut off the tips
    if (tips) {
        let L = commonPrefix(s1, s2).length
        let R = commonSuffix(s1, s2).length
        if (L || R) {
            let plan = fast_diff(s1.substring(L, M-R), s2.substring(L, N-R), max_depth, ...opts)
            if (plan) return L ? plan.map(repl => [repl[0]+L, repl[1], repl[2]]) : plan
            if (L+R > 10) return [L, M-L-R, s2.substring(L, N-R)]
            return undefined
        }
    }

    num_patches = Math.min(num_patches, fl(N / min_len * 1.5))
    if (num_patches < min_patches) return

    let step = N / num_patches
    let margin = step / 3

    let patch = (i) => [fl(i*step), fl((i+1) * step + margin)]      // [start, end] of the i-th patch

    // array of true/false values indicating which patch exists in s1
    let patches = [...Array(num_patches).keys()].map(i => s1.includes(s2.substring(...patch(i))))
    if (patches.every(p => !p)) return

    // going in reverse order, sum up neighboring "true" values to find the longest sequence of true values
    for (let i = num_patches - 1; i >= 0; i--)
        if (patches[i]) patches[i] = 1 + (patches[i+1] || 0)
    
    // find the patch ("spot") having the maximum number of consecutive true values
    let max = Math.max(...patches)
    let imax = patches.findIndex(len => len === max)
    let [left, right] = patch(imax)
    let match = s1.indexOf(s2.substring(left, right))
    assert(match >= 0)

    // try to extend the `spot` to the left and to the right
    while (left > 0 && s1[match-1] === s2[left-1]) { left--; match-- }
    while (right < N && s1[match+right-left] === s2[right]) right++
    let length = right - left
    
    opts = [max_depth-1, ...opts]

    // return two replacements: on the left and on the right of the `spot`; the spot remains unchanged
    let left_repl = [0, match, s2.substring(0, left)]
    let right_repl = [match+length, M-match-length, s2.substring(right)]
    
    // TODO: recursive calls

    return [left_repl, right_repl]
}
