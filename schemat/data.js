import { print, assert, T } from './utils.js'


function isstring(s) {
    return s === null || s === undefined || typeof s === 'string'
}
function missing(key) {
    return key === null || key === undefined
}

/**********************************************************************************************************************
 **
 **  CATALOG
 **
 */

export class Catalog {
    /* An Array-like and Map-like collection that keeps a list of values (entries) with optional:
       - key
       - label
       - comment
       in each entry, or in selected entries. Keys, labels, comments, if present, are strings.
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

    get size()          { return this._entries.length }
    get length()        { return this._entries.length }
    has(key)            { return this._keys.has(key) }
    hasKeys()           { return this._keys.size > 0  }
    hasUniqueKeys()     { return this._keys.size === this._entries.length }
    hasAnnot()          { return this._entries.filter(e => e.label || e.comment).length > 0 }     // at least one label or comment is present?
    isDict()            { return this.hasUniqueKeys() && !this.hasAnnot() }
    asDict()            { return Object.fromEntries(this._entries.map(e => [e.key, e.value])) }
    *keys()             { return this._keys.keys }
    *values()           { for (const e of this._entries) yield e.value }
    *entries()          { for (const e of this._entries) yield e }

    constructor(data = null) {
        if (!data) return
        if (data instanceof Catalog)
            data = data.getEntries()
        if (data instanceof Array)
            for (const entry of data)
                this.pushEntry(e)
        else if (T.isDict(data))
            for (const [key, value] of Object.entries(data))
                this.pushEntry({key, value})
    }

    get(path, default_ = undefined) {
        /* Return a value on a given path. */
        let entry = this.getEntry(path)
        return entry === undefined ? default_ : entry.value
    }
    getAll(key) {
        /* Return an array of all values that are present for a given key. */
        let poslist = this._keys.get(key) || []
        return poslist.map(pos => this._entries[pos].value)
    }
    getEntry(key) {
        if (typeof key === 'number') return this._entries[key]
        if (this._keys.has(key)) {
            let pos = this._keys.get(key)[0]        // first entry returned if multiple occurrences
            return this._entries[pos]
        }
    }
    getEntries(key) { return [...this._entries] }

    _prepare(entry) {
        assert(isstring(entry.key) && isstring(entry.label) && isstring(entry.comment))
        assert(entry.value !== undefined)
        if (missing(entry.key)) delete entry.key
        if (entry.label === undefined) delete entry.label           // in some cases, an explicit `undefined` can be present, remove it
        if (entry.comment === undefined) delete entry.comment
    }
    set(key, value, {label, comment} = {}) {
        /* If key is a number, an entry at this position in this._entries is modified:
           a new value, label, and/or comment is assigned; pass `undefined` as a value/label/comment to leave
           the old object, or `null` to force its removal (for label/comment).
         */
        if (typeof key === 'number') {
            let e = this._entries[key]
            if (value !== undefined) e.value = value
            if (label !== undefined) {if (label) e.label = label; else delete e.label}
            if (comment !== undefined) {if (comment) e.comment = comment; else delete e.comment}
            return e
        }
        return this.setEntry({key, value, label, comment})
    }
    setEntry(entry) {
        /* Append an entry while deleting all existing occurrencies of the same key. */
        this._prepare(entry)
        let pos = this._entries.push(entry) - 1
        if (!missing(entry.key)) {
            this.delete(entry.key)
            this._keys.set(entry.key, [pos])
        }
        return entry
    }

    push(key, value, {label, comment} = {}) {
        /* Create and append a new entry without deleting existing occurrencies of the key. */
        return this.pushEntry({key, value, label, comment})
    }
    pushEntry(entry) {
        /* Append `entry` without deleting existing occurrencies of the key. */
        this._prepare(entry)
        let pos = this._entries.push(entry) - 1
        if (!missing(entry.key)) {
            let poslist = this._keys.get(entry.key) || []
            if (poslist.push(pos) === 1)
                this._keys.set(entry.key, poslist)
        }
        return entry
    }

    delete(key) {
        /* Delete a single entry at a given position in _entries, if `key` is a number;
           or delete all 0+ entries that contain a given `key` value. Return true if min. 1 entry deleted.
         */
        if (typeof key === 'number') {
            let pos = key, e = this._entries[key]
            if (pos < 0 || pos >= this._entries.length) return false
            this._entries.splice(pos, 1)                        // delete the entry at position `pos`, rearrange the array
            let poslist = this._keys.get(e.key)
            assert(poslist.length >= 1 && poslist.includes(pos))
            T.deleteFirst(poslist, pos)
            if (poslist.length === 0) this._keys.delete(e.key)
        } else {
            let poslist = this._keys.get(key)
            if (!poslist) return false
            assert(poslist.length >= 1)
            for (const pos of poslist)
                this._entries[pos] = undefined
            this._entries = this._entries.filter(Boolean)
            this._keys.delete(key)
        }
        return true
    }

    *[Symbol.iterator]() {
        /* Iterator over entries. Same as this.entries(). */
        for (const ent of this._entries) yield ent
    }

    __getstate__() {
        return {entries: [...this._entries]}
    }
    __setstate__(state) {
        for (let e of state.entries) this.pushEntry(e)
        return this
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


/**********************************************************************************************************************/

export function _obj(cat) {
    if (cat instanceof Catalog) return cat.asDict()
    return cat
}
export function _has(cat, key) {
    if (cat instanceof Catalog) return cat.has(key)
    return key in cat
}
export function _get(cat, key) {
    if (cat instanceof Catalog) return cat.get(key)
    return T.getOwnProperty(cat, key)
}

