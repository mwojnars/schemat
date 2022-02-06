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
       Keys, labels, comments, if present, are strings. `id` is an integer and is equal to the position
       of an entry in a list of all entries; when an entry is deleted, it gets marked as undefined,
       so that ids and positions of following entries stay unchanged (!). `id` is excluded from serialization in CATALOG.
       Keys may repeat. Keys may include all printable characters except ":" and whitespace.
       Labels may include all printable characters except ":", newline, tab (spaces allowed).
       Comments may include all printable characters including whitespace.
       Empty strings in label/comment are treated as missing. Empty string is a valid non-missing key.
       Entries can be accessed by their key, or integer position (0,1,...), or a path. The path may contain
       - labels: "key:label/key2:label2"
       - flags:  "key/key2:label::first" or "key::last" (first/last flag at the end of a path, after ::)
    */

    _entries = []               // plain objects with {key, value, label, comment} attributes
    _keys    = new Map()        // for each key, a list of positions in _entries where this key occurs, sorted
    size     = 0                // the true number of entries in this._entries, `undefined` ignored

    get length()        { return this.size }
    has(key)            { return this._keys.has(key) }
    hasKeys()           { return this._keys.size > 0  }
    hasUniqueKeys()     { return this._keys.size === this.size }
    hasAnnot()          { return this._entries.filter(e => e && (e.label || e.comment)).length > 0 }     // at least one label or comment is present?
    isDict()            { return this.hasUniqueKeys() && !this.hasAnnot() }
    asDict()            { return Object.fromEntries(this.map(e => [e.key, e.value])) }
    map(fun)            { return Array.from(this.entries(), fun) }
    *keys()             { return this._keys.keys }
    *values()           { for (const e of this._entries) if(e) yield e.value }
    *entries()          { for (const e of this._entries) if(e) yield e }
    *[Symbol.iterator](){ for (const e of this._entries) if(e) yield e }      // iterator over entries, same as this.entries()

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

    __setstate__(state)     { for (let e of state.entries) this.pushEntry(e); return this }
    __getstate__()          { return {entries: this.getEntries().map(e => {let {id, ...f} = e; return f})} }    // drop entry.id, it can be recovered

    _normPath(path)         { return typeof path === 'string' ? path.split('/') : path }

    _findPosition(key, {unique = false} = {}) {
        /* Find a (unique) position of a `key`, the key being a string or a number. Return undefined if not found.
           Raise an exception if multiple occurrences.
         */
        if (Number.isInteger(key)) return this._entries[key] ? key : undefined
        if (this._keys.has(key)) {
            let poslist = this._keys.get(key)
            if (poslist.length > 1) throw new Error(`unique entry expected for '${key}', found ${poslist.length} entries instead`)
            return poslist[0]
        }
    }
    _findEntry(key, {unique = false} = {}) {
        if (typeof key === 'number') return this._entries[key]
        if (this._keys.has(key)) {
            let poslist = this._keys.get(key)
            if (unique && poslist.length > 1) throw new Error(`unique entry expected for '${key}', found ${poslist.length} entries instead`)
            return this._entries[poslist[0]]            // first entry returned if multiple occurrences
        }
    }
    _findEntries(key) {
        let poslist = this._keys.get(key) || []
        return poslist.map(pos => this._entries[pos])
    }

    get(path, default_ = undefined) {
        /* Return a value on a given path, or default_ if path not found. */
        let entry = this.getEntry(path)
        return entry === undefined ? default_ : entry.value
    }
    getAll(key) {
        /* Return an array of all values that are present for a given top-level key. */
        return this._findEntries(key).map(e => e.value)
    }
    getEntry(path, default_ = undefined) {
        path = this._normPath(path)

        // make one step forward, then call getEntry() recursively if needed
        let step  = path[0]
        let entry = this._findEntry(step)

        if (!entry) return default_
        if (path.length <= 1) return entry

        let subcat  = entry.value
        let subpath = path.slice(1)

        if (subcat instanceof Catalog)  return subcat.getEntry(subpath, default_)
        if (subpath.length > 1)         return default_
        let key = subpath[0]

        if (subcat instanceof Map)  return {key, value: subcat.get(key)}        // last step inside a Map
        if (T.isDict(subcat))       return {key, value: subcat[key]}            // last step inside a plain object
        return default_
    }
    getEntries(key = undefined) {
        if (key === undefined) return Array.from(this.entries())
        return this._findEntries(key)
    }

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
        let entry = this._findEntry(step, {unique: true})
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
        let ids = this._keys.get(key)
        let pos = ids.indexOf(id)
        assert(pos >= 0)
        ids[pos] = undefined
        ids = ids.filter(Number).sort()
        ids.length ? this._keys.set(key, ids) : this._keys.delete(key)
    }
    _deleteID(id) {
        /* Delete an entry given its ID (position in _entries). */
        let entry = this._entries[id]
        if (entry === undefined) throw new Error("trying to delete a non-existing entry")
        this._deleteKey(entry.key, id)
        this._entries[id] = undefined                   // mark the entry as deleted; no physical rewrite of the array
        this.size--
    }

    push(key, value, {label, comment} = {}) {
        /* Create and append a new entry without deleting existing occurrencies of the key. */
        return this.pushEntry({key, value, label, comment})
    }

    pushEntry(entry) {
        /* Append `entry` without deleting existing occurrencies of the key:
           Drop unneeded props in `entry`, insert into this._entries, assign entry.id, update this._keys.
         */
        assert(isstring(entry.key) && isstring(entry.label) && isstring(entry.comment))
        assert(entry.value !== undefined)

        // clean up the entry's properties
        if (T.isMissing(entry.key)) delete entry.key
        if (entry.label === undefined) delete entry.label           // in some cases, an explicit `undefined` can be present, remove it
        if (entry.comment === undefined) delete entry.comment

        // insert to this._entries
        entry.id = this._entries.push(entry) - 1                    // insert to this._entries AND assign its position as `id`
        this.size ++

        // update this._keys
        if (!T.isMissing(entry.key)) {
            let ids = this._keys.get(entry.key) || []
            if (ids.push(entry.id) === 1)
                this._keys.set(entry.key, ids)
        }
        return entry
    }
    
    step(path) {
        /* Make one step along a `path`. Return the position of the 1st entry on the path (must be unique),
           the remaining path, and the value object found after the 1st step. */
        path = this._normPath(path)
        assert(path.length >= 1)

        let step = path[0]
        let pos = this._findPosition(step, {unique: true})
        if (pos === undefined) throw new Error(`path not found: ${step}`)
        let subpath = path.slice(1)
        let value = this._entries[pos].value

        return [pos, subpath, value]
    }

    /***  Higher-level edit operations  ***/

    insert(path, pos, entry) {
        /* Insert a new `entry` at position `pos` in a subcatalog identified by `path` (empty path denotes this catalog).
           `pos` is an integer that says how many existing non-missing entries must be skipped
           before the `entry` is inserted into this._entries.
         */
        path = this._normPath(path)
        if (path.length) {
            let [pos, subpath, subcat] = this.step(path)
            if (subcat instanceof Catalog) return subcat.insert(subpath, pos, entry)        // nested Catalog? make a recursive call
            throw new Error(`path not found: ${subpath.join('/')}`)
        }
        // no more recursion? insert here...

        // skip `pos` number of existing entries

    }

    delete(path) {
        /* Delete a (sub)entry uniquely identified by `path`. */
        let [pos, subpath, subcat] = this.step(path)
        if (!subpath.length) return this._deleteID(pos)
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


    // delete(key) {
    //     /* Delete a single entry at a given position in _entries, if `key` is a number (entry.id);
    //        or delete all 0+ entries whose entry.key === key. Return the number of entries deleted.
    //      */
    //     let count
    //     if (typeof key === 'number') {
    //         let id = key, e = this._entries[key]
    //         if (id < 0 || id >= this._entries.length) return 0
    //         this._entries[id] = undefined                       // mark entry at position `id` as deleted
    //
    //         let ids = this._keys.get(e.key)
    //         assert(ids.length >= 1 && ids.includes(id))
    //         T.deleteFirst(ids, id)                              // update this._keys & this.size
    //         if (ids.length === 0) this._keys.delete(e.key)
    //         count = 1
    //
    //     } else {
    //         let ids = this._keys.get(key)
    //         if (!ids) return 0
    //         assert(ids.length >= 1)
    //         for (const id of ids)
    //             this._entries[id] = undefined
    //         this._keys.delete(key)
    //         count = ids.length
    //     }
    //
    //     this.size -= count
    //     return count
    // }
}


export class Data extends Catalog {
    /* Added functionality:
       - derived features (and subfeatures?)
    */
}


// class CATALOG extends Schema {
//     use_keys Y/N
//         allow_duplicate
//         allow_missing
//         allow_empty ??                // if true, '' string is a valid key (better skip this)
//     use_labels
//     use_comments
// }

