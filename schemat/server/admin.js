import fs from 'node:fs'
import yaml from 'yaml'

import {assert, print, sleep} from "../common/utils.js";
import {ObjectNotFound} from "../common/errors.js";
import {WebObject} from "../core/object.js";
import {Struct} from "../core/catalog.js";
import {boot_schemat} from "./kernel.js";


/**********************************************************************************************************************/

export class Admin {
    /* Boot up Schemat and execute the <mode>__<command>() method to perform an administrative task.
       Dashes (-) in command name are replaced with underscores (_).
     */

    // "normal" mode: Schemat is fully booted with the final DB initialized
    // "rescue" mode: Schemat stays in the booting phase, only the bootstrap database is created, no final DB
    // "telnet" mode: no Schemat object created, the handler connects to the cluster leader via low-level TCP
    MODES = ['telnet', 'rescue', 'normal']

    static async run(...args) { return new this()._run(...args) }

    async _run(command, opts = {}) {
        /* Boot up Schemat and execute the cmd_XXX() method. Dashes (-) in command name are replaced with underscores (_). */
        if (!command) return
        let cmd = command.replace(/-/g, '_')
        let mode, fun

        // find the method and mode that together match the command name with MODE__ prefix, e.g. rescue__create_cluster
        for (let _mode of this.MODES) {
            let method = `${_mode}__${cmd}`
            if (this[method]) {
                mode = _mode
                fun = this[method]
                break
            }
        }
        assert(fun, `unknown command: ${command}`)

        // in "telnet" mode, the Schemat object is not created at all
        if (mode === 'telnet') return fun.call(this, opts)

        await boot_schemat(opts, async () => {
            // in "rescue" mode, only the bootstrap database is created; Schemat stays in booting phase; no final DB
            if (mode === 'normal') await schemat._boot_done()

            await fun.call(this, opts)
            process.exit(0)
        })
    }

    async rescue__create_cluster(opts) {
        /* Create a new ring (ring-cluster) and cluster-related objects in it (nodes, database, etc.)
           according to cluster description read from a manifest file.
         */
        // print(`opts:`, opts)
        let {manifest_file} = opts
        let manifest = yaml.parse(fs.readFileSync(manifest_file, 'utf8'))
        let {cluster, ring} = manifest

        print(`manifest:`)
        print(manifest)

        let cluster_tag = cluster.file_tag || cluster.name || 'nodes'
        let cluster_path = `cluster/${cluster_tag}`
        let node_path = `${cluster_path}/node`          // to be renamed later

        let ring_tag = ring.file_tag || ring.name || 'ring-cluster'
        let ring_path = `${node_path}/${ring_tag}`      // the file name is incomplete

        let db = schemat.db         // boot database to be extended with a new ring
        db.add_ring(ring)
    }

    async normal__reinsert({ids, new: new_id, ring: ring_name}) {
        /* Remove objects from their current rings and reinsert under new IDs into `ring` (if present), or to the top-most ring.
           WARNING: there's no explicit flushing of changes, so they're done at the end, which may lead to inconsistencies
                    when multiple objects are reinserted, esp. when they are system objects (loaded already before reinsert).
                    In such case, it's better to re-run the command for each object separately.
         */

        ids = String(ids)
        print(`\nreinserting object(s) [${ids}] ...`)

        let id_list = []
        let db = schemat.db
        let ring = ring_name ? db.get_ring(ring_name) : db.top_ring
        let obj

        // parse the list of `ids`, which is a comma-separated list of integers or "X-Y" value ranges
        for (let id of ids.split(','))
            if (id.includes('-')) {
                let [start, stop] = id.split('-')
                start = Number(start)
                stop = Number(stop)
                for (let i = start; i <= stop; i++) id_list.push(i)
            }
            else id_list.push(Number(id))

        if (new_id && id_list.length > 1) throw new Error('cannot specify a new ID when reinserting multiple objects')

        // reinsert each object
        for (let id of id_list) {
            try { obj = await schemat.get_loaded(id) }
            catch (ex) {
                if (ex instanceof ObjectNotFound) {
                    print(`...WARNING: object [${id}] not found, skipping`)
                    continue
                }
            }

            let insert = new_id ? ring.insert_at(new_id, obj.__json) : ring.insert(obj.__json)
            new_id = (await insert).id

            await ring.flush()
            await this._update_references(id, new_id)
            await db.delete(id)

            print(`...reinserted object [${id}] as [${new_id}]`)
            new_id = undefined
        }
        print()
    }

    async _update_references(old_id, new_id) {
        /* Scan all items in the DB and replace references to `old_id` with references to `new_id`. */
        if (old_id === new_id) return
        let target = WebObject.stub(new_id)

        // transform function: checks if a sub-object is an item of ID=old_id and replaces it with new `item` if so
        let transform = (obj => obj?.id === old_id ? target : undefined)

        for (let ring of schemat.db.rings)
            for await (let {id, data} of ring.data_sequence.scan_objects()) {       // search for references to `old_id` in all records
                let new_data = Struct.transform(data, transform)
                if (new_data.dump() === data.dump()) continue       // no changes? don't update the record

                if (ring.readonly)
                    print(`...WARNING: cannot update a reference [${old_id}] > [${new_id}] in item [${id}], the ring is read-only`)
                else {
                    print(`...updating reference(s) in object [${id}]`)
                    await ring.update_full(id, new_data)
                    // await ring.flush()
                }
            }
    }


    // async normal__move({id, newid, bottom, ring: ring_name}) {
    //     /* Move an item to a different ring, or change its ID. */
    //     // TODO: REMOVE. This function is no longer used; all the same things can be done with cmd_reinsert (!)
    //
    //     id = Number(id)
    //     newid = Number(newid)
    //
    //     let db = schemat.db
    //     let sameID = (id === newid)
    //     let req = new DataRequest(this, 'cmd_move', {id})
    //
    //     if (!sameID && await db.select(req.safe_step(null, 'check-not-exists', {id: newid})))
    //         throw new Error(`target ID already exists: [${newid}]`)
    //
    //     // identify the source ring
    //     let source = await db.find_ring_containing(id)
    //     if (source === undefined) throw new Error(`item not found: [${id}]`)
    //     if (source.readonly) throw new Error(`the ring '${source.name}' containing the [${id}] record is read-only, could not delete the old record after rename`)
    //
    //     // identify the target ring
    //     let target = ring_name ? await db.get_ring(ring_name) : bottom ? db.bottom_ring : source
    //
    //     if (sameID && source === target)
    //         throw new Error(`trying to move a record [${id}] to the same ring (${source.name}) without change of ID`)
    //
    //     print(`move: changing item's ID=[${id}] to ID=[${newid}] ...`)
    //
    //     // load the item from its current ID; save a copy under the new ID, this will propagate to a higher ring if `id` can't be stored in `target`
    //     let data = await source.select(id, req)
    //     await db.save_update(req.safe_step(target, 'upsave', {id: newid, data}))
    //
    //     if (!sameID) await this._update_references(id, newid)
    //
    //     // remove the old item from DB
    //     try { await source.delete(id, req) }
    //     catch (ex) { print("WARNING:", ex) }
    //
    //     print('move: done')
    // }
    //
    // async _update_all() {
    //     /* Perform "update in place" on every item in the database, for instance, to force conversion of the items
    //        to a new format. All rings in the DB must be set as writable (!), otherwise the update will write a copy
    //        of an item in another ring instead of updating in place.
    //      */
    //     for await (let item of schemat._scan_all())
    //         await schemat.db.update_full(item)
    // }
    //
    // async _reinsert_all() {
    //     /* Re-insert every item to the same ring so that it receives a new ID. Update references in other items. */
    //     let db = schemat.db
    //
    //     for (let ring of db.rings) {
    //         if (ring.readonly) continue
    //         let records = await T.arrayFromAsync(ring.scan_all())
    //         let ids = records.map(rec => rec.id)
    //
    //         for (const id of ids) {
    //             // the record might have been modified during this loop - must re-read ("select")
    //             let data = await ring.select(id)
    //             let item = await WebObject.from_data(id, data)
    //
    //             print(`reinserting item [${id}]...`)
    //             let new_id = await ring.insert(item.__json)
    //             // item = await WebObject.from_data(new_id, data)
    //
    //             print(`...new id=[${new_id}]`)
    //             await this._update_references(id, new_id)
    //             await ring.delete(id)
    //             // await ring.flush()
    //         }
    //     }
    // }
}

