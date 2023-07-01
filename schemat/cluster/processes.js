import {print, assert, T} from "../utils.js";
import {Cluster, DB_ROOT} from "./cluster.js";
import {Item} from "../item.js";
import {JSONx} from "../serialize.js";
import {EditData} from "../db/edits.js";
import {DataServer, WebServer} from "./servers.js";
import {Ring} from "../db/db_srv.js";


/**********************************************************************************************************************
 **
 **  PROCESSES
 **
 */

export class SchematProcess {

    start(cmd, opts = {}) {
        assert(this[cmd], `unknown command: ${cmd}`)
        this.cluster = new Cluster()
        return this[cmd](opts)
    }
}

export class WorkerProcess extends SchematProcess {

    async startCluster(boot_db, cluster_iid) {
        let cluster = new Cluster()
        cluster.id = cluster_iid
        cluster.db = boot_db
        await cluster.startup()
        return cluster
    }

    async run({host, port, workers}) {
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

export class AdminProcess extends SchematProcess {
    /* Administrative tasks. A CLI tool for managing a Schemat cluster or node from command line. */

    async _build_({path_db_boot}) {
        /* Generate the core system items anew and save. */
        let {bootstrap} = await import('../boot/bootstrap.js')

        let ring = new Ring({file: path_db_boot || (DB_ROOT + '/db-boot.yaml')})

        await ring.open()
        await ring.erase()

        let registry = await this.cluster.createRegistry()
        return bootstrap(registry, ring)
    }

    async move({id, newid, bottom, ring: ringName}) {
        /* Move an item to a different ring, or change its IID. */

        await this.cluster.startup()

        function convert(id_)   { return (typeof id_ === 'string') ? Number(id_) : id_ }
        // function convert(id_)   { return (typeof id_ === 'string') ? id_.split(':').map(Number) : id_ }

        id = convert(id)
        newid = convert(newid)

        let db = globalThis.registry.db
        let sameID = (id === newid)

        // let [cid, iid] = id
        // let [new_cid, new_iid] = newid
        // let sameID = (cid === new_cid && iid === new_iid)

        // if ((cid === ROOT_ID || new_cid === ROOT_ID) && cid !== new_cid)
        //     throw new Error(`cannot change a category item (CID=${ROOT_ID}) to a non-category (CID=${cid || new_cid}) or back`)

        if (!sameID && await db.select(newid)) throw new Error(`target ID already exists: [${newid}]`)

        // identify the source ring
        let source = await db.findRing({item: id})
        if (source === undefined) throw new Error(`item not found: [${id}]`)
        if (source.readonly) throw new Error(`the ring '${source.name}' containing the [${id}] record is read-only, could not delete the old record after rename`)

        // identify the target ring
        let target = ringName ? await db.findRing({name: ringName}) : bottom ? db.bottom : source

        if (sameID && source === target)
            throw new Error(`trying to move a record [${id}] to the same ring (${source.name}) without change of ID`)

        print(`move: changing item's ID=[${id}] to ID=[${newid}] ...`)

        // load the item from its current ID; save a copy under the new ID, this will propagate to a higher ring if `id` can't be stored in `target`
        let data = await source.select([db], id)
        await target.save([db], null, newid, data)

        if (!sameID) {
            // // update children of a category item: change their CID to `new_iid`
            // if (cid === ROOT_ID && !sameID)
            //     for await (let {id: child_id} of db.scan(iid))
            //         await this.move({id: child_id, newid: [new_iid, child_id[1]]})

            // update references
            let newItem = globalThis.registry.getItem(newid)
            for await (let ref of globalThis.registry.scan()) {           // search for references to `id` in a referrer item, `ref`
                await ref.load()
                ref.data.transform({value: item => item instanceof Item && item.has_id(id) ? newItem : item})
                let dataJson = ref.dumpData()
                if (dataJson !== ref.dataJson) {
                    print(`move: updating reference(s) in item ${ref.id_str}`)
                    await db.update(ref)
                }
            }
        }

        // remove the old item from DB
        try { await source.delete([db], id) }
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

