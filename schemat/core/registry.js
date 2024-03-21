import {ObjectsCache} from "../data.js";
import {assert} from "../common/utils.js";


export class Registry {
    /* Process-local cache of web objects, records and indexes loaded from DB. */

    _cache = new ObjectsCache()

    has(id)         { return this._cache.has(id) }
    get(id)         { return this._cache.get(id) }

    set(obj) {
        /* Put `obj` in the cache. This may override an existing instance with the same ID. */
        assert(obj._id_ !== undefined, `cannot register an object without an ID: ${obj}`)
        assert(!obj._meta_.mutable, `cannot register a mutable object: ${obj}`)
        this._cache.set(obj._id_, obj)
        return obj
    }

    values()        { return this._cache.values() }
    purge()         { return this._cache.evict_expired() }
}