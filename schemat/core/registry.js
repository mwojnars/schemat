import {ObjectsCache} from "../data.js";


export class Registry {
    /* Process-local cache of web objects, records and indexes loaded from DB. */

    _cache = new ObjectsCache()
    _ts_last_purge = 0      // timestamp of the last cache purge

    has(id)         { return this._cache.has(id) }
    get(id)         { return this._cache.get(id) }
    set(id, obj)    { this._cache.set(id, obj) }
    values()        { return this._cache.values() }
    evict_expired() { return this._cache.evict_expired() }
}