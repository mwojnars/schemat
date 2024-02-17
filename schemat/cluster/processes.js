import {print, assert, T} from "../common/utils.js";
import {ItemNotFound} from "../common/errors.js";
import {Item} from "../item.js";
import {JSONx} from "../serialize.js";
import {ServerSchemat} from "../schemat_srv.js";
import {DataRequest} from "../db/data_request.js";
import {DataServer, WebServer} from "./servers.js";
import {Database} from "../db/db.js";


/**********************************************************************************************************************/

export class BackendProcess {
    CLI_PREFIX = 'CLI_'

    async start(cmd, opts = {}) {
        const mod_url  = await import('node:url')
        const mod_path = await import('node:path')

        const __filename = mod_url.fileURLToPath(import.meta.url)       // or: process.argv[1]
        const __dirname  = mod_path.dirname(mod_path.dirname(__filename))

        await ServerSchemat.create_global(__dirname)

        let method = this.CLI_PREFIX + cmd
        assert(this[method], `unknown command: ${cmd}`)

        await this.boot_db()

        return this[method](opts)
    }

    async boot_db(config_file = './config.yaml') {
        /* Create bootstrap database and load the Site object from it. */

        let fs = await import('node:fs')
        let yaml = (await import('yaml')).default

        let content = fs.readFileSync(config_file, 'utf8')
        let config = yaml.parse(content)
        let rings = config.bootstrap_database.rings

        rings.forEach(ring => { if(ring.readonly === undefined) ring.readonly = true })

        let bootstrap_db = Database.create(rings)
        schemat.set_db(bootstrap_db)

        await bootstrap_db.open()
        await schemat.boot()                                // load `site` together with the ultimate database
        // await bootstrap_db.insert_self()
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
        schemat.is_closing = true
        setTimeout(() => process.exit(0), 10)
    }

    async CLI_run({host, port, workers}) {

        // node = schemat.get_loaded(this_node_ID)
        // return node.activate()     // start the lifeloop and all worker processes (servers)

        // await this._update_all()
        // await this._reinsert_all()

        let web = new WebServer({host, port, workers})
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

    // async CLI_build({path_db_boot}) {
    //     /* Generate the core system items anew and save. */
    //
    //     let file = path_db_boot || (DB_ROOT + '/db-boot.yaml')
    //
    //     // remove `file` if it exists
    //     try { fs.unlinkSync(file) } catch(ex) {}
    //
    //     await this.cluster.startup([{file}])
    //     let db = this.cluster.db
    //
    //     print(`Starting full RESET of DB, core items will be created anew in: ${file}`)
    //
    //     let {bootstrap} = await import('../boot/bootstrap.js')
    //     await bootstrap(db)
    //     schemat.is_closing = true
    // }

    async CLI_move({id, newid, bottom, ring: ring_name}) {
        /* Move an item to a different ring, or change its ID. */

        id = Number(id)
        newid = Number(newid)

        let db = schemat.db
        let sameID = (id === newid)
        let req = new DataRequest(this, 'CLI_move', {id})

        if (!sameID && await db.select(req.safe_step(null, 'check-not-exists', {id: newid})))
            throw new Error(`target ID already exists: [${newid}]`)

        // identify the source ring
        let source = await db.find_ring({id})
        if (source === undefined) throw new Error(`item not found: [${id}]`)
        if (source.readonly) throw new Error(`the ring '${source.name}' containing the [${id}] record is read-only, could not delete the old record after rename`)

        // identify the target ring
        let target = ring_name ? await db.find_ring({name: ring_name}) : bottom ? db.bottom_ring : source

        if (sameID && source === target)
            throw new Error(`trying to move a record [${id}] to the same ring (${source.name}) without change of ID`)

        print(`move: changing item's ID=[${id}] to ID=[${newid}] ...`)

        // load the item from its current ID; save a copy under the new ID, this will propagate to a higher ring if `id` can't be stored in `target`
        let data = await source.select(id, req)
        await db.save(req.safe_step(target, 'save', {id: newid, data}))

        if (!sameID) await this._update_references(id, newid)

        // remove the old item from DB
        try { await source.delete(id, req) }
        catch (ex) { print("WARNING:", ex) }

        print('move: done')
    }

    async CLI_reinsert({ids, ring: ring_name}) {
        /* Remove objects from their current rings and reinsert under new IDs into `ring` (if present), or to the top-most ring. */

        ids = String(ids)
        print(`\nreinserting object(s) [${ids}] ...`)

        let id_list = []
        let db = schemat.db
        let ring = ring_name ? await db.find_ring({name: ring_name}) : db.top_ring
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

        // reinsert each object
        for (let id of id_list) {
            try { obj = await schemat.get_loaded(id) }
            catch (ex) {
                if (ex instanceof ItemNotFound) {
                    print(`...WARNING: object [${id}] not found, skipping`)
                    continue
                }
            }

            let new_id = await ring.insert(null, obj.dump_data())
            await db.delete(id)
            await this._update_references(id, new_id)

            print(`...reinserted object [${id}] as [${new_id}]`)
        }
        print()
    }

    async _update_references(old_id, new_id) {
        /* Scan all items in the DB and replace references to `old_id` with references to `item`. */
        if (old_id === new_id) return
        let item = Item.create_stub(new_id)

        // transform function: checks if a sub-object is an item of ID=old_id and replaces it with new `item` if so
        let transform = (it => it?._id_ === old_id ? item : it)

        for (let ring of schemat.db.rings) {
            for await (const record of ring.scan_all()) {               // search for references to `old_id` in all records
                let id = record.id
                let json = record.data_json
                let data = JSONx.transform(json, transform)             // new json data
                if (data === json) continue                             // no changes? don't update the record

                if (ring.readonly)
                    print(`...WARNING: cannot update a reference [${old_id}] > [${new_id}] in item [${id}], the ring is read-only`)
                else {
                    print(`...updating reference(s) in object [${id}]`)
                    await ring.update(id, data)
                    // await ring.flush()
                }
            }
        }
    }

    async _update_all() {
        /* Perform "update in place" on every item in the database, for instance, to force conversion of the items
           to a new format. All rings in the DB must be set as writable (!), otherwise the update will write a copy
           of an item in another ring instead of updating in place.
         */
        for await (let item of schemat.scan_all())
            await schemat.db.update_full(item)
    }

    async _reinsert_all() {
        /* Re-insert every item to the same ring so that it receives a new ID. Update references in other items. */
        let db = schemat.db

        for (let ring of db.rings) {
            if (ring.readonly) continue
            let records = await T.arrayFromAsync(ring.scan_all())
            let ids = records.map(rec => rec.id)

            for (const id of ids) {
                // the record might have been modified during this loop - must re-read ("select")
                let data = await ring.select(id)
                let item = await Item.from_data(id, data)

                print(`reinserting item [${id}]...`)
                let new_id = await ring.insert(null, item.dump_data())
                // item = await Item.from_data(new_id, data)

                print(`...new id=[${new_id}]`)
                await this._update_references(id, new_id)
                await ring.delete(id)
                // await ring.flush()
            }
        }
    }
}

