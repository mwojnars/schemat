// import BTree from 'sorted-btree'
import { print, assert, T } from './utils.js'


/**********************************************************************************************************************
 **
 **  UTILITIES
 **
 */

function isstring(s) {
    return s === null || s === undefined || typeof s === 'string'
}


/**********************************************************************************************************************
 **
 **  ITEMS MAP
 **
 */

export class ItemsMap extends Map {
    /* A Map that keeps objects of arbitrary type (items, records, promises) indexed by item ID converted to a string.
       Item ID is an array that must be converted to a string for equality comparisons inside Map.
     */

    constructor(pairs = null) {
        super()
        if (pairs)
            for (const [id, obj] of pairs) this.set(id, obj)
    }

    static reversed(catalog) {
        /* Given a catalog of entries where values are items, create a reversed ItemsMap: item.id -> key.
           If there are multiple entries with the same item, the last entry's key will be assigned to the item's id.
         */
        return new ItemsMap(catalog.map(({key, value:item}) => [item.id, key]))
    }

    _key(id) {
        assert(id)
        let [cid, iid] = id
        assert(cid !== null && iid !== null)
        return `${cid}:${iid}`
    }
    set(id, obj) { super.set(this._key(id), obj) }
    get(id)        { return super.get(this._key(id)) }
    has(id)        { return super.has(this._key(id)) }
    delete(id)     { return super.delete(this._key(id)) }
}

export class ItemsCount extends ItemsMap {
    /* A special case of ItemsMap where values are integers that hold counts of item occurrences. */
    add(id, increment = 1) {
        let proto = Map.prototype           // accessing get/set() of a super-super class must be done manually through a prototype
        let key   = this._key(id)
        let count = proto.get.call(this, key) || 0
        count += increment
        proto.set.call(this, key, count)
        return count
    }
    total()     { let t = 0; this.forEach(v => t += v); return t }
}

export class ItemsCache extends ItemsMap {
    /* An ItemsMap that keeps Item instances and additionally provides manually-invoked eviction by LRU and per-item TTL.
       Eviction timestamps are stored in items (item.evict) and can be modified externally by the Item or Registry.
       Currently, the implementation scans all items for TTL eviction, which should work well for up to ~1000 entries.
       For larger item sets, a BTree could possibly be used: import BTree from 'sorted-btree'
     */

    set(id, item, ttl_ms = null) {
        /* If ttl_ms=null or 0, the item is scheduled for immediate removal upon evict(). */
        if (ttl_ms) item.expiry = Date.now() + ttl_ms
        super.set(id, item)
    }
    evict() {
        let proto = Map.prototype           // accessing delete() of a super-super class must be done manually through a prototype
        let now   = Date.now()
        for (let [key, item] of this.entries())
            if (!item.expiry || item.expiry <= now) {
                proto.delete.call(this, key)            // since we pass a key, not an ID, we need to call a super-super method here
                // print('item evicted:', key, item.loaded ? '' : '(stub)' )
            }
    }
}

/**********************************************************************************************************************
 **
 **  CATALOG
 **
 */

export class Catalog {
    /* An Array-like and Map-like collection of entries; each entry contains a `value`, an `id`, and an optional:
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
    _keys    = new Map()        // for each key, a list of positions in _entries where this key occurs, sorted

    get length()        { return this._entries.length }  //{ return this.size }
    has(key)            { return this._keys.has(key)  }
    hasKeys()           { return this._keys.size > 0  }
    hasUniqueKeys()     { return this._keys.size === this.length }
    hasAnnot()          { return this._entries.filter(e => e && (e.label || e.comment)).length > 0 }     // at least one label or comment is present?
    isDict()            { return this.hasUniqueKeys() && !this.hasAnnot() }
    asDict()            { return Object.fromEntries(this._entries.map(e => [e.key, e.value])) }
    map(fun)            { return Array.from(this._entries, fun) }
    *keys()             { yield* this._keys.keys() }
    *values()           { yield* this._entries.map(e => e.value) }
    *entries()          { yield* this._entries }
    *[Symbol.iterator](){ yield* this._entries }            // iterator over entries, same as this.entries()

    constructor(data = null) {
        if (!data) return
        if (data instanceof Catalog)
            data = data.getEntries()
        if (data instanceof Array)
            for (const entry of data) {
                assert('value' in entry)
                this.pushEntry(entry)
            }
        else if (T.isDict(data))
            for (const [key, value] of Object.entries(data))
                this.pushEntry({key, value})
    }

    __setstate__(state)     { this.build(state.entries); return this }
    __getstate__()          { this._entries.map(e => assert(e.value !== undefined)); return {entries: this._entries} }
                            // value=undefined can't be serialized as it would get replaced with null after deserialization

    build(entries = null) {
        /* (Re)build this._keys mapping based on this._entries. */
        this._keys = new Map()
        if (entries) this._entries = [...entries]
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
            return ids[0]
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

    getValues(...keys) {
        /* Return an array of all values that are present for given top-level key(s). */
        return this.getEntries(...keys).map(e => e.value)
    }

    getEntries(...keys) {
        /* Return the entries having the given keys. The order of entries is preserved (as in this._entries).
           If no key was given, all entries are returned.
         */
        if (!keys.length) return [...this._entries]
        let refs = []
        for (let key of keys) {
            let r = this._keys.get(key)
            if (r) refs.push(...r)
        }
        return refs.sort().map(pos => this._entries[pos])
    }

    getEmpty() {
        /* Return all entries with an empty key (missing, null, ''). */
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

    findValue(path, default_ = undefined) {
        /* Return a value on a given path, or default_ if path not found. */
        let entry = this.findEntry(path)
        return entry === undefined ? default_ : entry.value
    }

    findEntry(path, default_ = undefined) {

        // make one step forward, then call findEntry() recursively if needed
        let [pos, subpath, subcat] = this.step(path, false)
        if (pos < 0) return default_
        if (!subpath.length) return this._entries[pos]

        if (subcat instanceof Catalog)  return subcat.findEntry(subpath, default_)
        if (subpath.length > 1)         return default_
        let key = subpath[0]

        if (subcat instanceof Map)  return {key, value: subcat.get(key)}        // last step inside a Map
        if (T.isDict(subcat))       return {key, value: subcat[key]}            // last step inside a plain object
        return default_
    }

    static merge(...catalogs) {
        /* Merge `catalogs` into a new Catalog instance.
           Only the entries with keys are included in the result, one entry per key.
           If a key occurs multiple times in `catalogs`, the first occurrence is used.
         */
        let catalog = new Catalog()
        for (const cat of catalogs) {
            if (!cat) continue
            for (const entry of cat)
                if (entry.key !== undefined && !catalog.has(entry.key))
                    catalog.pushEntry({...entry})
        }
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
        /* Append `entry` to this._entries while keeping the existing occurrencies of entry.key.
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
            this.build(entries)
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
            this.build(entries)
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

        this.build(entries)
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
            })

        this.build(entries)
        // return new this.constructor(entries)
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

// class CATALOG extends Schema {
//     use_keys Y/N
//         allow_duplicate
//         allow_missing
//         allow_empty ??                // if true, '' string is a valid key (better skip this)
//     use_labels
//     use_comments
// }

