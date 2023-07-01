import {Cluster} from "./cluster.js";
import {print, T} from "../utils.js";
import {Item} from "../item.js";
import {JSONx} from "../serialize.js";
import {EditData} from "../db/edits.js";


/**********************************************************************************************************************
 **
 **  PROCESSES
 **
 */

export class SchematProcess {}

export class WorkerProcess extends SchematProcess {

    async startCluster(boot_db, cluster_iid) {
        let cluster = new Cluster()
        cluster.id = cluster_iid
        cluster.db = boot_db
        await cluster.startup()
        return cluster
    }
}

export class AdminProcess extends SchematProcess {
    /* A CLI tool for managing a Schemat cluster or node. */

    async _update_all() {
        /* Perform "update in place" on every item in the database, for instance, to force conversion of the items
           to a new format. All rings in the DB must be set as writable (!), otherwise the update will write a copy
           of an item in another ring instead of updating in place.
         */
        for await (let item of globalThis.registry.scan())
            await globalThis.registry.db.update_full(item)
    }

    async _reinsert_all() {
        /* Re-insert every item so that it receives a new ID. Update references in other items. */
        let db = globalThis.registry.db
        for (let ring of db.rings) {
            if (ring.readonly) continue
            let records = await T.arrayFromAsync(ring.scan())
            let ids = records.map(rec => rec.id)

            for (const id of ids) {
                let data = await ring.select([db], id)          // the record might have been modified during this loop - must re-read
                let item = await globalThis.registry.itemFromRecord({id: id, data})
                print(`reinserting item [${id}]...`)
                item.id = undefined
                await ring.insert([db], item)
                print(`...new id=[${item.id}]`)
                await this._update_references(id, item)
                await ring.delete([db], id)
                await ring.block._flush()
            }
        }
    }

    async _update_references(old_id, item) {
        /* Scan all items in the DB and replace references to `old_id` with references to `item`. */
        let db = globalThis.registry.db

        // transform function: checks if a sub-object is an item of ID=old_id and replaces it with `item` if so
        let transform = (it => it instanceof Item && it.id === old_id ? item : it)

        for (let ring of db.rings) {
            for await (const record of ring.scan()) {        // search for references to `old_id` in a referrer item, `ref`

                let id = record.id
                let data = JSONx.transform(record.data, transform)
                if (data === record.data) continue          // no changes? don't update the `ref` item

                if (ring.readonly)
                    print(`...WARNING: cannot update a reference [${old_id}] > [${item.id}] in item [${id}], the ring is read-only`)
                else {
                    print(`...updating reference(s) in item [${id}]`)
                    await db.update(id, new EditData(data))
                    await ring.block._flush()
                }
            }
        }
    }
}

