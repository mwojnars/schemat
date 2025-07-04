import {T, assert, print, fluctuate} from "../common/utils.js";
import {CustomMap} from "../common/structs.js";
import {Catalog} from "../common/catalog.js";
// import BTree from 'sorted-btree'

/*
    TODO:
    TTL Cache package:  https://www.npmjs.com/package/@isaacs/ttlcache
    LRU Cache package:  https://www.npmjs.com/package/lru-cache
 */


/**********************************************************************************************************************
 **
 **  CACHE of WEB OBJECTS
 **
 */

class ObjectsCache extends Map {
    /* A cache of {id: object} pairs. Provides manually-invoked eviction by TTL.
       Eviction timestamps are stored in objects and can be modified externally.
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
            let expire_at = obj.__meta.expire_at || 0
            if (expire_at > now) continue

            let evicted = on_evict?.(obj)
            if (!evicted) this.delete(id)
            // else print(`custom eviction done for: [${id}]`)
            count++

            // let done = obj.__done__()          // TODO: cleanup must be called with a larger delay, after the item is no longer in use (or never?)
            // if (T.isPromise(done)) pending.push(done)
        }

        // print(`evicted from registry: ${count}`)
        if (pending.length) return Promise.all(pending)
    }
}

class VersionsCache extends CustomMap {
    /* A cache of {id_ver: object} pairs. */
    // TODO: use a standard LRU cache with a fixed capacity, no TTL

    convert([id, ver])  { return `${id}.${ver}` }
    reverse(key)        { return key.split('.').map(Number) }
}


/**********************************************************************************************************************
 **
 **  REGISTRY
 **
 */

export class Registry {
    /* Process-local cache of web objects, records and indexes loaded from DB, as well as dynamically loaded JS modules. */

    records  = new Map()                // cache of JSONx-stringified object's data, {id: data_json}; evicted en masse on every purge
    objects  = new ObjectsCache()       // cache of web objects; each object has its individual eviction period and time limit
    versions = new Map()

    _purging_now = false                // if the previous purge is still in progress, a new one is abandoned


    constructor(_schemat, on_evict) {
        this._schemat = _schemat
        this.on_evict = on_evict
        this._purge_records()
    }

    _purge_records() {
        /* Erase ALL records at regular intervals of around 1 sec. */
        if (this._schemat.terminating) return
        this.erase_records()
        setTimeout(() => this._purge_records(), fluctuate(1000))
    }

    get_record(id) { return this.records.get(id) }

    set_record(id, data) {
        assert(id !== undefined && data)
        if (typeof data === 'object') {
            assert(!(data instanceof Catalog))
            data = JSON.stringify(data)
        }
        this.records.set(id, data)
        return data
    }
    delete_record(id) { return this.records.delete(id) }

    get_object(id)  { return this.objects.get(id) }

    set_object(obj) {
        /* Put `obj` in the cache. This may override an existing instance with the same ID. */
        if (obj.id === undefined) throw new Error(`cannot register an object without an ID`)
        if (SERVER && obj.__meta.mutable) throw new Error(`cannot register a mutable object, [${obj.id}]`)
        this.objects.set(obj.id, obj)
        return obj
    }
    delete_object(id) { return this.objects.delete(id) }

    get_version(id, ver)    {}
    set_version(obj)        {}

    *[Symbol.iterator]()    { yield* this.objects.values() }

    async purge() {
        /* Evict expired objects from the cache. */
        if (this._purging_now) return
        this._purging_now = true

        try { await this.objects.evict_expired(this.on_evict) }
        finally {
            this._purging_now = false
        }
        // this.erase_records()
    }

    erase_records() { this.records.clear() }
    erase_objects() { this.objects.clear() }
}