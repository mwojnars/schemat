import {T, print, assert, splitFirst, getstate, setstate} from '../common/utils.js'
import {JSONx} from "../common/jsonx.js"


/**********************************************************************************************************************
 **
 **  UTILITIES
 **
 */

class FieldPathNotFound extends Error {}


function isstring(s) {
    return s === null || s === undefined || typeof s === 'string'
}

export class Path {
    /* Static methods for manipulating access paths pointing into nested objects.
       A path can be a /-separated string, "A/B/C...", or an array of steps, each step being a name or an index,
       like in ["A", 2, "C", 5].
     */

    static SEPARATOR = '/'

    static split(path) {
        /* If `path` is a string, split it on the first occurrence of the separator and return as [head, tail] strings.
           If `path` is an array, return [head, tail], where head=path[0] and tail=path.slice(1).
         */
        if (typeof path === 'string') return splitFirst(path, this.SEPARATOR)
        let [head, ...tail] = path
        return [head, tail]
    }

    static splitAll(path) {
        /* Like .split(), but always returns an array as a `tail`, so no more string splits are required. */
        let [head, ...tail] = (typeof path === 'string') ? path.split(this.SEPARATOR) : path
        return [head, tail]
    }

    // static step(start, path, next = this.next) {
    //     /* Starting from an object, `start`, move along the `path` of nested objects, and return [obj, tail],
    //        where `obj` is the first object found after taking one step on the `path`, and `tail` is the remaining path.
    //      */
    //     let obj = start
    //     let [step, tail] = this.split(path)
    //     return [next(obj, step), tail]
    // }

    static find(start, path, next = this.next) {
        /* Return the first element encountered by walk(), or undefined. */
        let walk = this.walk(start, path, next)
        let elem = walk.next()
        if (!elem.done) return elem.value
    }

    static *walk(start, path, next = this.next) {
        /* Generate a stream of all the nested objects of `start` whose location matches the `path`. The path can be
           a string or an array. Multiple objects can be yielded if a Catalog with non-unique keys occurs on the path.
         */
        if (!path.length) yield start
        let [step, tail] = this.splitAll(path)
        for (let obj of next(start, step))
            yield* this.walk(obj, tail, next)
    }

    static *next(obj, key, generic = true) {
        /* Yield all elements of an object or collection, `obj`, stored at a given key or attribute, `key`. */
        if (obj instanceof Catalog) yield* obj.getAll(key)
        else if (obj instanceof Map) yield obj.get(key)
        else if (generic && (typeof obj === 'object')) yield obj[key]
    }
}

/**********************************************************************************************************************/

export class Struct {
    /* Static methods for working with collections: Catalog, Map, Array.
       In methods, the `path` argument is always an array, not a string!
     */

    static isCollection(obj) {
        return obj instanceof Catalog || obj instanceof Map || obj instanceof Array
    }

    static sizeOf(target) {
        if (target instanceof Catalog) return target.length
        if (target instanceof Map) return target.size
        if (target instanceof Array) return target.length
        throw new Error(`not a collection: ${target}`)
    }

    static get(target, path, _objects = true) {
        return Struct.yieldAll(target, path, _objects).next().value
    }

    static *yieldAll(target, path, _objects = true) {
        /* Yield all elements of a collection, `target`, that match a given `path`. The path is an array, not a string. */

        if (target !== undefined && !path.length) { yield target; return }
        if (!target) return
        let [step, ...rest] = path

        if (target instanceof Catalog)
            for (let obj of target._getAll(step))
                yield* Struct.yieldAll(obj, rest, _objects)
        
        else if (target instanceof Map)
            yield* Struct.yieldAll(target.get(step), rest, _objects)
        
        else if (target instanceof Array) {
            if (typeof step === 'number') yield* Struct.yieldAll(target[step], rest, _objects)
        }

        // walking into an object is only allowed for non-WebObjects, and uses the *state* of the object rather than the object itself
        // (this is compatible with JSONx encoding, except that unknown object classes are still walked into without raising errors)
        else if (_objects && typeof target === 'object' && !(target instanceof schemat.WebObject)) {
            let state = getstate(target)
            if (state?.hasOwnProperty?.(step))
                yield* Struct.yieldAll(state[step], rest, _objects)
        }
    }

    static set(target, path, ...values) {
        /* Find the first occurrence of path[:-1] where the value(s) for key=path[-1] can be assigned to.
           When walking into custom-class objects, the *state* (from getstate()) of these objects is modified,
           and then the object is recreated with setstate(), which creates a new instance that must be reassigned
           in its parent collection - that is why this function is recursive and returns the (original or recreated) `target`.
         */
        let [step, ...rest] = path
        if (!rest.length) return Struct._set(target, step, ...values)
        let obj, modified

        if (target instanceof Catalog)
            for (let loc of target.locs(step)) {
                obj = target._entries[loc][1]
                try { modified = Struct.set(obj, rest, ...values) }
                catch (e) { if (e instanceof FieldPathNotFound) continue; else throw e }
                target._entries[loc][1] = modified
                return target
            }
        else if (target instanceof Map) {
            modified = Struct.set(target.get(step), rest, ...values)
            return target.set(step, modified)
        }
        else if (target instanceof Array) {
            if (typeof step !== 'number') throw new FieldPathNotFound()
            modified = Struct.set(target[step], rest, ...values)
            target[step] = modified
            return target
        }
        else if (target && typeof target === 'object' && !(target instanceof schemat.WebObject)) {
            let state = getstate(target)
            modified = Struct.set(state[step], rest, ...values)
            state[step] = modified
            return state === target ? target : setstate(target.constructor, state)
        }
        throw new FieldPathNotFound()
    }

    static _set(target, key, ...values) {
        /* Set the value of `key` entry in the `target` collection or object. No deep paths, no recursion into nested collections. */
        if (!values.length) return
        if (target instanceof Catalog) return target._set(key, ...values)
        if (values.length > 1) throw new Error(`cannot set multiple values (${values.length}) for key (${key}) in a non-catalog`)

        if (target instanceof Map) {
            if (typeof key === 'number') key = [...target.entries()][key][0]
            return target.set(key, values[0])
        }
        if (target instanceof Array) {
            if (typeof key !== 'number') throw new FieldPathNotFound(`not an array index (${key}), cannot set a value inside an Array`)
            target[key] = values[0]
            return target
        }
        if (target && typeof target === 'object' && !(target instanceof schemat.WebObject)) {
            let state = getstate(target)
            state[key] = values[0]
            return state === target ? target : setstate(target.constructor, state)
        }
        throw new FieldPathNotFound(`not a collection nor an object: ${target}`)
    }

    static setkey(target, prev, key) {
        /* Change the key from `prev` to `key` of the corresponding entry in the `target` collection. */
        if (target instanceof Catalog) {
            let pos = (typeof prev === 'string') ? target.loc(prev) : prev
            if (T.isNullish(pos)) throw new Error(`key (${prev}) not found`)
            target._setkey(pos, key)
        }
        else if (target instanceof Map) {
            let entries = [...target.entries()]
            let pos = (typeof prev === 'number') ? prev : entries.findIndex(e => e[0] === prev)
            if (pos === -1) throw new Error(`key (${prev}) not found`)
            entries[pos] = [key, entries[pos][1]]
            target.clear()
            entries.forEach(e => target.set(...e))
        }
        else throw new Error(`cannot set key of: ${target}`)
    }

    static insert(target, pos, key, ...values) {
        let N = Struct.sizeOf(target)
        if (pos < 0) pos = N + pos
        if (pos < 0 || pos > N) throw new Error(`invalid insert position (${pos})`)

        if (target instanceof Catalog)
            if (pos === N)
                target._append(key, ...values)      // special case: inserting at the END does NOT require rebuilding the entire _keys maps
            else {
                // general case: insert the entry, rearrange the _entries array, and rebuild this._keys from scratch
                target._entries.splice(pos, 0, ...values.map(v => [key, v]))
                target.init(target._entries)
            }

        else if (target instanceof Map) {
            if (target.has(key)) throw new Error(`key (${key}) already exists in the Map, cannot insert another one, use set() instead`)
            let value = values[0]
            if (pos === N) target.set(key, value)
            else {
                // convert the Map to an Array, insert the entry, push all entries back to the emptied Map
                let entries = [...target.entries()]
                target.clear()
                entries.splice(pos, 0, [key, value])
                entries.forEach(e => target.set(...e))
            }
        }
        else if (target instanceof Array)
            target.splice(pos, 0, key, ...values)
    }

    static delete(target, path) {
        if (!target || !path.length) return 0
        let [step, ...rest] = path

        if (target instanceof Catalog) {
            let locs = target.locs(step)            // more steps to be done? delete recursively
            if (rest.length) return locs.reduce((count, loc) => count + Struct.delete(target.get(loc), rest), 0)

            // no more steps? delete leaf nodes here
            for (let pos of locs.toReversed()) target._delete(pos)
            return locs.length
        }
        if (target instanceof Map)
            return rest.length ? Struct.delete(target.get(step), rest) : Number(target.delete(step))

        if (target instanceof Array) {
            if (typeof step !== 'number') return 0
            return rest.length ? Struct.delete(target[step], rest) : target.splice(step, 1).length
        }
        return 0
    }

    static move(target, pos1, pos2, count = 1) {
        /* Move the element of `target` (Catalog/Map/Array) from position `pos1` to `pos2`.
           If `count` is greater than 1, move `count` consecutive elements from `pos1` to `pos2`.
         */
        let N = Struct.sizeOf(target)

        function check(pos) {
            if (pos < 0) pos = N + pos
            if (pos < 0 || pos >= N) throw new Error(`invalid position (${pos}) for moving an entry`)
            return pos
        }
        pos1 = check(pos1)
        pos2 = check(pos2)
        if (pos1 === pos2 || count === 0) return

        if (target instanceof Catalog) {
            // pull the entry at [pos1] out of _entries and reinsert at [pos2], treating pos2 as an index in the initial array
            let entries = target._entries
            entries.splice(pos2, 0, ...entries.splice(pos1, count))
            target.init(entries)
        }
        else if (target instanceof Map) {
            let entries = [...target.entries()]
            target.clear()
            entries.splice(pos2, 0, ...entries.splice(pos1, count))
            entries.forEach(e => target.set(...e))
        }
        else if (target instanceof Array)
            target.splice(pos2, 0, ...target.splice(pos1, count))
    }

    static collect(target, fun, path = []) {
        /* Walk through all (nested) nodes of the `target` collection and execute fun(node, path) at each node (in pre-order).
           If the result of fun() is truthy, children of `node` are skipped and the processing moves to the next sibling,
           otherwise it steps into children. Typically, `fun` collects some information and saves it in an external structure.
           The `path` is an array of keys or indices leading to the `target` node; inside a Catalog, multiple nodes may share the same path.
         */
        if (target == null) return
        let skip = fun(target, path)
        if (skip) return

        if (target instanceof Catalog || target instanceof Map)
            for (let [key, obj] of target.entries())
                Struct.collect(obj, fun, [...path, key])
        
        else if (target instanceof Array)
            for (let i = 0; i < target.length; i++)
                Struct.collect(target[i], fun, [...path, i])

        // walking into an object is only allowed for non-WebObjects, and uses the *state* of the object rather than the object itself
        // (this is compatible with JSONx encoding, except that unknown object classes are still walked into without raising errors)
        else if (typeof target === 'object' && !(target instanceof schemat.WebObject)) {
            let state = getstate(target)
            if (typeof state === 'object')
                for (let key of Object.keys(state))
                    Struct.collect(state[key], fun, [...path, key])
        }
    }

    static transform(target, fun, path = []) {
        /* In-place transform of all (nested) objects in the `target` collection through a function, fun(obj, path), in pre-order.
           If fun() returns undefined, the object is left unchanged and transform() proceeds to its child nodes;
           otherwise, the object is replaced with the returned (modified) object and the processing moves on to sibling nodes.
           Returning an unchanged `obj` from fun() is a way to skip the processing of its children.
         */
        if (target == null) return
        let swap = fun(target, path)
        if (swap !== undefined) return swap

        if (target instanceof Catalog)
            for (let entry of target._entries) {
                let [key, value] = entry
                entry[1] = Struct.transform(value, fun, [...path, key])
            }
        else if (target instanceof Map)
            for (let [key, value] of target.entries())
                target.set(key, Struct.transform(value, fun, [...path, key]))

        else if (target instanceof Array)
            for (let i = 0; i < target.length; i++)
                target[i] = Struct.transform(target[i], fun, [...path, i])

        else if (typeof target === 'object' && !(target instanceof schemat.WebObject)) {
            let state = getstate(target)
            if (typeof state === 'object') {
                for (let key of Object.keys(state))
                    state[key] = Struct.transform(state[key], fun, [...path, key])
                return state === target ? target : setstate(target.constructor, state)
            }
        }
        return target
    }

    static clone(target) {
        /* Deep-copy nested data structures composed of Catalog/Map/Array/POJO (sub)collections.
           References to WebObject instances are preserved, unlike in JSONx serialization + deserial.
         */
        if (target == null) return target

        if (target instanceof Catalog) {
            let entries = target._entries.map(([key, value]) => [key, Struct.clone(value)])
            return new Catalog().init(entries)
        }
        if (target instanceof Map) {
            let cloned = new Map()
            for (let [key, value] of target.entries())
                cloned.set(key, Struct.clone(value))
            return cloned
        }
        if (target instanceof Array)
            return target.map(value => Struct.clone(value))

        if (typeof target === 'object' && !(target instanceof schemat.WebObject)) {
            // for plain object, clone its own attributes AND the class (prototype)
            let cloned = Object.create(Object.getPrototypeOf(target))
            for (let key of Object.keys(target)) cloned[key] = Struct.clone(target[key])
            return cloned
        }
        return target       // primitive values or unhandled types returned as-is
    }

    static equal(obj1, obj2) {
        /* Return true if the two objects (structures) are deep-equal when compared by their JSONx stringification. */
        return JSONx.stringify(obj1) === JSONx.stringify(obj2)
    }
}

/**********************************************************************************************************************
 **
 **  CATALOG
 **
 */

export class Catalog {
    /* Catalog is an Array-like and Map-like collection of entries, a mini key-value store.
       Keys, if present, are strings. The same key can be repeated.
       Keys may include all characters except '.', '[', ']', '$', '/', ':', whitespace. Empty string is a valid non-missing key.
       Undefined key is replaced with null. Only not-null keys are indexed in _keys.
    */

    // suffix appended to the key when an array of *all* values of this key is requested
    static PLURAL = '$'

    _entries = []               // array of [key, value] pairs
    _keys    = new Map()        // for each not-null key, an array of positions in _entries where this key occurs, sorted (!)


    constructor(entries) {
        /* Optional `entries` is an iterable that yields [key, value] pairs, or a Catalog, or a plain object (POJO)
           whose own attributes are to be extracted.
         */
        if (entries == null) return this.init()
        if (entries instanceof Catalog) return this.init(entries._entries)
        if (T.isPOJO(entries)) entries = Object.entries(entries)
        return this.init(entries, true)
    }

    init(entries = [], clean = false) {
        /* (Re)build this._entries and this._keys from an array of `entries`, each entry is a [key, value] pair. */
        if (clean) entries = entries.map(e => this._clean(e))
        this._entries = entries.filter(e => e[1] !== undefined)     // drop entries with value=undefined
        this._keys = new Map()

        for (const [pos, entry] of this._entries.entries()) {
            const key = entry[0]
            if (key == null) continue
            let ids = this._keys.get(key) || []
            if (ids.push(pos) === 1) this._keys.set(key, ids)
        }
        return this
    }

    _clean(entry) {
        /* Validate and clean up the new entry's properties. */
        let [key, value] = entry
        assert(isstring(key))
        return (key === null) ? [undefined, value] : entry
    }

    clone() {
        /* Deep copy of this catalog and nested structures. WebObject-aware (preserves references). */
        return Struct.clone(this)
    }


    /***  Map & Array interface  ***/

    get size()          { return this._entries.length }
    get length()        { return this._entries.length }

    // everywhere below, `key` can be a string, or an index (number) into _entries ...
    _get(key)           { return this._entries[this.loc(key)]?.[1] }
    has(key)            { return (typeof key === 'number') ? 0 <= key < this._entries.length : this._keys.has(key)  }
    map(fun)            { return this._entries.map(e => fun(e[1])) }
    *keys()             { yield* this._keys.keys() }
    *values()           { yield* this._entries.map(e => e[1]) }
    *entries()          { yield* this }                                     // same as the .iterator() below
    *[Symbol.iterator](){ yield* this._entries.map(e => [...e]) }           // iterator over [key,value] pairs
    forEach(fun, this_) { this._entries.forEach(e => {fun.call(this_, e[1], e[0], this)})}

    // custom extensions ...

    loc(key)            { return (typeof key === 'number') ? key : this._keys.get(key)?.[0] }       // location of the first occurrence of a string `key`, or `key` if already a number
    locs(key)           { return (typeof key === 'number') ? [key] : this._keys.get(key) || [] }    // locations of all occurrences of a string `key`, [] if none, or [key] if already a number

    _getAll(key)        { return this.locs(key).map(i => this._entries[i][1]) }                     // array of all values of a (repeated) key
    getRecord(key)      { return [key, this._entries[this.loc(key)]] }
    getRecords(key)     { return key === undefined ? this._entries.map(([key,value]) => ({key,value})) : this.locs(key).map(i => [key, this._entries[i][1]]) }
    hasMultiple(key)    { return this.locs(key).length >= 2 }           // true if 2 or more values are present for `key`

    hasKeys()           { return this._keys.size > 0  }
    hasUniqueKeys()     { return this._keys.size === this.length && !this._keys.has(null) }
    hasStringKeys()     { return this._entries.filter(e => typeof e[0] !== 'string').length === 0 }
    // isDict()         { return this.hasUniqueKeys() && this.hasStringKeys() }

    object() {
        /* Return an object containing {key: value} pairs of all the entries. For repeated keys, only the first value is included. */
        return Object.fromEntries(this._entries.toReversed())
    }


    /***  Path-aware deep access & modifications  ***/

    _normPath(path) {
        return typeof path === 'string' ? path.split('.') : T.isArray(path) ? path : T.isNullish(path) ? [] : [path]
    }

    _splitPath(path) {
        /* Split an [a,...,y,z] path into [a,...,y] and z. Normalize the path first. */
        path = this._normPath(path)
        if (!path.length) throw new Error(`path is empty`)
        return [path.slice(0, -1), path[path.length - 1]]
    }

    _targetKey(path) {
        /* Return the last-but-one object on a `path`, and the last segment key. */
        let [subpath, key] = this._splitPath(path)
        let target = this.get(subpath, false)
        if (target === undefined) throw new Error(`path not found: ${path}`)
        return [target, key]
    }

    get(path, norm = true) {
        path = norm ? this._normPath(path) : path
        if (!path.length) return this
        if (path.length === 1) return this._get(path[0])
        return Struct.get(this, path)
    }

    getAll(path) {
        path = this._normPath(path)
        return [...Struct.yieldAll(this, path)]
    }

    set(path, ...values) {
        try { return Struct.set(this, this._normPath(path), ...values) }
        catch (e) {
            if (e instanceof FieldPathNotFound) throw new Error(`path not found: ${path}`)
            throw e
        }
        // let [target, key] = this._targetKey(path)
        // if (target === this) this._set(key, ...values)
        // else Struct._set(target, key, ...values)
        // return this
    }

    setkey(path, key) {
        let [target, prev] = this._targetKey(path)
        Struct.setkey(target, prev, key)
        return this
    }

    append(path, ...values) {
        /* Find a (nested) catalog pointed to by path[:-1] (all path segments except the last one) and append
           [key, value] entries there, with key=path[-1].
         */
        let [target, key] = this._targetKey(path)
        if (target instanceof Catalog) return target._append(key, ...values)
        throw new Error(`not a Catalog at: ${this._normPath(path).slice(0,-1)}`)
    }

    push(path, ...values) {
        /* Find a nested array pointed to be path and push all of `values` at the end of it.
           Return this catalog (not the array and not the array length!).
         */
        let target = this.get(path)
        if (target instanceof Array) {
            target.push(...values)
            return this
        }
        throw new Error(`not an Array at: ${path}`)
    }

    insert(path = null, pos, key, ...values) {
        /* Insert a new entry at position `pos` in the collection identified by `path`. If `path` has multiple
           occurrences, the first one is chosen, and it must be a collection (Catalog/Map/Array).
           Empty path ([] or null) denotes this catalog. `pos` can be negative.
           If `path` points to an array, `key` is treated as the first of all values to be inserted.
         */
        let target = this.get(path)
        if (target === undefined) throw new Error(`path not found: ${path}`)
        if (!Struct.isCollection(target)) throw new Error(`not a collection at: ${path}`)
        // if (!(target instanceof Array)) ([key, value] = this._clean(key, value))

        Struct.insert(target, pos, key, ...values)
        return this
    }

    delete(path) {
        /* Delete all (sub)entries that match the `path`. Return the number of entries removed (0 if nothing).
           This is compatible with Map.delete(), but an integer is returned instead of a boolean.
           Elements of nested Maps and Arrays can be deleted as well.
         */
        return Struct.delete(this, this._normPath(path))
    }

    move(path, {pos, delta, count = 1}) {
        /* Find the first (nested) element pointed to by `path` and move it to position `pos` (if present), 
           or by `delta` positions further in its parent collection (Catalog/Map/Array). `delta` can be negative.
           If `count` is present, move `count` consecutive elements instead of just one.
         */
        let [target, key] = this._targetKey(path)
        if (!(typeof key === 'number')) key = this.loc(key)
        
        pos ??= key + delta
        if (pos === key) return this
        
        Struct.move(target, key, pos, count)
        return this
    }


    /***  Key-based modifications (no paths, no recursion)  ***/

    _set(key, ...values) {
        /* If there's one value in `values` and the `key` occurs exactly once, replace its value with values[0] at the existing position.
           Otherwise, remove all occurrences of `key` (if any) and append [key, value[i]] entries at the end.
         */
        let locs = this.locs(key)
        if (typeof key === 'number') key = this._entries[key][0]

        if (values.length === 1 && locs.length === 1) {
            this._entries[locs[0]][1] = values[0]
            return this
        }
        if (locs.length) this.delete(key)
        return this._append(key, ...values)
    }

    _append(key, ...values) {
        /* Insert [key, value[i]] pairs at the end of the catalog. */
        if (!values.length) return this
        let start = this._entries.length
        this._entries.push(...values.map(value => [key, value]))
        if (!T.isNullish(key)) {
            let locs = this._keys.get(key)
            if (!locs) this._keys.set(key, locs = [])
            locs.push(...values.map((_, i) => start + i))
        }
        return this
    }

    _delete(pos) {
        /* Delete an entry located at a given position in _entries. Rebuild the _entries array and _keys map. */

        if (pos === this.length - 1) {              // special case: deleting the LAST entry does NOT require rebuilding _keys
            let entry = this._entries.pop()
            if (!T.isNullish(entry[0])) {
                let ids = this._keys.get(entry[0])
                let id  = ids.pop()                 // indices in `ids` are stored in increasing order, so `pos` must be the last one
                assert(id === pos)
                if (!ids.length) this._keys.delete(entry[0])
            }
        }
        else {
            // general case: delete the entry, rearrange the _entries array, and rebuild this._keys from scratch
            let entries = [...this._entries.slice(0,pos), ...this._entries.slice(pos+1)]
            this.init(entries)
        }
    }

    updateAll(catalog) {
        /* Write all entries of the `catalog` into `this` in a way that removes (overwrites) existing entries with the same key,
           but keeps untouched the other entries, whose keys are not listed in the `catalog`.
           `catalog` can be a Catalog, a plain object, or an array of [k,v] pairs.
         */
        if (!(catalog instanceof Catalog)) catalog = new Catalog(catalog)
        for (let key of catalog.keys()) {
            let values = catalog.getAll(key)
            if (values.length === 1) this.set(key, values[0])
            else this.set(key, ...values)
        }
    }


    /***  Read access  ***/

    static merge(catalogs, unique = true) {
        /* Merge multiple `catalogs` into a new Catalog. The order of entries is preserved.
           If unique=true, only the first entry with a given key is included in the result,
           and the entries with missing keys are dropped. Otherwise, all input entries are passed to the output.
         */
        if (catalogs.length === 1) return catalogs[0]
        if (!unique) {
            let entries = catalogs.map(c => c._entries).flat()
            return new Catalog(entries)
        }
        let catalog = new Catalog()
        for (const cat of catalogs)
            for (const entry of (cat._entries || []))
                if (entry[0] !== undefined && !catalog.has(entry[0]))
                    catalog._append(...entry)
        return catalog
    }

    /***  Write access  ***/

    _setkey(pos, key) {
        /* Change (in place) the key of the entry at a given position in this._entries. */
        let e = this._entries[pos]
        let prev = e[0]
        if (prev === key) return

        e[0] = key                  // change the key & update this._keys accordingly...
        if (!T.isNullish(prev)) this._deleteKey(prev, pos)
        if (!T.isNullish(key))  this._insertKey(key, pos)
    }

    _insertKey(key, pos) {
        /* Insert `id` at a proper position in a list of entry indices for a `key`, this._keys[key]. */
        let ids = this._keys.get(key) || []
        ids.push(pos)
        this._keys.set(key, ids.filter(Number).sort((a, b) => a - b))
    }

    _deleteKey(key, pos) {
        /* Hard-delete `id` from a list of entry indices for a `key`, this._keys[key], withOUT leaving an "undefined". */
        if (key === undefined) return
        let locs = this._keys.get(key)
        let idx = locs.indexOf(pos)
        assert(idx >= 0)
        locs[idx] = undefined
        locs = locs.filter(Number).sort((a, b) => a - b)
        locs.length ? this._keys.set(key, locs) : this._keys.delete(key)
    }

    /***  Higher-level edit operations  ***/

    _step(path) {
        /* Make one step along a `path`. Return the position of the 1st entry on the path (must be unique),
           the remaining path, and the value object found after the 1st step. */
        path = this._normPath(path)
        assert(path.length >= 1)

        let step = path[0]
        let [pos, ...dups] = this.locs(step)

        if (pos === undefined) throw new Error(`key not found: ${step}`)
        if (dups.length) throw new Error(`key is not unique: ${step}`)

        let subpath = path.slice(1)
        let value = this._entries[pos][1]

        return [pos, subpath, value]
    }


    /***  Serialization  ***/

    encode() {
        /* Encode this catalog through JSONx, but do NOT stringify. Return a plain-objects tree that can be subsequently
           stringified through the standard JSON.stringify(). */
        return JSONx.encode(this.__getstate__())
    }

    dump() {
        /* Encode & stringify this catalog through JSONx. Return a string. */
        return JSONx.stringify(this.__getstate__())
    }

    static load(json) {
        let catalog = JSONx.parse(json)
        return catalog instanceof this ? catalog : this.__setstate__(catalog)
    }

    __getstate__() {
        /* Encode this Catalog's state either as an object (more compact but requires unique string keys),
           or as an array of [key, value] tuples.
         */
        let defined = (x) => x === undefined ? null : x             // function to replace "undefined" with null
        let entries = this._entries.filter(e => e[1] !== undefined).map(e => [defined(e[0]), e[1]])

        if (!this.hasUniqueKeys()) {
            let counts = new Map()                                  // no. of occurrences of each key, so far

            // convert entries with repeated values to [key/X, value] tuples
            entries = entries.map(([key, value]) => {
                assert(!key.includes('/'))
                if (counts.has(key)) {
                    let rep = counts.get(key) + 1
                    counts.set(key, rep)
                    return [`${key}/${rep}`, value]
                }
                counts.set(key, 1)
                return [key, value]
            })
        }

        let irregular = entries.filter(e => e.length !== 2 || typeof e[0] !== 'string')
        assert(irregular.length === 0)

        return irregular.length > 0 ? entries : Object.fromEntries(entries)
    }

    static __setstate__(state) {
        if (!T.isArray(state)) {                    // if state is an object (compact representation) convert it to an array
            state = Object.entries(state)
            state = state.map(([key, value]) => [key.split('/')[0], value])     // convert keys of the form "key/X" back to "key"
        }
        return new this().init(state)
    }


    static async from_object(obj) {
        /* Convert a plain object - POJO or a newborn WebObject containing plain JS attributes - to a Catalog instance,
           which contains all own properties of `obj` except for those starting with '_',
           or having undefined value, or WebObject's special attributes (like `action`).
           Special properties: __class, __category, are preserved.
           Properties defined by getters are ignored.
           TODO: this method is temporary, it likely needs to be discarded in the future.
         */
        assert(!obj.id)

        const KEEP = ['__class', '__category']
        const DROP = ['GET', 'POST', 'LOCAL']

        // identify __category & __class of the object and perform conversions if needed
        let __category = obj.__category || obj.constructor.__category || undefined
        let __class    = obj.__class    || obj.constructor.class || obj.constructor.__class || obj.constructor || undefined

        if (T.isString(__category)) __category = Number(__category)
        if (T.isNumber(__category)) __category = await schemat.get_loaded(__category)

        if (__class === Object || __class === schemat.WebObject) __class = undefined
        if (__class && !T.isString(__class)) __class = schemat.get_classpath(__class)     // convert __class to a classpath string

        // drop __class if it's already defined through category's default (by literal equality of classpath strings)
        if (__class === __category?.defaults?.get('__class')) __class = undefined

        let props = {...obj, __category, __class}

        // filter out undefined values, private props (starting with '_'), and special attributes except for those listed in KEEP
        let entries = Object.entries(props).filter(([k, v]) =>
            (v !== undefined) &&
            (k[0] !== '_' || KEEP.includes(k)) &&
            !DROP.includes(k)
        )

        // print(`from_object(${obj}) =>`, entries)
        return new Catalog(entries)
    }
}

