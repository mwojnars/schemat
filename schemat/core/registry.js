import {T, assert, print} from "../common/utils.js";
// import BTree from 'sorted-btree'


/**********************************************************************************************************************
 **
 **  CACHE of WEB OBJECTS
 **
 */

export class ObjectsCache extends Map {
    /* A cache of {id: object} pairs. Provides manually-invoked eviction by LRU and per-item TTL.
       Eviction timestamps are stored in items and can be modified externally.
       Currently, the implementation scans all entries for TTL eviction, which should work well for up to ~1000 entries.
       For larger sets, a BTree could possibly be used: import BTree from 'sorted-btree'
     */

    async evict_expired(on_evict = null) {
        /* on_evict(obj) is an optional callback that may perform custom eviction for specific objects
           (a truthy value must be returned then); can be async.
         */
        let now = Date.now()
        let pending = []
        let count = 0

        for (let [id, obj] of this.entries()) {
            if (obj._meta_.expiry > now) continue

            let evicted = on_evict?.(obj)
            if (T.isPromise(evicted)) evicted = await evicted       // TODO: add to `pending` instead of awaiting here
            if (!evicted) this.delete(id)
            // else print(`custom eviction done for: [${id}]`)
            count++

            let done = obj.__done__()          // TODO: cleanup must be called with a larger delay, after the item is no longer in use (or never?)
            if (T.isPromise(done)) pending.push(done)
        }

        print(`cache evicted objects: ${count}`)
        if (pending.length) return Promise.all(pending)
    }
}


/**********************************************************************************************************************
 **
 **  REGISTRY
 **
 */

export class Registry {
    /* Process-local cache of web objects, records and indexes loaded from DB. */

    objects = new ObjectsCache()

    _purging_now   = false
    _last_purge_ts = 0                  // timestamp of the last cache purge


    has(id)         { return this.objects.has(id) }
    get(id)         { return this.objects.get(id) }

    set(obj) {
        /* Put `obj` in the cache. This may override an existing instance with the same ID. */
        assert(obj._id_ !== undefined, `cannot register an object without an ID: ${obj}`)
        assert(!obj._meta_.mutable, `cannot register a mutable object: ${obj}`)
        this.objects.set(obj._id_, obj)
        return obj
    }

    *[Symbol.iterator]()    { yield* this.objects.values() }

    async purge(min_delay, on_evict) {
        /* Evict expired objects from the cache. */
        if (this._purging_now) return
        if (Date.now() - this._last_purge_ts < min_delay) return
        this._purging_now = true

        try { await this.objects.evict_expired(on_evict) }
        finally {
            this._purging_now = false
        }

        this._last_purge_ts = Date.now()
    }
}