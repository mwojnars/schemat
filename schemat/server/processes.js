import "../common/globals.js"           // global flags: CLIENT, SERVER

import {print, assert, T} from "../common/utils.js";
import {ItemNotFound} from "../common/errors.js";
import {DataServer, WebServer} from "./servers.js";
import {WebObject} from "../core/object.js";
import {ServerSchemat} from "../core/schemat_srv.js";
import {DataRequest} from "../db/data_request.js";
import {Database} from "../db/db.js";
import {Struct} from "../core/catalog.js";


// print NODE_PATH:
// console.log('NODE_PATH:', process.env.NODE_PATH)


/**********************************************************************************************************************/

export class BackendProcess {
    CLI_PREFIX = 'CLI_'

    async run(cmd, opts = {}) {
        /* Boot up Schemat and execute the CLI_cmd() method. Dashes (-) in `cmd` are replaced with underscores (_). */

        opts.config ??= './schemat/config.yaml'
        let config = await this.load_config(opts.config)

        await new ServerSchemat().boot(config.site, () => this._open_bootstrap_db(config))
        // await schemat.db.insert_self()

        if (!cmd) return
        let method = this.CLI_PREFIX + cmd.replace(/-/g, '_')
        assert(this[method], `unknown command: ${cmd}`)

        await this[method](opts)
    }

    async load_config(filename) {
        let fs = await import('node:fs')
        let yaml = (await import('yaml')).default
        let content = fs.readFileSync(filename, 'utf8')
        return yaml.parse(content)
    }

    async _open_bootstrap_db(config) {
        let db = Database.new()
        let rings = config.bootstrap_database.rings
        rings.forEach(ring => { if(ring.readonly === undefined) ring.readonly = true })
        await db.open(rings)
        return db
    }
}

export class MainProcess extends BackendProcess {
    /* Top-level Schemat process running on a given machine. Spawns and manages worker processes:
       web server(s), data server(s), load balancer etc.
     */
    servers         // array of Server instances, each server is a child process

    async CLI_main(opts) { return this.start(opts) }

    async start({host, port, workers}) {
        // node = schemat.get_loaded(this_node_ID)
        // return node.activate()     // start the life-loop and all worker processes (servers)

        // let m = await schemat.import('/$/local/schemat/test/temp1.js')
        // print('loaded:', m)
        // let {WebServer} = await schemat.import('/$/local/schemat/server/servers.js')

        process.on('SIGTERM', () => this.stop())        // listen for TERM signal, e.g. kill
        process.on('SIGINT', () => this.stop())         // listen for INT signal, e.g. Ctrl+C

        print('Starting the server...')
        let web_server = new WebServer({host, port, workers})
        // let data_server = new DataServer(this.cluster)

        this.servers = [web_server]
        return Promise.all(this.servers.map(srv => srv.start()))
    }

    async stop() {
        print('\nReceived kill signal, shutting down gracefully...')
        schemat.is_closing = true
        setTimeout(() => process.exit(0), 10)
        return Promise.all(this.servers.map(srv => srv.stop()))
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
        // TODO: REMOVE. This function is no longer used; all the same things can be done with CLI_reinsert (!)

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
        await db.save_update(req.safe_step(target, 'save', {id: newid, data}))

        if (!sameID) await this._update_references(id, newid)

        // remove the old item from DB
        try { await source.delete(id, req) }
        catch (ex) { print("WARNING:", ex) }

        print('move: done')
    }

    async CLI_reinsert({ids, new: new_id, ring: ring_name}) {
        /* Remove objects from their current rings and reinsert under new IDs into `ring` (if present), or to the top-most ring.
           WARNING: there's no explicit flushing of changes, so they're done at the end, which may lead to inconsistencies
                    when multiple objects are reinserted, esp. when they are system objects (loaded already before reinsert).
                    In such case, it's better to re-run the command for each object separately.
         */

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

        if (new_id && id_list.length > 1) throw new Error('cannot specify a new ID when reinserting multiple objects')

        // reinsert each object
        for (let id of id_list) {
            try { obj = await schemat.get_loaded(id) }
            catch (ex) {
                if (ex instanceof ItemNotFound) {
                    print(`...WARNING: object [${id}] not found, skipping`)
                    continue
                }
            }

            new_id = (await ring.insert(new_id, obj.__json)).id
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
        let transform = (obj => obj?.__id === old_id ? target : undefined)

        for (let ring of schemat.db.rings)
            for await (let record of ring.scan_all()) {                 // search for references to `old_id` in all records
                let {id, data} = record
                data = Struct.transform(data, transform)
                let json = data.dump()
                if (json === record.data_json) continue                 // no changes? don't update the record

                if (ring.readonly)
                    print(`...WARNING: cannot update a reference [${old_id}] > [${new_id}] in item [${id}], the ring is read-only`)
                else {
                    print(`...updating reference(s) in object [${id}]`)
                    await ring.update_full(id, data)
                    // await ring.flush()
                }
            }
    }

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
    //             let new_id = await ring.insert(null, item.__json)
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

