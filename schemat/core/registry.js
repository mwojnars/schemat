import {assert, print} from "../common/utils.js";
import {ObjectsCache} from "../data.js";
import {ROOT_ID} from "../item.js";


export class Registry {
    /* Process-local cache of web objects, records and indexes loaded from DB. */

    _cache = new ObjectsCache()
    _ts_last_purge = 0                  // timestamp of the last cache purge

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

    async purge() {
        /* Evict expired objects from the cache. */
        print("cache purging...")

        const on_evict = (obj) => {
            if (obj._id_ === ROOT_ID) return schemat.reload(ROOT_ID)     // don't evict the root object
        }
        await this._cache.evict_expired(on_evict)

        // if (!this.registry.has(ROOT_ID))            // if root category is no longer present in registry, call _init_root() once again
        //     await schemat._init_root()                 // WARN: between evict() and _init_root() there's no root_category defined! problem if a request comes in

        this._ts_last_purge = Date.now()
        print("cache purging done")
    }
}