import fs from 'fs';
import path from "path";
import {fileURLToPath} from "url";

import {print, assert, T} from "../common/utils.js";
import {Cluster, DB_ROOT} from "./cluster.js";
import {Item} from "../item.js";
import {JSONx} from "../serialize.js";
import {EditData} from "../db/edits.js";
import {DataServer, WebServer} from "./servers.js";
import {Ring, ServerDB} from "../db/db_srv.js";
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

        this.cluster = Cluster.create()
        return this[method](opts)
    }
}

export class WorkerProcess extends BackendProcess {

    _server         // the express server to be closed upon shutdown

    // async startCluster(boot_db, cluster_id) {
    //     let cluster = new Cluster()
    //     cluster._id_ = cluster_id
    //     cluster.db = boot_db
    //     await cluster.startup()
    //     return cluster
    // }

    async shutdown() {
        if (this._server) {
            print('\nReceived kill signal, shutting down gracefully...')
            this._server.close(() => { print('Server closed') })
        }
        registry.is_closing = true
        setTimeout(() => process.exit(0), 10)
    }

    async CLI_run({host, port, workers}) {
        await this.cluster.startup()

        // node = registry.getLoaded(this_node_ID)
        // return node.activate()     // start the lifeloop and all worker processes (servers)

        // await this._update_all()
        // await this._reinsert_all()

        let web = new WebServer(this.cluster, {host, port, workers})
        this._server = await web.start()

        process.on('SIGTERM', () => this.shutdown())        // listen for TERM signal, e.g. kill
        process.on('SIGINT', () => this.shutdown())         // listen for INT signal, e.g. Ctrl+C

        // let web = new WebServer(this.cluster, {host, port, workers}).start()
        // let data = new DataServer(this.cluster).start()
        // return Promise.all([web, data])
    }
}

export class AdminProcess extends BackendProcess {
    /* Administrative tasks. A CLI tool for managing a Schemat cluster or node from the command line. */
    static role = 'admin_process'

    async CLI_build({path_db_boot}) {
        /* Generate the core system items anew and save. */

        let file = path_db_boot || (DB_ROOT + '/db-boot.yaml')

        // remove `file` if it exists
        try { fs.unlinkSync(file) } catch(ex) {}

        await this.cluster.startup([{file}])
        let db = this.cluster.db

        print(`Starting full RESET of DB, core items will be created anew in: ${file}`)

        let {bootstrap} = await import('../boot/bootstrap.js')
        await bootstrap(db)
        registry.is_closing = true
    }

    async CLI_move({id, newid, bottom, ring: ring_name}) {
        /* Move an item to a different ring, or change its IID. */

        await this.cluster.startup()

        id = Number(id)
        newid = Number(newid)

        let db = this.db
        let sameID = (id === newid)
        let req = new DataRequest(this, 'CLI_move', {id})

        // let [cid, iid] = id
        // let [new_cid, new_iid] = newid
        // let sameID = (cid === new_cid && iid === new_iid)

        // if ((cid === ROOT_ID || new_cid === ROOT_ID) && cid !== new_cid)
        //     throw new Error(`cannot change a category item (CID=${ROOT_ID}) to a non-category (CID=${cid || new_cid}) or back`)

        if (!sameID && await db.select(req.safe_step(null, 'check-not-exists', {id: newid})))
            throw new Error(`target ID already exists: [${newid}]`)

        // identify the source ring
        let source = await db.find_ring({id})
        if (source === undefined) throw new Error(`item not found: [${id}]`)
        if (source.readonly) throw new Error(`the ring '${source.name}' containing the [${id}] record is read-only, could not delete the old record after rename`)

        // identify the target ring
        let target = ring_name ? await db.find_ring({name: ring_name}) : bottom ? db.bottom : source

        if (sameID && source === target)
            throw new Error(`trying to move a record [${id}] to the same ring (${source.name}) without change of ID`)

        print(`move: changing item's ID=[${id}] to ID=[${newid}] ...`)

        // load the item from its current ID; save a copy under the new ID, this will propagate to a higher ring if `id` can't be stored in `target`
        let data = await source.select(id, req)
        await db.save(req.safe_step(target, 'save', {id: newid, data}))

        if (!sameID) {
            // // update children of a category item: change their CID to `new_iid`
            // if (cid === ROOT_ID && !sameID)
            //     for await (let {id: child_id} of db.scan(iid))
            //         await this.move({id: child_id, newid: [new_iid, child_id[1]]})

            // update references
            let newItem = globalThis.registry.getItem(newid)
            for await (let ref of globalThis.registry.scan_all()) {           // search for references to `id` in a referrer item, `ref`
                await ref.load()
                let prev_json = ref._record_.data_json
                ref._data_.transform({value: item => (item._id_ !== undefined && item._id_ === id) ? newItem : item})
                let new_json = JSONx.stringify(ref._data_)
                if (new_json !== prev_json) {
                    print(`move: updating reference(s) in ID=${ref._id_}`)
                    await db.update(ref)
                }
            }
        }

        // remove the old item from DB
        try {
            await source.delete(id, req)
        }
        catch (ex) { print("WARNING:", ex) }

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

    async CLI_reinsert({id, ring: ring_name}) {
        /* Move an item to a different ring, or change its IID. */

        await this.cluster.startup()

        id = Number(id)
        let db = this.db
        let item = await registry.getLoaded(id)
        let ring = await db.find_ring({name: ring_name})

        await db.delete(id)
        let newid = await ring.insert(null, item.dumpData())
        print(`reinserted item [${id}] as [${newid}]`)
    }

    async _reinsert_all() {
        /* Re-insert every item to the same ring so that it receives a new ID. Update references in other items. */
        let db = this.db

        for (let ring of db.rings) {
            if (ring.readonly) continue
            let records = await T.arrayFromAsync(ring.scan_all())
            let ids = records.map(rec => rec.id)

            for (const id of ids) {
                // the record might have been modified during this loop - must re-read ("select")
                let data = await ring.select(id)
                let item = await Item.from_data(id, data)

                print(`reinserting item [${id}]...`)
                let new_id = await ring.insert(null, item.dumpData())
                item = await Item.from_data(new_id, data)

                print(`...new id=[${new_id}]`)
                await this._update_references(id, item)
                await ring.delete(id)
                // await ring.flush()
            }
        }
    }

    async _update_references(old_id, item) {
        /* Scan all items in the DB and replace references to `old_id` with references to `item`. */
        let db = this.db

        // transform function: checks if a sub-object is an item of ID=old_id and replaces it with `item` if so
        let transform = (it => it._id_ === old_id ? item : it)

        for (let ring of db.rings) {
            for await (const record of ring.scan_all()) {        // search for references to `old_id` in a referrer item, `ref`

                let id = record.id
                let data = JSONx.transform(record.data, transform)
                if (data === record.data) continue          // no changes? don't update the `ref` item

                if (ring.readonly)
                    print(`...WARNING: cannot update a reference [${old_id}] > [${item._id_}] in item [${id}], the ring is read-only`)
                else {
                    print(`...updating reference(s) in item [${id}]`)
                    await db.update(id, new EditData(data))
                    // await ring.flush()
                }
            }
        }
    }
}

