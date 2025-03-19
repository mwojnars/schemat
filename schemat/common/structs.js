/*
    Common data structures and algorithms.
 */

import {assert, commonPrefix, commonSuffix, lcm} from "./utils.js";


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

export class Objects {
    /* A Set of objects deduplicated by object.id, serialized as a sorted array of IDs (todo).
       When an existing ID is to be overwritten, the `__meta.loaded_at` property is compared and the most recent object is kept.
     */
    objects = new Map()

    add(obj) {
        if (obj.id === undefined) throw new Error("missing 'id' for the object to be added to the Objects")
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

export class SpotDiff {
    /* Spot-diff is O(n) algorithm for detecting a (limited) number of localised changes in a larger text.
       It computes a list of replacements of the form [start, length, new_string] that together
       - when applied one by one in the provided order - will transform `s1` string into `s2`.
       The maximum number of replacements that can be returned is 2^max_depth -- if this is smaller than
       the actual number of changes, some neighboring changes are represented by a single replacement.
       If no good (short enough) replacement can be found, undefined is returned, meaning that it is more efficient
       to replace the entire string than to compute a difference. Spot-diff is a heuristic, it occasionally returns suboptimal plans.
     */

    static apply(s, replacements) {
        /* Apply replacements produced by compute() to the string `s`. */
        for (const [start, length, new_string] of replacements)
            s = s.substring(0, start) + new_string + s.substring(start + length)
        return s
    }

    static compute(s1, s2, max_depth = 3, num_patches = 15, min_len = 4, min_patches = 4, min_improvement = 0.1, penalty = 10) {

        let M = s1.length
        let N = s2.length

        // cut off the tips: common prefix/suffix
        let L = commonPrefix(s1, s2).length
        let R = commonSuffix(s1, s2).length

        // build the replacement plan
        let plan = this._diff(s1.substring(L, M-R), s2.substring(L, N-R), max_depth, num_patches, min_len, min_patches)

        // check if the plan is at least 20% shorter than the full replacement, return undefined if not;
        // `penalty` expresses the additional fixed cost of representing each replacement
        let plan_length = plan.reduce((sum, repl) => sum + repl[2].length, 0)
        if (plan_length + penalty * plan.length >= N * (1 - min_improvement)) return undefined

        if (L) plan = plan.map(repl => [repl[0]+L, repl[1], repl[2]])
        return plan
    }

    static _diff(s1, s2, max_depth, num_patches, min_len, min_patches) {
        /* The core of the FastDiff algorithm. Always returns a plan, never undefined; does NOT truncate the tips (prefix/suffix).
           The plan is a list of replacements of the form [start, length, new_string], where every `start` position is
           relative to the original string, and replacements are ordered by *decreasing* start positions, so during execution of the plan,
           each start position remains valid even after the previous replacements have been applied.
         */

        if (s1 === s2) return []

        let M = s1.length
        let N = s2.length
        let full = [[0, M, s2]]             // full replacement of s1 by s2

        // already too deep? or too much discrepancy between string lengths? or one of the strings is empty?
        if (max_depth <= 0 || M > 5*N || N > 5*M) return full

        let fl = Math.floor
        num_patches = Math.min(num_patches, fl(N / (min_len * 3/4)))
        if (num_patches < min_patches) return full

        let step = N / num_patches
        let margin = step / 3

        let patch = (i) => [fl(i*step), fl((i+1) * step + margin)]      // [start, end] of the i-th patch

        // array of true/false values indicating which patch exists in s1
        let patches = [...Array(num_patches).keys()].map(i => s1.includes(s2.substring(...patch(i))))
        if (!patches.some(p => p)) return full

        // going in reverse order, sum up neighboring "true" values to find the longest sequence of true values
        for (let i = num_patches - 1; i >= 0; i--)
            if (patches[i]) patches[i] = 1 + (patches[i+1] || 0)

        // find the "spot": likely the largest patch in s2 that matches a substring of s1 and can be extended on both sides
        let max = Math.max(...patches)
        let imax = patches.indexOf(max)
        let [left, right] = patch(imax)
        let match = s1.indexOf(s2.substring(left, right))
        assert(match >= 0)

        // try to extend the spot to the left and to the right
        while (left > 0 && s1[match-1] === s2[left-1]) { left--; match-- }
        while (right < N && s1[match+right-left] === s2[right]) right++
        let length = right - left

        let opts = [max_depth-1, num_patches, min_len, min_patches]

        // do recursive calls to find replacements for the left and right substrings surrounding the spot
        let left_plan = this._diff(s1.substring(0, match), s2.substring(0, left), ...opts)
        let right_plan = this._diff(s1.substring(match+length, M), s2.substring(right, N), ...opts)

        // shift positions in right_plan by the offset of the right edge of the spot (match+length)
        right_plan = right_plan.map(repl => [repl[0]+match+length, repl[1], repl[2]])

        return [...right_plan, ...left_plan]
    }
}

/**********************************************************************************************************************/

export class Shard {
    /* Abstract representation of a shard of integers (e.g., object IDs). A pair of the form (offset, base),
       where `offset` is the remainder and `base` is the divisor for testing if a value belongs to the shard.
       Namely, a non-negative integer, X, belongs to the shard iff (X % base) == offset.
       This class provides basic arithmetic operations on shards.
     */
    
    constructor(offset, base) {
        assert(Number.isInteger(offset) && Number.isInteger(base))
        assert(0 <= offset && offset < base && base > 0)

        this.offset = offset    // the remainder, a number in [0,1,...,base-1]
        this.base = base        // the divisor
    }

    __getstate__()              { return [this.offset, this.base] }
    static __setstate__(state)  { return new this(...state) }

    get label() { return `${this.offset}/${this.base}` }
    includes(x) { return (x % this.base) === this.offset }

    next_after(x) {
        /* Return the smallest number greater than `x` that belongs to the shard. */
        return x + (this.base - (x % this.base))
    }

    fix_upwards(x) {
        /* Return `x` if it belongs to the shard, or the smallest number greater than `x` that belongs to the shard. */
        return this.next_after(x - 1)
    }

    static common_base(shards) {
        /* Return the least common multiple of the bases of the provided shards. */
        return shards.reduce((a, b) => lcm(a, b.base), 1)
    }

    overlaps(shard) {
        /* Return true if this shard overlaps with `shard`. Calculated by first bringing both shards to the same base,
           and then comparing the sets of offsets occurring after the up-scaling.
         */
        let base = Shard.common_base([this, shard])
        let scale1 = base / this.base
        let scale2 = base / shard.base

        let offsets1 = [...Array(scale1).keys()].map(i => this.offset + i * this.base)
        let offsets2 = [...Array(scale2).keys()].map(i => shard.offset + i * shard.base)

        // find the intersection of the two sets
        let common = offsets1.filter(o => offsets2.includes(o))
        // if (common.length > 0) console.log(`shard ${this.label} overlaps with ${shard.label} at ${common[0]}/${base} slice`)

        return common.length > 0
    }
}

