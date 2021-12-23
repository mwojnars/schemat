// import BTree from 'sorted-btree'
import { print, assert, T } from './utils.js'
import { React, e, DIV, TABLE, TH, TR, TD, TBODY, FRAGMENT } from './react-utils.js'


/**********************************************************************************************************************
 **
 **  UTILITIES
 **
 */

function isstring(s) {
    return s === null || s === undefined || typeof s === 'string'
}
function missing(key) {
    return key === null || key === undefined
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
       Keys, labels, comments, if present, are strings. "id" is an integer and is equal to the position
       of an entry in a list of all entries; when an entry is deleted, it's marked as `undefined`,
       so that ids and positions of following entries stay unchanged (!).
       Keys may repeat. Keys may include all printable characters except ":" and whitespace.
       Labels may include all printable characters except ":", newline, tab (spaces allowed).
       Comments may include all printable characters including whitespace.
       Empty strings in label/comment are treated as missing. Empty string is a valid non-missing key.
       Entries can be accessed by their key, or integer position (0,1,...), or a path. The path may contain
       - labels: "key:label/key2:label2"
       - flags:  "key/key2:label::first" or "key::last" (first/last flag at the end of a path, after ::)
    */

    _entries = []
    _keys    = new Map()        // for each key, a list of positions in _entries where this key occurs
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

    _findEntry(key, {unique = false} = {}) {
        if (typeof key === 'number') return this._entries[key]
        if (this._keys.has(key)) {
            let poslist = this._keys.get(key)
            if (unique && poslist.length > 1) throw new Error(`unique Catalog entry expected for '${key}', found ${poslist.length} entries instead`)
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
        if (typeof path === 'string')
            path = path.split('/')

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

    set(path, value, {label, comment, create_path = false} = {}) {
        /* Create an entry at a given `path` (string or Array) if missing; or overwrite value/label/comment
           of an existing entry if the last segment of `path` is an integer (a position in this._entries);
           otherwise replace all entries matching `path` with a new one. If create_path is false (default),
           all segments of `path` except the last one must already exist and be unique; otherwise,
           new Catalog() entries are inserted in place of missing path segments (the segments must be strings not integers then).
         */
        if (typeof path === 'string') path = path.split('/')
        assert(path.length >= 1)

        let step  = path[0]
        let spath = path.join('/')
        let props = {label, comment}

        if (path.length <= 1)
            return this.setShallow(step, value, props)

        // make one step forward, then call set() recursively
        let entry = this._findEntry(step, {unique: true})
        if (!entry)
            if (create_path && typeof step === 'string')                // create a missing intermediate Catalog() if so requested
                this.setEntry({key: step, value: new Catalog()})
            else
                throw new Error(`path not found, missing '${step}' of '${spath}'`)

        let subcat  = entry.value
        let subpath = path.slice(1)

        // subcat is a Catalog? make a recursive call
        if (subcat instanceof Catalog)
            return subcat.set(subpath, value, props)

        // subcat is a Map or object? only go one step deeper
        let key = subpath[0]
        if (subpath.length === 1) {
            if (label   !== undefined) throw new Error(`can't assign a label (${label}) inside a non-catalog (${spath})`)
            if (comment !== undefined) throw new Error(`can't assign a comment (${comment}) inside a non-catalog (${spath})`)
            if (subcat instanceof Map) subcat.set(key, value)        // last step inside a Map
            if (T.isDict(subcat))      subcat[key] = value           // last step inside a plain object
            return {key, value}                 // a "virtual" entry is returned for consistent API, only for reading
        }

        throw new Error(`path not found: '${subpath.join('/')}'`)
    }

    // set(...args) { return this.setShallow(...args) }

    setShallow(key, value, {label, comment} = {}) {
        /* If key is a number, an entry at this position in this._entries is modified:
           a new value, label, and/or comment is assigned; pass `undefined` as a value/label/comment to leave
           the old object, or `null` to force its removal (for label/comment).
           A new entry is returned - should only be used for reading.
         */
        if (typeof key === 'number') return this._overwrite(key, {value, label, comment})
        return this.setEntry({key, value, label, comment})
    }
    _overwrite(id, {value, label, comment} = {}) {
        /* Overwrite some or all of the properties of an entry of a given `id` = position in this._entries.
           Return the modified entry. Passing `null` as a label or comment will delete a corresponding property. */
        let e = this._entries[id]
        if (value !== undefined) e.value = value
        if (label !== undefined) {if (label) e.label = label; else delete e.label}
        if (comment !== undefined) {if (comment) e.comment = comment; else delete e.comment}
        return e
    }
    setEntry(entry) {
        /* Append a new `entry` while deleting all existing occurrencies of the same key. */
        this._push(entry)
        if (!missing(entry.key)) {
            let ids = this._keys.get(entry.key) || []
            for (const id of ids)
                this._entries[id] = undefined           // like with standard delete, the remaining entries are NOT moved, only gaps are created
            this.size -= ids.length
            this._keys.set(entry.key, [entry.id])
        }
        return entry
    }
    push(key, value, {label, comment} = {}) {
        /* Create and append a new entry without deleting existing occurrencies of the key. */
        return this.pushEntry({key, value, label, comment})
    }
    pushEntry(entry) {
        /* Append `entry` without deleting existing occurrencies of the key. */
        this._push(entry)
        if (!missing(entry.key)) {
            let ids = this._keys.get(entry.key) || []
            if (ids.push(entry.id) === 1)
                this._keys.set(entry.key, ids)
        }
        return entry
    }
    _push(entry) {
        /* Drop unneeded props in `entry`; insert the entry into this._entries; assign entry.id. */
        assert(isstring(entry.key) && isstring(entry.label) && isstring(entry.comment))
        assert(entry.value !== undefined)
        if (missing(entry.key)) delete entry.key
        if (entry.label === undefined) delete entry.label           // in some cases, an explicit `undefined` can be present, remove it
        if (entry.comment === undefined) delete entry.comment

        entry.id = this._entries.push(entry) - 1                    // insert to this._entries AND assign its position as `id`
        this.size ++
    }

    delete(key) {
        /* Delete a single entry at a given position in _entries, if `key` is a number (entry.id);
           or delete all 0+ entries whose entry.key === key. Return the number of entries deleted.
         */
        let count
        if (typeof key === 'number') {
            let id = key, e = this._entries[key]
            if (id < 0 || id >= this._entries.length) return 0
            this._entries[id] = undefined                       // mark entry at position `id` as deleted

            let ids = this._keys.get(e.key)
            assert(ids.length >= 1 && ids.includes(id))
            T.deleteFirst(ids, id)                              // update this._keys & this.size
            if (ids.length === 0) this._keys.delete(e.key)
            count = 1

        } else {
            let ids = this._keys.get(key)
            if (!ids) return 0
            assert(ids.length >= 1)
            for (const id of ids)
                this._entries[id] = undefined
            this._keys.delete(key)
            count = ids.length
        }

        this.size -= count
        return count
    }

    // delete(key) {
    //     /* Delete a single entry at a given position in _entries, if `key` is a number;
    //        or delete all 0+ entries that contain a given `key` value. Return true if min. 1 entry deleted.
    //      */
    //     if (typeof key === 'number') {
    //         let pos = key, e = this._entries[key]
    //         if (pos < 0 || pos >= this._entries.length) return false
    //         this._entries.splice(pos, 1)                        // delete the entry at position `pos`, rearrange the array
    //         let poslist = this._keys.get(e.key)
    //         assert(poslist.length >= 1 && poslist.includes(pos))
    //         T.deleteFirst(poslist, pos)
    //         if (poslist.length === 0) this._keys.delete(e.key)
    //     } else {
    //         let poslist = this._keys.get(key)
    //         if (!poslist) return false
    //         assert(poslist.length >= 1)
    //         for (const pos of poslist)
    //             this._entries[pos] = undefined
    //         this._entries = this._entries.filter(Boolean)
    //         this._keys.delete(key)
    //     }
    //     return true
    // }

    __setstate__(state)     { for (let e of state.entries) this.pushEntry(e); return this }
    __getstate__()          { return {entries: this.getEntries().map(e => {let {id, ...f} = e; return f})} }    // drop entry.id, it can be recovered
    // __getstate__()          { return {entries: [...this._entries]} }


    /***  React widgets  ***/

    Table({item, path, schema, schemas, color, start_color}) {
        /* If `schemas` is provided, it should be a Map or a Catalog, from which a `schema` will be retrieved
           for each entry using: schema=schemas.get(key); otherwise, the `schema` argument is used for all entries.
           If `start_color` is undefined, the same `color` is used for all rows.
         */
        let entries = this.getEntries()
        let rows    = entries.map(({key, value, id}, i) =>
        {
            if (start_color) color = 1 + (start_color + i - 1) % 2
            if (schemas) schema = schemas.get(key)
            let entry, props = {item, path: [...path, id]}

            if (schema.isCatalog) {
                assert(value instanceof Catalog)
                entry = TD({className: 'ct-nested', colSpan: 2},
                          DIV({className: 'ct-field'}, key),
                          e(value.Table.bind(value), {...props, schema: schema.values, color}))
            }
            else entry = e(this.Entry, {...props, key_:key, value, schema})
            return TR({className: `is-row${color}`}, entry)
        })

        let depth = 1 + path.length
        let table = TABLE({className: `catalog${depth}`}, TBODY(...rows))
        return path.length ? DIV({className: 'wrap-offset'}, table) : table         // nested catalogs need a <div.wrap-offset> wrapper
    }

    Entry({item, path, key_, value, schema}) {
        /* A table row containing an atomic entry: a key and its value (not a subcatalog).
           The argument `key_` must have a "_" in its name to avoid collision with React's special prop, "key".
         */
        const save = async (newValue) => {
            // print(`save: path [${path}], value ${newValue}, schema ${schema}`)
            await item.remote_set({path, value: schema.encode(newValue)})        // TODO: validate newValue
        }
        return FRAGMENT(
                  TH({className: 'ct-field'}, key_),
                  TD({className: 'ct-value', suppressHydrationWarning:true}, schema.display({value, save})),
               )
    }
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

