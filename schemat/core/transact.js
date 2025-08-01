import {print, assert, randint} from "../common/utils.js";
import {Objects} from "../common/structs.js";
import {Catalog} from "../common/catalog.js";
import {WebObject} from "./object.js";

const {DELETED} = WebObject.Status


/**********************************************************************************************************************/

export class Transaction {
    /* Logical transaction. A group of related database mutations that will be pushed together to the DB.
       Does NOT currently provide ACID guarantees of consistency and atomicity.

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
    _provisional = 0            // the last __provisional_id assigned to newborn objects so far

    // captured DB changes after commit & save:
    _updated = []               // array of {id, data} records received from DB after committing the corresponding objects


    get_mutable(obj) {
        /* Return an object's mutable copy that's unique transaction-wide: multiple calls return the same copy,
           so consecutive modifications add to, rather than replace, previous ones. If the object is not yet
           in the staging area, a new mutable copy is created and staged.
         */
        let existing = this._staging.get(obj)
        if (existing === obj) return obj
        if (existing?.__meta.edits.length) return existing
        if (existing) this._discard(existing)       // it is OK to replace an instance without any unsaved edits

        return this.stage(obj._get_mutable())
    }

    stage(obj) {
        /* Add a web object to the transaction. Return `obj`. */
        if (this.committed) throw new Error(`cannot add an object to a committed transaction`)
        if (obj.id && !obj.__meta.edits) throw new Error(`missing edits: ${obj.__content}`)
        return obj.is_newborn() ? this._stage_newborn(obj) : this._stage_edited(obj)
    }

    _stage_newborn(obj) {
        let prov = obj.__provisional_id
        if (prov) {
            let existing = this._staging.get(prov)
            if (existing === obj) return obj
            assert(!existing, `another newborn object staged with the same provisional ID (${prov})`)
            this._provisional = Math.min(this._provisional, prov)
        }
        else obj.__self.__provisional_id = --this._provisional
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

    has(obj)        { return this._staging.has(obj) }
    has_exact(obj)  { return this._staging.has_exact(obj) }

    _pending() {
        /* Array of objects from _staging that actually have any modifications in them to be saved. */
        return [...this._staging].filter(obj =>
            (obj.__provisional_id && obj.__status !== DELETED) ||
            (obj.id && obj.__status === DELETED) ||
            (obj.id && obj.__meta.edits.length > 0)
        )
    }

    async save_all(opts) {
        /* Save all pending changes in _staging, plus any other that might have been created while saving.
           If opts.discard = true, all objects from _staging (not only the pending ones) get discarded, so they cannot be mutated later.
         */
        let {discard} = opts
        while (true) {
            let objects = discard ? [...this._staging] : this._pending()
            if (!objects.length) break
            await this.save(opts, objects)
        }
    }

    async save(_opts = {}, objects = null) {
        /* Save changes to the database: either all those staged/pending, or the ones in `objects` (can be a single object).
           If `objects` is missing, save() is equivalent to save_all(): saves all pending changes AND extends to those
           created while saving. Otherwise, only `objects` are saved.

           IMPORTANT:
           It is possible and allowed that while saving changes to DB, the transaction is modified by new mutations
           occurring inside data blocks. For example, new Revision objects may be created while updating a staged object.
           This means that the content of _staging may change in the background during execution of db.submit() below.
           Importantly, there is a barrier between the transaction and the DB: no web objects are passed to db.*() methods,
           and no objects are returned from them, only plain data structures like arrays of IDs or raw data contents.
           Also, the mutated objects are first removed from _staging, so the DB has no access to them and cannot modify them:
           if the DB performs any mutations, they are recorded separately and don't interfere with what is being currently saved.
         */
        let {discard = false, ...opts} = _opts

        if (!this._staging.size) return
        if (!objects) return this.save_all(_opts)
        if (!Array.isArray(objects)) objects = [objects]

        // discard objects that are newborn and marked for deletion at the same time
        objects = objects.filter(obj => {
            if (obj.__provisional_id && obj.__status === DELETED) {
                this._discard(obj)
                return false
            }
            return true
        })

        // check that every object has been staged
        for (let obj of objects)
            if (!this.has_exact(obj)) throw new Error(`object ${obj} was not staged in transaction so it cannot be saved`)

        // objects.forEach(obj => {
        //     if (obj.id && !obj.__meta.edits) {
        //         schemat._print(`Transaction.save() missing edits:`, obj.__content)
        //         obj._print_stack()
        //     }
        // })

        // group objects by operation: to insert, to delete, to update
        let newborn = objects.filter(obj => obj.__provisional_id)
        let deleted = objects.filter(obj => obj.__status === DELETED)
        let edited  = objects.filter(obj => obj.id && obj.__status !== DELETED && obj.__meta.edits.length > 0)
        assert(objects.length >= newborn.length + deleted.length + edited.length)   // some objects may be skipped (zero edits)

        // verify the validity of provisional IDs of all newborn objects
        let provisional = newborn.map(obj => obj.__provisional_id)
        assert(new Set(provisional).size === provisional.length, `provisional IDs are not unique`)

        // unwrap objects so that only plain data structures are passed to DB
        let ins_datas = newborn.map(obj => [obj.__provisional_id, obj.__data.__getstate__()])
        let del_ids   = deleted.map(obj => obj.id)
        let upd_edits = edited.map(obj => [obj.id, [...obj.__meta.edits]])

        // mark objects as obsolete, or prepare them for new incoming mutations during _db_*() calls below
        if (discard) this._discard(...objects)
        else {
            this._discard(...deleted)                               // discard all deleted objects, they should always be invalidated
            edited.forEach(obj => {obj.__meta.edits.length = 0})    // clear pending edits in mutated objects; they can still receive mutations after save()
            newborn.forEach(obj => this._staging.delete(obj))       // drop every newborn from _staging, it will be reinserted later
        }

        let result = await schemat.db.submit(ins_datas, upd_edits, del_ids, opts)
        let {inserted} = result

        if (newborn.length) {
            assert(newborn.length === inserted.length)
            this._update_newborn(newborn, inserted, discard)
        }
        return result
    }

    _update_newborn(newborn, ids, discarded) {
        /* Replace provisional IDs with proper IDs in newborn objects. */
        ids.forEach((id, i) => {
            let obj = newborn[i]
            obj.id = id
            delete obj.__self.__provisional_id
            if (discarded) return

            let other = this._staging.get(obj)
            if (other && other !== obj)     // this object may have been already staged under its proper ID by a concurrent thread
                obj.__meta.obsolete = true
            else if (!other) {              // re-stage the object under its proper ID, as it can still receive mutations in the future
                obj.__meta.edits = []       // `edits` array is uninitialized in newborns
                this._staging.add(obj)
            }
        })
    }

    revert() { return this._clear() }

    _clear() {
        /* Remove all pending changes from this transaction. We cannot revert edits in a mutable instance because
           they were already applied to __data, but we can mark it as obsolete.
         */
        this._discard(...this._staging)
    }

    _discard(...objects) {
        /* Remove `obj` from staging, usually after all mutations have been pushed to DB and the object is replaced with a newer copy. */
        for (let obj of objects) {
            obj.__meta.obsolete = true
            this._staging.delete(obj)
        }
    }

    capture(...records) {
        /* Remember updated records received from the DB, so they can be propagated further back to the originator.
           WARNING: in case of multiple modifications to the same record, the one received most recently will take
                    precedence in the Registry, which may not always be the most recent version of the object.
           // TODO: detect duplicates, restrict the size of `records`
         */
        this._updated.push(...records)
    }
}

/**********************************************************************************************************************/

export class ServerTransaction extends Transaction {
    /* Server-side transaction object. */

    constructor({tid, lite} = {}) {
        /* If `tid` is provided by the caller, this instance is a part of a broader parent transaction that created the TID value. */
        super()
        if (lite) return
        this.tid = tid || (1 + randint(10000)) /* 1 + randint() */
    }

    enter_insert_mode(on_newborn_created /*callback*/) {
        /* Make the transaction run in "insert mode", which means a data block takes over responsibility for all newborns.
           Called by a data block when insertion of new objects starts and their __setup__() is to be called.
           Whenever the __setup__() creates a new object and stages it in transaction, on_newborn_created() is called
           instead of actual staging, so the block can immediately assign a final .id to the object and save it to the DB
           (these objects never receive a __provisional_id, because they don't need it!).
           In this way, all newborns, even the ones created during insert, fall into the same data block and may reference each other.
         */
        assert(!this._on_newborn_created)
        this._on_newborn_created = on_newborn_created
        this._inserted_objects = []
    }

    exit_insert_mode() {
        // mark newly inserted objects as obsolete to prevent their future mutations (they are not staged)
        for (let obj of this._inserted_objects)
            obj.__meta.obsolete = true

        delete this._inserted_objects
        delete this._on_newborn_created
    }

    _stage_newborn(obj) {
        /* Do not stage the object if in "insert mode". */
        if (this._on_newborn_created) {
            this._on_newborn_created(obj)
            return obj
        }
        return super._stage_newborn(obj)
    }

    async flush(opts = {}) {
        /* Save all pending changes to DB and discard all objects, but do not mark this transaction as committed. */
        return this.save_all({...opts, discard: true})
    }

    async commit(opts = {}) {
        /* Save all pending changes to DB and mark this transaction as completed and closed. */
        await this.flush(opts)
        this.committed = true
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

export class LiteTransaction extends ServerTransaction {
    /* A server-side transaction without TID that allows non-atomic save() of mutations, but not committing the transaction as a whole.
       This transaction is always open: it can exist for a long time and be reused for new groups of mutations.
       For these reasons, and to avoid memory leaks or multiplication of the same records over and over again between nodes,
       lite transaction resets the list of records (_updated) on every capture instead of accumulating them.
     */

    constructor()   { super({lite: true}) }
    commit()        { throw new Error(`lite transaction cannot be committed`) }
    dump_tx()       {}
    capture(...recs){ this._updated = recs }
}

/**********************************************************************************************************************/

export class ClientTransaction extends Transaction {
    /* Client-side transaction object. No TID. No commits. Exists permanently. */

    commit() { throw new Error(`client-side transaction cannot be committed`) }
    capture(...records) {}      // on client, records are saved in Registry and this is enough (no further back-propagation is done)
}

