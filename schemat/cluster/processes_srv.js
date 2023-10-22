import path from "path";
import {fileURLToPath} from "url";

import {print, assert, T} from "../utils.js";
import {Cluster, DB_ROOT} from "./cluster.js";
import {Item} from "../item.js";
import {JSONx} from "../serialize.js";
import {EditData} from "../db/edits.js";
import {DataServer, WebServer} from "./servers.js";
import {Ring} from "../db/db_srv.js";
import {SchematProcess} from "../processes.js";
import {ServerRegistry} from "../registry_srv.js";
import {ItemRecord} from "../db/records.js";
import {DataRequest} from "../db/data_request.js";

const __filename = fileURLToPath(import.meta.url)       // or: process.argv[1]
const __dirname  = path.dirname(__filename) + '/..'


/**********************************************************************************************************************/

export class BackendProcess extends SchematProcess {
    CLI_PREFIX = 'CLI_'

    async init() { return this._create_registry(ServerRegistry, __dirname) }

    start(cmd, opts = {}) {
        let method = this.CLI_PREFIX + cmd
        assert(this[method], `unknown command: ${cmd}`)

        this.cluster = new Cluster(this.registry)
        return this[method](opts)
    }
}

export class WorkerProcess extends BackendProcess {

    // async startCluster(boot_db, cluster_iid) {
    //     let cluster = new Cluster()
    //     cluster.id = cluster_iid
    //     cluster.db = boot_db
    //     await cluster.startup()
    //     return cluster
    // }

    async CLI_run({host, port, workers}) {
        await this.cluster.startup()

        // node = registry.getLoaded(this_node_ID)
        // return node.activate()     // start the lifeloop and all worker processes (servers)

        // await this._update_all()
        // await this._reinsert_all()

        let web = new WebServer(this.cluster, {host, port, workers}).start()
        let data = new DataServer(this.cluster).start()
        return Promise.all([web, data])
    }
}

export class AdminProcess extends BackendProcess {
    /* Administrative tasks. A CLI tool for managing a Schemat cluster or node from the command line. */
    static role = 'admin_process'

    async CLI_build({path_db_boot}) {
        /* Generate the core system items anew and save. */
        let {bootstrap} = await import('../boot/bootstrap.js')

        let file = path_db_boot || (DB_ROOT + '/db-boot.yaml')
        let ring = new Ring({file})
        let req  = new DataRequest(this, 'bootstrap')

        await ring.open()
        await ring.erase()

        print(`Starting full RESET of DB, core items will be created anew in: ${file}`)

        return bootstrap(this.registry, ring, req)
    }

    async CLI_move({id, newid, bottom, ring: ringName}) {
        /* Move an item to a different ring, or change its IID. */

        await this.cluster.startup()

        function convert(id_)   { return (typeof id_ === 'string') ? Number(id_) : id_ }
        // function convert(id_)   { return (typeof id_ === 'string') ? id_.split(':').map(Number) : id_ }

        id = convert(id)
        newid = convert(newid)

        let db = this.db
        let sameID = (id === newid)

        // let [cid, iid] = id
        // let [new_cid, new_iid] = newid
        // let sameID = (cid === new_cid && iid === new_iid)

        // if ((cid === ROOT_ID || new_cid === ROOT_ID) && cid !== new_cid)
        //     throw new Error(`cannot change a category item (CID=${ROOT_ID}) to a non-category (CID=${cid || new_cid}) or back`)

        if (!sameID && await db.select(newid)) throw new Error(`target ID already exists: [${newid}]`)

        // identify the source ring
        let source = await db.find_ring({item: id})
        if (source === undefined) throw new Error(`item not found: [${id}]`)
        if (source.readonly) throw new Error(`the ring '${source.name}' containing the [${id}] record is read-only, could not delete the old record after rename`)

        // identify the target ring
        let target = ringName ? await db.find_ring({name: ringName}) : bottom ? db.bottom : source

        if (sameID && source === target)
            throw new Error(`trying to move a record [${id}] to the same ring (${source.name}) without change of ID`)

        print(`move: changing item's ID=[${id}] to ID=[${newid}] ...`)

        // load the item from its current ID; save a copy under the new ID, this will propagate to a higher ring if `id` can't be stored in `target`
        let data = await source.select(id)
        await target.save(newid, data)

        if (!sameID) {
            // // update children of a category item: change their CID to `new_iid`
            // if (cid === ROOT_ID && !sameID)
            //     for await (let {id: child_id} of db.scan(iid))
            //         await this.move({id: child_id, newid: [new_iid, child_id[1]]})

            // update references
            let newItem = globalThis.registry.getItem(newid)
            for await (let ref of globalThis.registry.scan_all()) {           // search for references to `id` in a referrer item, `ref`
                await ref.load()
                let prev_json = ref.record.data_json
                ref.data.transform({value: item => item instanceof Item && item.has_id(id) ? newItem : item})
                let new_json = JSONx.stringify(ref.data)
                if (new_json !== prev_json) {
                    print(`move: updating reference(s) in item ${ref.id_str}`)
                    await db.update(ref)
                }
            }
        }

        // remove the old item from DB
        try { await source.delete(id) }
        catch (ex) {
            if (ex instanceof Ring.ReadOnly) print('WARNING: could not delete the old item as the ring is read-only')
        }

        print('move: done')
    }

    async _update_all() {
        /* Perform "update in place" on every item in the database, for instance, to force conversion of the items
           to a new format. All rings in the DB must be set as writable (!), otherwise the update will write a copy
           of an item in another ring instead of updating in place.
         */
        for await (let item of globalThis.registry.scan_all())
            await this.db.update_full(item)
    }

    async _reinsert_all() {
        /* Re-insert every item so that it receives a new ID. Update references in other items. */
        let db = this.db
        let req = new DataRequest(this, 'reinsert_all')

        for (let ring of db.rings) {
            if (ring.readonly) continue
            let records = await T.arrayFromAsync(ring.scan_all())
            let ids = records.map(rec => rec.id)

            for (const id of ids) {
                // the record might have been modified during this loop - must re-read ("select")
                let data = await ring.process(req.remake_step(null, 'select', id))

                // let item = await globalThis.registry.makeItem(new ItemRecord(id, data))
                let item = await Item.from_record(new ItemRecord(id, data))

                print(`reinserting item [${id}]...`)
                item.id = await ring.insert(req.remake_step(null, 'insert', null, item.dumpData()))

                print(`...new id=[${item.id}]`)
                await this._update_references(id, item)
                await ring.delete(id)
                await ring.data.flush()
            }
        }
    }

    async _update_references(old_id, item) {
        /* Scan all items in the DB and replace references to `old_id` with references to `item`. */
        let db = this.db

        // transform function: checks if a sub-object is an item of ID=old_id and replaces it with `item` if so
        let transform = (it => it instanceof Item && it.id === old_id ? item : it)

        for (let ring of db.rings) {
            for await (const record of ring.scan_all()) {        // search for references to `old_id` in a referrer item, `ref`

                let id = record.id
                let data = JSONx.transform(record.data, transform)
                if (data === record.data) continue          // no changes? don't update the `ref` item

                if (ring.readonly)
                    print(`...WARNING: cannot update a reference [${old_id}] > [${item.id}] in item [${id}], the ring is read-only`)
                else {
                    print(`...updating reference(s) in item [${id}]`)
                    await db.update(id, new EditData(data))
                    await ring.data.flush()
                }
            }
        }
    }
}

