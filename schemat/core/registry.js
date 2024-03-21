import {assert} from "../common/utils.js";
import {ObjectsCache} from "../data.js";
import {ROOT_ID} from "../item.js";


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

    purge() {
        const on_evict = (obj) => {
            if (obj._id_ === ROOT_ID) return schemat.reload(ROOT_ID)     // don't evict the root object
        }
        return this._cache.evict_expired(on_evict)
    }
}