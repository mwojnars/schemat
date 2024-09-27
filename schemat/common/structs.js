/*
    Utilities strictly related to web objects.
 */


export class ObjectSet {
    /* A Set of objects deduplicated by object.id. When an existing ID is to be overwritten,
       the `__meta.loaded_at` property is compared and the most recent object is kept.
     */
    objects = new Map()

    add(obj) {
        if (obj.id === undefined) throw new Error("missing 'id' for the object to be added to the ObjectSet")
        if (!this.hasNewer(obj))
            this.objects.set(obj.id, obj)
        return this
    }

    delete(obj)     { return this.objects.delete(obj.id) }
    has(obj)        { return this.objects.has(obj.id) }
    ids()           { return this.objects.keys() }
    keys()          { return this.objects.values() }                // for compatibility with Set interface
    values()        { return this.objects.values() }
    clear()         { this.objects.clear() }

    hasNewer(obj) {
        /* True if the set already contains an object with the same ID and a newer or equal `__meta.loaded_at`. */
        let prev = this.objects.get(obj.id)
        return prev && (obj.__meta.loaded_at || 0) <= (prev.__meta.loaded_at || 0)
    }

    get size()      { return this.objects.size }
    get length()    { return this.objects.size }

    [Symbol.iterator]() { return this.objects.values() }

    forEach(callbackFn, thisArg) {
        this.objects.forEach((value) => {
            callbackFn.call(thisArg, value, value, this)
        })
    }
}


