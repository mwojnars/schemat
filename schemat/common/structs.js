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

export class ObjectsMap extends CustomMap {
    /* A Map where keys are WebObject instances, converted to their IDs for underlying storage. */

    convert(obj) { return typeof obj === 'number' ? obj : obj.id }
    reverse(id)  { return schemat.get_object(id) }
}


/**********************************************************************************************************************/

export class Counter extends Map {
    /* A Map that holds counts of key occurrences. Provides methods to increment/decrement counts
       and to get items sorted by frequency. */

    constructor(iterable = null) {
        super()
        if (iterable)
            for (const key of iterable) this.increment(key)
    }

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

    total() {
        let t = 0
        this.forEach(v => t += v)
        return t
    }

    most_common(n = undefined) {
        // return array of [key, count] pairs sorted by count in descending order
        let items = Array.from(this.entries())
        items.sort((a, b) => b[1] - a[1])
        return n === undefined ? items : items.slice(0, n)
    }

    least_common(n = undefined) {
        // return array of [key, count] pairs sorted by count in ascending order
        let items = Array.from(this.entries())
        items.sort((a, b) => a[1] - b[1])
        return n === undefined ? items : items.slice(0, n)
    }
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
    /* A Set of web objects deduplicated by object.__index_id (both persisted and newborn objects supported).
       Adding another instance with the same ID (or provisional ID) removes the previous one.
       Deleting an object removes the corresponding ID, even if a different instance was stored under this ID.
     */
    _map = new Map()

    add(obj)        { this._map.set(obj.__index_id, obj); return obj }  // return value is different than in Set
    delete(obj)     { return this._map.delete(obj.__index_id) }
    get(obj)        { return this._map.get(obj.__index_id) }    // may return a different instance of the same web object, not `obj`
    has(obj)        { return this._map.has(obj.__index_id) }
    has_exact(obj)  { return this._map.get(obj.__index_id) === obj }
    ids()           { return this._map.keys() }
    keys()          { return this._map.values() }               // for compatibility with Set interface
    values()        { return this._map.values() }
    clear()         { this._map.clear() }

    get size()      { return this._map.size }
    get length()    { return this._map.size }

    [Symbol.iterator]() { return this._map.values() }
}

export class RecentObjects extends Objects {
    /* Like Objects, but when an existing ID is to be overwritten, `__meta.loaded_at` is compared and the more recent instance is kept.
       Supports only persisted objects (with proper ID), no newborns.
     */

    add(obj) {
        if (obj.id === undefined) throw new Error("missing 'id' for an object being added to RecentObjects")
        if (!this.hasNewer(obj)) this._map.set(obj.id, obj)
        return this
    }

    hasNewer(obj) {
        /* True if the set already contains an object with the same ID and a newer or equal `__meta.loaded_at`. */
        let prev = this._map.get(obj.id)
        return prev && (obj.__meta.loaded_at || 0) <= (prev.__meta.loaded_at || 0)
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

    fix_upwards(x) {
        /* Return `x` or the smallest number greater than `x` that belongs to the shard. */
        let offset = x % this.base
        let y = x - offset + this.offset
        return y >= x ? y : y + this.base
    }

    overlaps(shard) { return !!Shard.intersection(this, shard) }

    static common_base(...shards) {
        /* Return the least common multiple of the bases of the provided shards. */
        return shards.reduce((a, b) => lcm(a, b.base), 1)
    }

    static intersection(shard1, shard2) {
        /* Create a Shard that represents the set of numbers belonging to `shard1` _and_ `shard2` at the same time,
           or return null if the shards are disjoint and have no overlap. Calculated by first bringing both shards
           to the same base, and then comparing the sets of offsets occurring after the up-scaling.
         */
        let base = Shard.common_base(shard1, shard2)
        let scale1 = base / shard1.base
        let scale2 = base / shard2.base

        let offsets1 = [...Array(scale1).keys()].map(i => shard1.offset + i * shard1.base)
        let offsets2 = [...Array(scale2).keys()].map(i => shard2.offset + i * shard2.base)

        // find the intersection of the two sets, it should contain no more than one element
        let common = offsets1.filter(o => offsets2.includes(o))

        // if (common.length > 0) console.log(`shard ${shard1.label} overlaps with ${shard2.label} at ${common[0]}/${base} slice`)
        // if (common.length > 1) console.warn(`shard ${shard1.label} overlaps with ${shard2.label} at multiple offsets: ${common}`)
        assert(common.length <= 1)

        return common.length ? new Shard(common[0], base) : null
    }
}

/**********************************************************************************************************************/

export class LRU_Cache {
    /* Least Recently Used (LRU) cache based on a Map with a fixed capacity. Utilizes the fact that Map holds keys in insertion order. */

    constructor(capacity) {
        this._capacity = capacity
        this._cache = new Map()
    }

    _set_recent(key, value) {
        this._cache.delete(key)
        this._cache.set(key, value)
    }

    get(key) {
        let value = this._cache.get(key)
        if (value === undefined) return undefined
        this._set_recent(key, value)
        return value
    }

    set(key, value) {
        this._set_recent(key, value)
        if (this._cache.size > this._capacity) {
            let oldest_key = this._cache.keys().next().value
            if (oldest_key !== undefined) this._cache.delete(oldest_key)
        }
    }

    delete(key) { this._cache.delete(key) }
}

