/*
    Useful data structures.
 */


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


