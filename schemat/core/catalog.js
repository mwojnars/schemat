import {T, print, assert, concat, splitFirst} from '../common/utils.js'
import {JSONx} from "./jsonx.js"


/**********************************************************************************************************************
 **
 **  UTILITIES
 **
 */

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


/**********************************************************************************************************************
 **
 **  CATALOG
 **
 */

export class Catalog {
    /* Catalog is an Array-like and Map-like collection of entries, a mini key-value store.
       Keys, if present, are strings. The same key can be repeated.
       Keys may include all characters except ":", '.', '$', '/', whitespace. Empty string is a valid non-missing key.
    */

    // suffix appended to the key when an array of *all* values of this key is requested
    static PLURAL = '$'

    _entries = []               // array of [key, value] pairs
    _keys    = new Map()        // for each key, an array of positions in _entries where this key occurs, sorted (!)


    constructor(...entries) {
        /* Each argument can be a Catalog, or an object whose attributes will be used as entries,
           or a [key, value] pair, or an array of [key, value] pairs.
         */
        entries = entries.map(ent =>
                        (ent instanceof Catalog) ? ent._entries
                        : T.isPOJO(ent) ? Object.entries(ent)
                        : T.isArray(ent) ? [ent[0], ent[1]]
                        : ent
                    )
        this.init(concat(entries), true)
    }

    init(entries, clean = false) {
        /* (Re)build this._entries and this._keys from an array of `entries`, each entry is a [key, value] pair. */
        this._keys = new Map()
        this._entries = clean ? entries.map(e => this._clean(e)) : [...entries]

        for (const [pos, entry] of this._entries.entries()) {
            const key = entry[0]
            if (key === undefined || key === null) continue
            let ids = this._keys.get(key) || []
            if (ids.push(pos) === 1) this._keys.set(key, ids)
        }
        return this
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

    getAll(key)         { return this.locs(key).map(i => this._entries[i][1]) }                     // array of all values of a (repeated) key
    getRecord(key)      { return [key, this._entries[this.loc(key)]] }
    getRecords(key)     { return key === undefined ? this._entries.map(([key,value]) => ({key,value})) : this.locs(key).map(i => [key, this._entries[i][1]]) }
    hasMultiple(key)    { return this.locs(key).length >= 2 }           // true if 2 or more values are present for `key`

    hasKeys()           { return this._keys.size > 0  }
    hasUniqueKeys()     { return this._keys.size === this.length }
    hasStringKeys()     { return this._entries.filter(e => typeof e[0] !== 'string').length === 0 }
    // isDict()         { return this.hasUniqueKeys() && this.hasStringKeys() }

    object() {
        /* Return an object containing {key: value} pairs of all the entries. For repeated keys, only the first value is included. */
        return Object.fromEntries(this._entries.toReversed())
    }


    /***  Path-aware deep access & modifications  ***/

    _normPath(path) {
        return typeof path === 'string' ? path.split('.') : T.isArray(path) ? path : [path]
    }

    get(path) {
        path = this._normPath(path)
        return this._get(path[0])
    }


    /***  Key-based modifications (no paths, no recursion)  ***/

    set(key, ...values) {
        /* If there's one value in `values` and the `key` occurs exactly once, replace its value with values[0] at the existing position.
           Otherwise, remove all occurrences of `key` (if any) and append [key, value[i]] entries at the end.
         */
        let locs = this.locs(key)
        if (values.length === 1 && locs.length === 1) {
            this._entries[locs[0]] = [key, values[0]]
            return this
        }
        if (locs.length) this.delete(key)
        return this.append(key, ...values)
    }

    // setAll(key, ...values) {
    //     /* Remove all existing values for the `key` and insert new `values` at the end of the catalog. */
    //     this.delete(key)
    //     return this.append(key, ...values)
    // }

    append(key, ...values) {
        /* Insert [key, value[i]] pairs at the end of the catalog. */
        if (!values.length) return this
        let start = this._entries.length
        this._entries.push(...values.map(value => [key, value]))
        let locs = this._keys.get(key)
        if (!locs) this._keys.set(key, locs = [])
        locs.push(...values.map((_, i) => start + i))
        return this
    }

    appendEntries(entries) {
        for (let [key, value] of entries)
            this.append(key, value)
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
            let entries = concat(catalogs.map(c => c._entries))
            return new Catalog(entries)
        }
        let catalog = new Catalog()
        for (const cat of catalogs)
            for (const entry of (cat._entries || []))
                if (entry[0] !== undefined && !catalog.has(entry[0]))
                    catalog._pushEntry(entry)
        return catalog
    }

    /***  Write access  ***/

    _overwrite(id, key, value) {
        /* Overwrite in place some or all of the properties of an entry of a given `id` = position in this._entries.
           Return the modified entry. Passing `null` as a key will delete a corresponding property. */
        let e = this._entries[id]
        let prevKey = e[0]
        if (value !== undefined) e[1] = value
        if (key   !== undefined) e[0] = key

        if (prevKey !== key && key !== undefined) {             // `key` has changed? update this._keys accordingly
            if (!T.isMissing(prevKey)) this._deleteKey(prevKey, id)
            if (!T.isMissing(key))     this._insertKey(key, id)
        }
        return {key: e[0], value: e[1]}
    }
    _insertKey(key, id) {
        /* Insert `id` at a proper position in a list of entry indices for a `key`, this._keys[key]. */
        let ids = this._keys.get(key) || []
        ids.push(id)
        this._keys.set(key, ids.filter(Number).sort())
    }
    _deleteKey(key, id) {
        /* Hard-delete `id` from a list of entry indices for a `key`, this._keys[key], withOUT leaving an "undefined". */
        if (key === undefined) return
        let ids = this._keys.get(key)
        let pos = ids.indexOf(id)
        assert(pos >= 0)
        ids[pos] = undefined
        ids = ids.filter(Number).sort()
        ids.length ? this._keys.set(key, ids) : this._keys.delete(key)
    }

    push(key, value) {
        /* Create and append a new entry without deleting existing occurrencies of the key. */
        return this._pushEntry([key, value])
    }

    _pushEntry([key, value]) {
        /* Append `entry` to this._entries while keeping the existing occurrencies of key. Update this._keys. */
        let entry = this._clean([key, value])
        let pos = this._entries.push(entry) - 1             // insert to this._entries and get its position
        if (!T.isMissing(key)) {                            // update this._keys
            let ids = this._keys.get(key) || []
            if (ids.push(pos) === 1)
                this._keys.set(key, ids)
        }
        return entry
    }

    _clean([key, value]) {
        /* Validate and clean up the new entry's properties. */
        assert(value !== undefined)
        assert(isstring(key))
        if (key === null) key = undefined
        return [key, value]
    }

    _deleteAt(pos) {
        /* Delete an entry located at a given position in _entries. Rebuild the _entries array and _keys map.
           `pos` can be negative, for example, pos=-1 means deleting the last entry.
         */
        let N = this._entries.length
        if (pos < 0) pos = N + pos
        if (pos < 0 || pos >= N) throw new Error("trying to delete a non-existing entry")
        if (pos === N - 1) {
            // special case: deleting the LAST entry does NOT require rebuilding the entire _keys maps
            let entry = this._entries.pop()
            if (!T.isMissing(entry[0])) {
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
    _insertAt(pos, entry) {
        /* Insert new `entry` at a given position in this._entries. Update this._keys accordingly. `pos` can be negative. */
        let N = this._entries.length
        if (pos < 0) pos = N + pos
        if (pos < 0 || pos > N) throw new Error(`invalid position (${pos}) where to insert a new entry`)
        if (pos === N)
            this._pushEntry(entry)       // special case: inserting at the END does NOT require rebuilding the entire _keys maps
        else {
            // general case: insert the entry, rearrange the _entries array, and rebuild this._keys from scratch
            let entries = [...this._entries.slice(0,pos), entry, ...this._entries.slice(pos)]
            this.init(entries)
        }
    }
    _move(pos1, pos2) {
        let N = this._entries.length
        function check(pos, src = false) {
            if (pos < 0) pos = N + pos
            if (pos < 0 || pos >= N) throw new Error(`invalid position (${pos}) in a catalog for moving an entry`)
            return pos
        }
        pos1 = check(pos1)
        pos2 = check(pos2)
        if (pos1 === pos2) return

        // pull the entry at [pos1] out of this._entries...
        let entry = this._entries[pos1]
        let entries = [...this._entries.slice(0,pos1), ...this._entries.slice(pos1+1)]

        // ...and reinsert at [pos2], treating pos2 as an index in the initial array
        //if (pos2 > pos1) pos2--
        entries = [...entries.slice(0,pos2), entry, ...entries.slice(pos2)]

        this.init(entries)
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

    insert(path, pos, key, value) {
        /* Insert a new `entry` at position `pos` in a subcatalog identified by `path`; empty path denotes this catalog. */
        path = this._normPath(path)
        let entry = this._clean([key, value])
        if (!path.length) return this._insertAt(pos, entry)
        let [_, subpath, subcat] = this._step(path)
        if (subcat instanceof Catalog) return subcat.insert(subpath, pos, ...entry)     // nested Catalog? make a recursive call
        throw new Error(`path not found: ${subpath.join('/')}`)
    }

    delete(path) {
        /* Delete all (sub)entries identified by `path`. Return the number of entries removed (0 if nothing).
           This is compatible with Map.delete(), but an integer is returned instead of a boolean.
         */
        path = this._normPath(path)
        assert(path.length > 0)

        let [key, ...steps] = path
        let locs = this.locs(key)

        if (!steps.length) {                    // no more steps to be done? delete leaf nodes here
            for (let pos of locs.toReversed()) this._deleteAt(pos)
            return locs.length
        }

        let deleted = 0                         // there are more steps to be done; do recursive calls into nested Catalogs
        for (let i of locs) {
            let obj = this.get(i)
            if (obj instanceof Catalog) deleted += obj.delete(steps)
        }
        return deleted
    }

    update(path, key, value) {
        /* Modify an existing entry at a given `path`. The entry must be unique. Return the entry after modifications.
           This method should be used to apply manual data modifications.
           Automated changes, which are less reliable, should go through update() to allow for deduplication etc. - TODO
         */
        let [pos, subpath] = this._step(path)
        if (!subpath.length) return this._overwrite(pos, key, value)    // `path` has only one segment, make the modifications and return

        let subcat = this._entries[pos][1]
        if (subcat instanceof Catalog)                              // nested Catalog? make a recursive call
            return subcat.update(subpath, key, value)

        throw new Error(`path not found: ${subpath}`)
    }

    move(path, pos1, pos2) {
        /* In a (sub)catalog pointed to by `path`, move the entry at position `pos1` to position `pos2` while shifting after entries. */
        path = this._normPath(path)
        if (!path.length) return this._move(pos1, pos2)
        let [_, subpath, subcat] = this._step(path)
        if (subcat instanceof Catalog) return subcat.move(subpath, pos1, pos2)        // nested Catalog? make a recursive call
        throw new Error(`path not found: ${subpath}`)
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
}



export class Data extends Catalog {
    /* Added functionality:
       - derived features (and subfeatures?)
    */

    static async from_object(obj) {
        /* Convert a plain object - POJO or a newborn WebObject containing plain JS attributes - to a Data instance,
           which contains all own properties of `obj` except for those starting with '_',
           or having undefined value, or WebObject's special attributes (like `action`).
           Special properties: __class, __category, are preserved.
           Properties defined by getters are ignored.
         */
        assert(!obj.__id)

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
        return new Data(entries)
    }

    find_references() {
        /* Extract an array of WebObjects referenced from within this Data object. */
        let refs = []
        JSONx.encode(this, val => {if (val instanceof schemat.WebObject) { refs.push(val); return null; }})
        return refs
    }
}

