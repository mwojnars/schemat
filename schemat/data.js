// import BTree from 'sorted-btree'
import { T, print, assert, concat, splitFirst } from './common/utils.js'


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
        if (obj instanceof Catalog)
            for (const entry of obj.readEntries(key))
                yield entry.value

        else if (obj instanceof Map) yield obj.get(key)
        else if (generic && (typeof obj === 'object')) yield obj[key]
    }
}


/**********************************************************************************************************************
 **
 **  CACHE of ITEMS
 **
 */

export class ItemsCache extends Map {
    /* A cache of Item instances; provides manually-invoked eviction by LRU and per-item TTL.
       Eviction timestamps are stored in items and can be modified externally.
       Currently, the implementation scans all items for TTL eviction, which should work well for up to ~1000 entries.
       For larger item sets, a BTree could possibly be used: import BTree from 'sorted-btree'
     */

    // set(id, item, ttl) {
    //     // if (ttl_ms) item._meta_.expiry = Date.now() + ttl_ms
    //     item.setExpiry(ttl)
    //     super.set(id, item)
    // }

    evict() {
        let now  = Date.now()
        let cleanup = []
        for (let [id, item] of this.entries()) {
            let expiry = item._meta_.expiry
            if (expiry === undefined || (0 < expiry && expiry <= now)) {
                let deleted = this.delete(id)
                // if (deleted) print('item evicted:', id, item.is_loaded() ? '' : '(stub)' )     // TODO: comment out
                // else print('item not found for eviction:', id, item.is_loaded() ? '' : '(stub)' )
                let done = item.__done__()          // TODO: cleanup must be called with a larger delay, after the item is no longer in use (or never?)
                if (T.isPromise(done)) cleanup.push(done)
            }
        }
        if (cleanup.length) return Promise.all(cleanup)
    }
}

/**********************************************************************************************************************
 **
 **  CATALOG
 **
 */

export class Catalog {
    /* Catalog is an Array-like and Map-like collection of entries, an in-memory mini-database, where each entry
       contains a `value`, an `id`, and an optional:
       - key,
       - label,
       - comment.
       Keys, labels, comments, if present, are strings. Keys may repeat.
       Keys may include all printable characters except ":" and whitespace.
       Labels may include all printable characters except ":", newline, tab (spaces allowed).
       Comments may include all printable characters including whitespace.
       Empty strings in label/comment are treated as missing. Empty string is a valid non-missing key.
       Entries can be accessed by their key, or integer position (0,1,...), or a path. The path may contain
       - labels: "key:label/key2:label2"
       - flags:  "key/key2:label::first" or "key::last" (first/last flag at the end of a path, after ::)
    */

    _entries = []               // plain objects with {key, value, label, comment} attributes
    _keys    = new Map()        // for each key, a list of positions in _entries where this key occurs, sorted (!)

    get length()        { return this._entries.length }  //{ return this.size }
    has(key)            { return this._keys.has(key)  }                     // Map's interface
    hasKeys()           { return this._keys.size > 0  }
    hasUniqueKeys()     { return this._keys.size === this.length }
    hasStringKeys()     { return this._entries.filter(e => typeof e.key !== 'string').length === 0 }
    hasAnnot()          { return this._entries.filter(e => e && (e.label || e.comment)).length > 0 }     // at least one label or comment is present?
    isDict()            { return this.hasUniqueKeys() && this.hasStringKeys() && !this.hasAnnot() }
    map(fun)            { return Array.from(this._entries, fun) }           // Array's interface
    *keys()             { yield* this._keys.keys() }                        // Map's interface
    *values()           { yield* this._entries.map(e => e.value) }          // Map's interface
    *entries()          { yield* this._entries }                            // Map's interface
    *[Symbol.iterator](){ yield* this._entries }            // iterator over entries, same as this.entries()

    object(first = true) {
        /* Return a flat object containing the entries converted to {key: value} pairs.
           For repeated keys, only one value is included: the first one if first=true (default), or the last one, otherwise.
         */
        let entries = first ? [...this._entries].reverse() : this._entries
        return Object.fromEntries(entries.map(e => [e.key, e.value]))
    }

    constructor(...entries) {
        /* Each argument can be a Catalog, or an object whose attributes will be used as entries,
           or a [key, value] pair, or a {key, value} entry.
         */
        entries = entries.map(ent =>
                        (ent instanceof Catalog) ? ent._entries
                        : T.isDict(ent) ? Object.entries(ent).map(([key, value]) => ({key, value}))
                        : T.isArray(ent) ? {key: ent[0], value: ent[1]}
                        : ent
                    )
        this.init(concat(entries), true)
    }

    init(entries, clean = false) {
        /* (Re)build this._entries and this._keys from an array of `entries`, each entry is an object {key, value, ...}. */
        this._keys = new Map()
        this._entries = clean ? entries.map(e => this._clean(e)) : [...entries]

        for (const [pos, entry] of this._entries.entries()) {
            const key = entry.key
            if (key === undefined || key === null) continue
            let ids = this._keys.get(key) || []
            if (ids.push(pos) === 1) this._keys.set(key, ids)
        }
    }


    /***  Read access  ***/

    _positionOf(key, unique = false) {
        /* Find a unique position of a `key`, the key being a string or a number. Return undefined if not found.
           Raise an exception if multiple occurrences and unique=true.
         */
        if (typeof key === 'number') return key in this._entries ? key : undefined
        if (this._keys.has(key)) {
            let ids = this._keys.get(key)
            if (unique && ids.length > 1) throw new Error(`unique entry expected for '${key}', found ${ids.length} entries instead`)
            return ids.length ? ids[0] : undefined
        }
    }

    get(key, default_ = undefined, unique = false) {
        /* Return the `value` property of the first entry with a given `key`, or default_ if the key is missing. */
        let entry = this.getEntry(key, unique)
        return entry === undefined ? default_ : entry.value
    }

    getEntry(key, unique = false) {
        /* Return the first entry with a given `key`, or the entry located at a given position if `key` is a number.
           If the key is missing, undefined is returned. Exception is raised if duplicates are present and unique=true.
         */
        let pos = this._positionOf(key, unique)
        return this._entries[pos]
    }

    *readEntries(keys = undefined) {
        /* Yield all the entries associated with a given key (if `keys` is a string), or with multiple keys
           (if `key` is an array); or all the entries if `keys` is undefined. Keys can be strings or numbers (positions).
           The same order of entries as in this._entries is preserved. The output can be empty.
         */
        if (keys === undefined) {
            yield* this._entries
            return
        }
        if (!T.isArray(keys)) keys = [keys]

        if (keys.length === 1) {
            // if there's only one key we don't have to sort values by their positions in _entries, which is more efficient
            let key = keys[0]
            if (typeof key === 'number') yield this._entries[key]
            else
                for (const pos of (this._keys.get(key) || []))
                    yield this._entries[pos]
        }
        else {
            let locs = []
            for (const key of keys)
                if (typeof key === 'number') locs.push(key)
                else {
                    let p = this._keys.get(key)
                    if (p) locs.push(...p)
                }
            yield* locs.sort().map(pos => this._entries[pos])
        }
    }

    get_all(key) {
        /* Return an array of all values associated with a given top-level key. */
        return this.getEntries(key).map(e => e.value)
    }

    getEntries(keys) { return [...this.readEntries(keys)] }

    getEmpty() {
        /* Return all the entries with an empty key (missing, null, ''). */
        return this._entries.filter(e => !e.key)
    }

    _normPath(path) { return typeof path === 'string' ? path.split('/') : T.isArray(path) ? path : [path] }

    step(path, error = true) {
        /* Make one step along a `path`. Return the position of the 1st entry on the path (must be unique),
           the remaining path, and the value object found after the 1st step. */
        path = this._normPath(path)
        assert(path.length >= 1)

        let step = path[0]
        let pos = this._positionOf(step)
        if (pos === undefined)
            if (error) throw new Error(`path not found: ${step}`)
            else return [-1]
        let subpath = path.slice(1)
        let value = this._entries[pos].value

        return [pos, subpath, value]
    }

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
                if (entry.key !== undefined && !catalog.has(entry.key))
                    catalog.pushEntry({...entry})
        return catalog
    }

    /***  Write access  ***/

    set(path, value, {label, comment} = {}, create_path = false) {
        /* Create an entry at a given `path` (string or Array) if missing; or overwrite value/label/comment
           of an existing entry - the entry must be unique (!). If create_path is false (default),
           all segments of `path` except the last one must already exist and be unique; otherwise,
           new Catalog() entries are inserted in place of missing path segments.
         */
        return this.setEntry(path, {value, label, comment}, create_path)
    }

    setEntry(path, {value, label, comment} = {}, create_path = false) {
        /* Like set(), but with all props accepted in a single argument. */
        path = this._normPath(path)
        assert(path.length >= 1)

        let step  = path[0]
        let spath = path.join('/')
        let props = {value, label, comment}

        if (path.length <= 1)
            if (T.isNumber(step)) return this._overwrite(step, props)
            else return this.setShallow(step, props)

        // make one step forward, then call set() recursively
        let entry = this.getEntry(step, true)
        if (!entry)
            if (create_path && typeof step === 'string')                // create a missing intermediate Catalog() if so requested
                this.setShallow({key: step, value: new Catalog()})
            else
                throw new Error(`path not found, missing '${step}' of '${spath}'`)

        let subcat  = entry.value
        let subpath = path.slice(1)

        // subcat is a Catalog? make a recursive call
        if (subcat instanceof Catalog)
            return subcat.setEntry(subpath, props, create_path)

        let key = subpath[0]

        // subcat is a Map, Array, or plain object? go forward one more step, but no deeper
        if (subpath.length === 1) {
            if (label   !== undefined) throw new Error(`can't assign a label (${label}) at '${spath}' inside a non-catalog, ${subcat}`)
            if (comment !== undefined) throw new Error(`can't assign a comment (${comment}) at '${spath}' inside a non-catalog, ${subcat}`)

            if (subcat instanceof Map)              // last step inside a Map
                subcat.set(key, value)
            else if (T.isDict(subcat) || (T.isArray(subcat) && T.isNumber(key)))
                subcat[key] = value                 // last step inside a plain object or array
            else
                throw new Error(`can't write an entry at '${path}' inside a non-catalog object, ${subcat}`)

            return {key, value}                     // a "virtual" entry is returned for consistent API, only for reading
        }

        throw new Error(`path not found: '${subpath.join('/')}'`)
    }

    setShallow(key, props = {}) {
        /* If `key` is present in the catalog, modify its value/label/comment in place; the entry must be unique (!).
           Push a new entry otherwise.
         */
        assert(!T.isMissing(key))
        if (!this.has(key)) return this.pushEntry({key, ...props})

        let ids = this._keys.get(key)
        if (ids.length > 1) throw new Error(`multiple entries (${ids.length}) for a key, '${key}'`)

        return this._overwrite(ids[0], props)
    }

    _overwrite(id, {key, value, label, comment} = {}) {
        /* Overwrite in place some or all of the properties of an entry of a given `id` = position in this._entries.
           Return the modified entry. Passing `null` as a key/label/comment will delete a corresponding property. */
        let e = this._entries[id]
        let prevKey = e.key
        if (value !== undefined) e.value = value
        if (key   !== undefined) {if (key) e.key = key; else delete e.key}
        if (label !== undefined) {if (label) e.label = label; else delete e.label}
        if (comment !== undefined) {if (comment) e.comment = comment; else delete e.comment}

        if (prevKey !== key && key !== undefined) {             // `key` has changed? update this._keys accordingly
            if (!T.isMissing(prevKey)) this._deleteKey(prevKey, id)
            if (!T.isMissing(key))     this._insertKey(key, id)
        }
        return e
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

    push(key, value, {label, comment} = {}) {
        /* Create and append a new entry without deleting existing occurrencies of the key. */
        return this.pushEntry({key, value, label, comment})
    }

    pushEntry(entry) {
        /* Append `entry` (no copy!) to this._entries while keeping the existing occurrencies of entry.key.
           Drop unneeded props in `entry`, insert into this._entries, update this._keys.
         */
        entry = this._clean(entry)
        let pos = this._entries.push(entry) - 1                 // insert to this._entries and get its position
        if (!T.isMissing(entry.key)) {                          // update this._keys
            let ids = this._keys.get(entry.key) || []
            if (ids.push(pos) === 1)
                this._keys.set(entry.key, ids)
        }
        return entry
    }

    _clean(entry) {
        /* Validate and clean up the new entry's properties. */
        if(entry.value === undefined)
            assert(false)
        assert(entry.value !== undefined)
        assert(isstring(entry.key) && isstring(entry.label) && isstring(entry.comment))
        if (T.isMissing(entry.key)) delete entry.key
        if (entry.label === undefined) delete entry.label           // in some cases, an explicit `undefined` can be present, remove it
        if (entry.comment === undefined) delete entry.comment
        return entry
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
            if (!T.isMissing(entry.key)) {
                let ids = this._keys.get(entry.key)
                let id  = ids.pop()                 // indices in `ids` are stored in increasing order, so `pos` must be the last one
                assert(id === pos)
                if (!ids.length) this._keys.delete(entry.key)
            }
        }
        else {
            // general case: delete the entry, rearrange the _entries array, and rebuild this._keys from scratch
            let entry = this._entries[pos]
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
            this.pushEntry(entry)       // special case: inserting at the END does NOT require rebuilding the entire _keys maps
        else {
            // general case: insert the entry, rearrange the _entries array, and rebuild this._keys from scratch
            entry = this._clean(entry)
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

    insert(path, pos, entry) {
        /* Insert a new `entry` at position `pos` in a subcatalog identified by `path`; empty path denotes this catalog. */
        path = this._normPath(path)
        if (!path.length) return this._insertAt(pos, entry)
        let [_, subpath, subcat] = this.step(path)
        if (subcat instanceof Catalog) return subcat.insert(subpath, pos, entry)        // nested Catalog? make a recursive call
        throw new Error(`path not found: ${subpath.join('/')}`)
    }

    delete(path) {
        /* Delete a (sub)entry uniquely identified by `path`. */
        let [pos, subpath, subcat] = this.step(path)
        if (!subpath.length) return this._deleteAt(pos)
        if (subcat instanceof Catalog) return subcat.delete(subpath)        // nested Catalog? make a recursive call
        throw new Error(`path not found: ${subpath.join('/')}`)
    }
    
    update(path, {key, value, label, comment}, context = {}, sep = '/') {
        /* Modify an existing entry at a given `path`. The entry must be unique. Return the entry after modifications.
           This method should be used to apply manual data modifications.
           Automated changes, which are less reliable, should go through update() to allow for deduplication etc. - TODO
         */
        let props = {key, value, label, comment}
        let [pos, subpath] = this.step(path)
        if (!subpath.length) return this._overwrite(pos, props)     // `path` has only one segment, make the modifications and return

        let subcat = this._entries[pos].value
        if (subcat instanceof Catalog)                              // nested Catalog? make a recursive call
            return subcat.update(subpath, props)

        throw new Error(`path not found: ${subpath.join('/')}`)
    }

    move(path, pos1, pos2) {
        /* In a (sub)catalog pointed to by `path`, move the entry at position `pos1` to position `pos2` while shifting after entries. */
        path = this._normPath(path)
        if (!path.length) return this._move(pos1, pos2)
        let [_, subpath, subcat] = this.step(path)
        if (subcat instanceof Catalog) return subcat.move(subpath, pos1, pos2)        // nested Catalog? make a recursive call
        throw new Error(`path not found: ${subpath.join('/')}`)
    }

    /***  Transformations  ***/

    transform(ops, {deep = true} = {}) {
        /* Transform this Catalog and its nested subcatalogs (if deep=true) in place by applying the
           {key, value, label, comment, entry} transformations as passed in `ops`.
           Each operator in `ops` is a function that takes an original JS value and returns its replacement
           (can be the same value). When an operator is missing, the corresponding value is left unchanged.
         */
        // let entries = this._entries.map(e => ({...e}))          // copy each individual entry for subsequent modifications
        let entries = this._entries

        if (deep)                                               // call transform() recursively on subcatalogs
            for (let e of entries)
                if (e.value instanceof Catalog)
                    e.value.transform(ops, {deep})

        if (ops.entry) {
            entries = entries.map(ops.entry)                    // modify each entry as a whole
            ops = {...ops}
            delete ops.entry
        }

        for (const [prop, op] of Object.entries(ops))           // modify individual properties of each entry
            entries = entries.map(e => {
                if(prop in e && (e[prop] = op(e[prop])) === undefined)
                    delete e[prop]
                return e
            })

        this.init(entries)
        // return new this.constructor(entries)
    }


    /***  Serialization  ***/

    __getstate__() {
        /* Encode this Catalog's state either as an object (more compact but requires unique string keys and no annotations),
           or as an array of [key, value] tuples - some tuples may additionally contain a label and a comment.
         */
        let defined = (x) => x === undefined ? null : x             // function to replace "undefined" with null
        let entries = this._entries.map(e =>
        {
            let entry = [defined(e.key), defined(e.value)]          // entry = [key, value, label-maybe, comment-maybe]
            if (e.label || e.comment) entry.push(defined(e.label))
            if (e.comment) entry.push(e.comment)
            return entry
        })

        assert(!this.hasAnnot())

        if (!this.hasUniqueKeys()) {
            // if (this.hasAnnot()) return entries
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

    __setstate__(state) {
        if (!T.isArray(state)) {                    // if state is an object (compact representation) convert it to an array
            state = Object.entries(state)
            state = state.map(([key, value]) => [key.split('/')[0], value])     // convert keys of the form "key/X" back to "key"
        }

        // convert each entry [key,value,...] in the array to an object {key, value, ...}
        state = state.map(([key, value, label, comment]) => ({key, value, label, comment}))

        this.init(state)
        return this
    }
}


export class Data extends Catalog {
    /* Added functionality:
       - derived features (and subfeatures?)
    */
}

export class List extends Catalog {
    /* A Catalog with values only; no keys, labels, comments. */
}
export class Record extends Catalog {
    /* A Catalog with unique keys for all entries; no labels; comments allowed. */
}

// class CATALOG extends Type {
//     use_keys Y/N
//         allow_duplicate
//         allow_missing
//         allow_empty ??                // if true, '' string is a valid key (better skip this)
//     use_labels
//     use_comments
// }

