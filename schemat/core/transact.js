import {Objects} from "../common/structs.js";
import {assert, randint} from "../common/utils.js";
import {Catalog} from "./catalog.js";

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

    // staging area:
    _edited  = new Objects()    // a set of persisted (with IDs) mutable objects that have been modified in this transaction and wait for being committed
    _created = new Set()        // a set of newly created web objects that wait for insertion to DB
    _provisional = 0            // highest __provisional_id so far

    // captured DB changes after commit & save:
    _updated = []               // array of {id, data} records received from DB after committing the corresponding objects

    constructor(light = false) {
        if (schemat.debug) this.debug = true
        // if (light) return
        // this.tid = 1 + randint(10000) /* 1 + randint() */
    }

    get_mutable(obj) {
        /* Return an object's mutable copy that's unique transaction-wide: multiple calls return the same copy,
           so consecutive modifications add to rather than replace previous ones. If the object is not yet
           in the staging area, a new mutable copy is created and staged. The object must be loaded, not a newborn.
         */
        let existing = this._edited.get(obj)
        return existing || this.stage(obj._get_mutable())
    }

    stage(obj) {
        /* Add a web object to the transaction. */
        if (this.committed) throw new Error(`cannot add an object to a committed transaction`)
        if (obj.is_newborn()) return this.stage_newborn(obj)

        assert(obj.is_mutable())
        let existing = this._edited.get(obj)
        if (existing && existing !== obj) throw new Error(`a different copy of the same object ${obj} is already staged`)
        this._edited.add(obj)
        return obj
    }

    stage_newborn(obj) {
        if (this.committed) throw new Error(`cannot add an object to a committed transaction`)
        assert(obj.is_newborn())
        if (obj.__provisional_id) this._provisional = Math.max(this._provisional, obj.__provisional_id)
        else obj.__self.__provisional_id = ++this._provisional
        this._created.add(obj)
    }

    async save(objects = null, opts = {}) {
        /* Save pending changes to the database: either all those staged, or the ones in `objects` (can be a single object).
           Any non-staged item in `objects` gets implicitly staged.
         */
        assert(!objects)
        // if (objects && typeof objects === 'object') objects = [objects]
        // if (Array.isArray(objects)) {
        //     for (let obj of objects)        // stage the unstaged objects
        //         if (!this._edited.has(obj) && !this._created.has(obj)) this.stage(obj)
        // }
        // else objects = [...this._edited, ...this._created]

        // print(`tx.save() new:      `, [...this._created].map(String))
        // print(`          modified: `, [...this._edited].map(String))

        if (this._created?.size) await this._save_created(opts)
        if (this._edited?.size) await this._save_edited(opts)
    }

    async _save_created(opts) {
        // new objects must be inserted together due to possible cross-references
        let created = [...this._created]
        let datas = created.map(obj => obj.__data.__getstate__())
        let ids = await this._db_insert(datas, opts)

        // replace provisional IDs with proper IDs in original objects
        ids.map((id, i) => {
            delete created[i].__self.__provisional_id
            created[i].id = id
        })
        this._created.clear()
    }

    async _save_edited(opts) {
        await this._db_update([...this._edited], opts)
        this._edited.clear()
    }

    revert() {
        /* Remove all pending changes from this transaction. */
        this._edited.clear()
        this._created.clear()
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
        return this.save(null, opts)        // transfer all pending changes to the database
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

// export class LightTransaction extends Transaction {
//     /* A transaction without TID that allows non-atomic saving of mutations (save()), but not committing the transaction as a whole.
//        This means the transaction is always open: it can exist for a long time and be reused for new groups of mutations.
//      */
//
//     constructor() { super(true) }
//     commit() { throw new Error(`light transaction cannot be committed`) }
// }

/**********************************************************************************************************************/

export class ClientTransaction extends Transaction {
    /* Client-side transaction object. No TID. No commits. Exists permanently. */

    commit() { throw new Error(`client-side transaction cannot be committed`) }
    capture(...records) {}      // on client, records are saved in Registry and this is enough (no further back-propagation is done)
}

