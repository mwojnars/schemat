import {print, assert, randint} from "../common/utils.js";
import {Objects} from "../common/structs.js";
import {Catalog} from "./catalog.js";
import {WebObject} from "./object.js";

/**********************************************************************************************************************/

export class Transaction {
    /* Logical transaction (pseudo-transaction). A group of related database mutations that will be
       pushed together to the DB. Does NOT currently provide ACID guarantees of consistency and atomicity.

       The role of transaction is to:
       - track mutations applied to web objects in a given execution thread;
       - track new object instantiations; count newborn objects and assign provisional IDs;
       - send these changes to the database upon request, or when the transaction is committed;
       - receive back the updated records: save them in local cache and backpropagate to the originator of the transaction.

       The fact that transaction assigns provisional IDs to new objects is the reason why it is instantiated everywhere:
       on client and on every individual RPC/IPC request received by a worker process on server. (TODO)

       IMPORTANT: at the moment, transactions are NOT ATOMIC!
     */

    /* Attributes:

       tid              Transaction ID (on server only)
       debug            if true, debug info should be printed/collected while executing this transaction
       committed        becomes true after commit(), indicates that this transaction is closed (no more objects can be added)
       ?? derived       true in a derived TX object that was spawned by a parent Transaction; the child inherits `tid`, but cannot commit the transaction (not a coordinator)
    */

    _staging = new Objects()    // staging area: a set of mutated or newborn objects that wait for being saved to DB
    _provisional = 0            // highest __provisional_id assigned to newborn objects so far

    // captured DB changes after commit & save:
    _updated = []               // array of {id, data} records received from DB after committing the corresponding objects

    constructor(lite = false) {
        if (schemat.debug) this.debug = true
        // if (lite) return
        // this.tid = 1 + randint(10000) /* 1 + randint() */
    }

    get_mutable(obj) {
        /* Return an object's mutable copy that's unique transaction-wide: multiple calls return the same copy,
           so consecutive modifications add to, rather than replace, previous ones. If the object is not yet
           in the staging area, a new mutable copy is created and staged.
         */
        let existing = this._staging.get(obj)
        if (existing === obj) return obj
        if (existing?.__meta.edits.length) return existing
        if (existing) this._discard(existing)       // it is OK to replace an existing instance if it has no unsaved edits

        return this.stage(obj._get_mutable())
    }

    stage(obj) {
        /* Add a web object to the transaction. */
        if (this.committed) throw new Error(`cannot add an object to a committed transaction`)
        return obj.is_newborn() ? this._stage_newborn(obj) : this._stage_edited(obj)
    }

    _stage_newborn(obj) {
        assert(!obj.__provisional_id)
        obj.__self.__provisional_id = ++this._provisional
        return this._staging.add(obj)
    }

    _stage_edited(obj) {
        assert(obj.__meta.mutable && !obj.__meta.obsolete)

        let existing = this._staging.get(obj)
        if (existing === obj) return obj
        if (existing)
            if (existing.__meta.edits.length) throw new Error(`a different copy of the same object ${obj} is already staged`)
            else this._discard(existing)

        return this._staging.add(obj)
    }

    stage_edits(id, edits) {
        /* Convert an array of raw edits into a web object, so it can be stored in _staging. Importantly, the object
           has no __data (pseudo-object), so it does NOT require data loading from DB ahead of save().
         */
        let obj = WebObject.pseudo(id, edits)
        return this._stage_edited(obj)
    }

    has(obj)        { return this._staging.has(obj) }
    has_exact(obj)  { return this._staging.has_exact(obj) }


    async save(objects = null, opts = {}) {
        /* Save pending changes to the database: either all those staged, or the ones in `objects` (can be a single object). */
        if (!this._staging.size) return
        if (objects && typeof objects === 'object') objects = [objects]

        if (!objects) objects = [...this._staging]
        else
            for (let obj of objects)        // every object must have been staged already
                if (!this.has_exact(obj)) throw new Error(`object ${obj} was not staged in transaction so it cannot be saved`)

        let newborn = objects.filter(obj => obj.__provisional_id)
        let edited  = objects.filter(obj => obj.id && obj.__meta.edits.length > 0)

        if (newborn.length) await this._save_newborn(newborn, opts)
        if (edited.length)  await this._save_edited(edited, opts)
    }

    async _save_newborn(objects, opts) {
        // new objects must be inserted all together due to possible cross-references
        let datas = objects.map(obj => obj.__data.__getstate__())
        let ids = await this._db_insert(datas, opts)

        // replace provisional IDs with proper IDs in original objects
        ids.map((id, i) => {
            let obj = objects[i]
            this._staging.delete(obj)
            obj.id = id
            delete obj.__self.__provisional_id

            // re-stage the object under its proper ID, as it can still receive mutations in the future
            assert(!this._staging.has(obj))
            obj.__meta.edits = []       // `edits` array is uninitialized in newborns
            this._staging.add(obj)
        })
    }

    async _save_edited(objects, opts) {
        await this._db_update(objects, opts)
        for (let obj of objects) obj.__meta.edits.length = 0    // mark that there are no more pending edits

        // the objects are NOT removed from _staging because they still remain mutable and can receive new mutations,
        // so any future .save() need to check if they shouldn't be pushed to DB again
    }

    revert() { return this._clear() }

    _clear() {
        /* Remove all pending changes from this transaction. We cannot revert edits in a mutable instance because
           they were already applied to __data, but we can mark it as obsolete.
         */
        for (let obj of this._staging) this._discard(obj)
    }

    _discard(obj) {
        /* Remove `obj` from staging, usually after all mutations have been pushed to DB and the object is replaced with a newer copy. */
        obj.__meta.obsolete = true
        this._staging.delete(obj)
    }

    capture(...records) {
        /* Remember updated records received from the DB, so they can be propagated further back to the originator.
           WARNING: in case of multiple modifications to the same record, the one received most recently will take
                    precedence in the Registry, which may not always be the most recent version of the object.
           // TODO: detect duplicates, restrict the size of `records`
         */
        for (let rec of records)
            this._updated.push(rec)
    }
}

/**********************************************************************************************************************/

export class ServerTransaction extends Transaction {
    /* Server-side transaction object. */

    tid = 1 + randint(10000) /* 1 + randint() */

    async _db_insert(datas, opts) {
        return schemat.db.insert(datas, opts)       // returns an array of IDs assigned
    }

    async _db_update(objects, opts) {
        let db = schemat.db
        return Promise.all(objects.map(obj => db.update(obj.id, obj.__meta.edits, opts)))
    }

    async commit(opts = {}) {
        /* Save all the remaining unsaved mutations to DB and mark this transaction as completed and closed. */
        this.committed = true
        await this.save(null, opts)     // transfer all pending changes to the database
        this._clear()                   // allow garbage collection of objects
        // TODO: when atomic transactions are implemented, the transaction will be marked here as completed
    }

    /*  Serialization  */

    static load({tid, debug}) {
        let tx = new ServerTransaction()
        tx.tid = tid
        tx.debug = debug
        // tx._updated = records || []
        return tx
    }

    dump_tx() {
        let {tid, debug} = this
        return {tid, debug}
    }

    dump_records() {
        return this._updated.map(({id, data}) => ({id, data:
                (typeof data === 'string') ? JSON.parse(data) :
                (data instanceof Catalog) ? data.encode() : data
        }))
    }
}

// export class LiteTransaction extends Transaction {
//     /* A transaction without TID that allows non-atomic saving of mutations (save()), but not committing the transaction as a whole.
//        This means the transaction is always open: it can exist for a long time and be reused for new groups of mutations.
//      */
//
//     constructor() { super(true) }
//     commit() { throw new Error(`lite transaction cannot be committed`) }
// }

/**********************************************************************************************************************/

export class ClientTransaction extends Transaction {
    /* Client-side transaction object. No TID. No commits. Exists permanently. */

    async _db_insert(datas, opts) {
        return (await schemat.app.action.insert_objects(datas, opts)).map(obj => obj.id)
    }

    async _db_update(objects, opts) {
        return Promise.all(objects.map(obj => schemat.app.action.apply_edits(obj.id, obj.__meta.edits, opts)))
    }

    commit() { throw new Error(`client-side transaction cannot be committed`) }
    capture(...records) {}      // on client, records are saved in Registry and this is enough (no further back-propagation is done)
}

