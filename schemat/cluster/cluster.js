import path from "path"
import {fileURLToPath} from "url"

import {print, T} from "../utils.js"
import {Item} from "../item.js"
import {Ring, ServerDB} from "../db/db_srv.js"
import {ServerRegistry} from "../registry_srv.js"
import {DataServer, WebServer} from "./servers.js"


const __filename = fileURLToPath(import.meta.url)       // or: process.argv[1]
const __dirname  = path.dirname(__filename) + '/..'


const DB_ROOT   = __dirname + '/data'

/**********************************************************************************************************************/

export class Cluster extends Item {
    /* A computation node running processes for:
       - processing external web requests
       - internal data handling (storage & access)
     */

    db

    constructor() {
        super(null /*registry*/)        // registry is set later, as its creation must be coupled with DB creation
    }

    async startup() {
        /* Load the bootstrap database & create the registry, then load this cluster's complete data from DB,
           which should replace the db object with the ultimate one (TODO).
         */

        let rings = [
            {file: DB_ROOT + '/db-boot.yaml', start_iid:    0, stop_iid:  100, readonly: true},
            // {file: DB_ROOT + '/db-cluster.yaml', start_iid:    0, stop_iid:  100, readonly: false},
            {file: DB_ROOT + '/db-base.yaml', start_iid:  100, stop_iid: 1000, readonly: false},
            {file: __dirname + '/../app-demo/data/db-paperity.yaml', start_iid: 1000, stop_iid: null, readonly: false},
            {file: DB_ROOT + '/db-demo.yaml', start_iid: 1000, stop_iid: null, readonly: false},
            {item: 1015, name: 'mysql', readonly: true},
        ]

        let db = this.db = new ServerDB()
        let registry = await this.createRegistry(db)

        for (const spec of rings) {
            let ring = new Ring(spec)
            await ring.open()
            db.append(ring)
            await registry.boot()   // reload `root` and `site` to have the most relevant objects after a next ring is added
        }

        // // load the cluster's full and ultimate data from the bootstrap DB;
        // // this may override the db property with the ultimate DB object
        // this.id = CLUSTER_IID
        // this.load()
        // registry.setDB(this.prop('db'))
        // await registry.boot()   // reload `root` and `site`
    }

    async createRegistry(db = null) {
        let registry = this.registry = await ServerRegistry.createGlobal(db, __dirname)
        registry.cluster = this
        return registry
    }

    async run({host, port, workers}) {
        await this.startup()

        // node = registry.getLoaded(this_node_ID)
        // return node.activate()     // start the lifeloop and all worker processes (servers)

        // await this._update_all()
        // await this._reinsert_all()

        let web = new WebServer(this, {host, port, workers}).start()
        let data = new DataServer(this).start()
        return Promise.all([web, data])
    }


    async _build_({path_db_boot}) {
        /* Generate the core system items anew and save. */
        let {bootstrap} = await import('../boot/bootstrap.js')

        let ring = new Ring({file: path_db_boot || (DB_ROOT + '/db-boot.yaml')})

        await ring.open()
        await ring.erase()

        let registry = await this.createRegistry()
        return bootstrap(registry, ring)
    }

    async move({id, newid, bottom, ring: ringName}) {
        /* Move an item to a different ring, or change its IID. */

        await this.startup()

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

}

