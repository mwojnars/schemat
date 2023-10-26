import path from "path"
import {fileURLToPath} from "url"

import {print, T} from "../utils.js"
import {Item} from "../item.js"
import {ServerDB} from "../db/db_srv.js"


const __filename = fileURLToPath(import.meta.url)       // or: process.argv[1]
const __dirname  = path.dirname(__filename) + '/..'


export const DB_ROOT   = __dirname + '/data'

/**********************************************************************************************************************/

export class Cluster extends Item {
    /* Managing the cluster's infrastructure. */

    db

    // get db() { return this.prop('db') }

    rings = [
        {file: DB_ROOT + '/db-boot.yaml', start_iid:    0, stop_iid:  100, readonly: true},
        // {file: DB_ROOT + '/db-cluster.yaml', start_iid:    0, stop_iid:  100, readonly: false},
        {file: DB_ROOT + '/db-base.yaml', start_iid:  100, stop_iid: 1000, readonly: false},
        {file: __dirname + '/../app-demo/data/db-paperity.yaml', start_iid: 1000, stop_iid: null, readonly: false},
        {file: DB_ROOT + '/db-demo.yaml', start_iid: 1000, stop_iid: null, readonly: false},
        // {item: 1015, name: 'mysql', readonly: true},
    ]

    async startup(rings = this.rings) {
        /* Load the bootstrap database & create the registry, then load this cluster's complete data from DB,
           which should replace the db object with the ultimate one (TODO).
         */

        this.db = new ServerDB()
        // let rings = this.prop('rings')
        return this.db.init_as_cluster_database(rings)

        // // load the cluster's full and ultimate data from the bootstrap DB;
        // // this may override the db property with the ultimate DB object
        // this.id = CLUSTER_IID
        // this.load()
        // registry.setDB(this.prop('db'))
        // await schemat.registry.boot()   // reload `root` and `site`
    }
}

