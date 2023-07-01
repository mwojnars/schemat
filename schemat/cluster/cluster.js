import path from "path"
import {fileURLToPath} from "url"

import {print, T} from "../utils.js"
import {Item} from "../item.js"
import {Ring, ServerDB} from "../db/db_srv.js"
import {ServerRegistry} from "../registry_srv.js"


const __filename = fileURLToPath(import.meta.url)       // or: process.argv[1]
const __dirname  = path.dirname(__filename) + '/..'


export const DB_ROOT   = __dirname + '/data'

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
}

