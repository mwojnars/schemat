import path from "path"
import {fileURLToPath} from "url"

import {print, T} from "../common/utils.js"
import {Item} from "../item.js"
import {Ring, Database} from "../db/db.js"
import {DataRequest} from "../db/data_request.js";
import fs from "fs";


const __filename = fileURLToPath(import.meta.url)       // or: process.argv[1]
const __dirname  = path.dirname(__filename) + '/..'


export const DB_ROOT   = __dirname + '/data'

/**********************************************************************************************************************/

export class Cluster { //extends Item {
    /* Managing the cluster's infrastructure. */

    db

    // get db() { return this.prop('db') }

    static cluster_ring_spec =
        {file: DB_ROOT + '/db-cluster.yaml', start_id: 200, stop_id: 300}

    static ring_specs = [
        {file: DB_ROOT + '/db-boot.yaml', start_id:    0, stop_id:  100, readonly: false},
        {file: DB_ROOT + '/db-base.yaml', start_id:  100, stop_id: 1000, readonly: false},
        Cluster.cluster_ring_spec,
        {item: 200, readonly: false},       // db-paperity.yaml
        {item: 205, readonly: false},       // db-demo.yaml

        // {file: __dirname + '/../app-demo/data/db-paperity.yaml', start_id: 1000, stop_id: null, readonly: false},
        // {file: DB_ROOT + '/db-demo.yaml', start_id: 1000, stop_id: null, readonly: false},

        // {item: 1015, name: 'mysql', readonly: true},
    ]

    async startup(rings = this.constructor.ring_specs) {
        /* Load the bootstrap database & create the registry, then load this cluster's complete data from DB,
           which should replace the db object with the ultimate one (TODO).
         */

        // let req = new DataRequest(this, 'startup')
        //
        // let cluster_ring_spec = this.constructor.cluster_ring_spec
        // try { fs.unlinkSync(cluster_ring_spec.file) } catch(ex) {}
        //
        // let cluster_ring = Ring.create(cluster_ring_spec)  //new Ring(cluster_ring_spec)
        // await cluster_ring.open(req)

        let bootstrap_db = this.db = Database.create(rings)
        await bootstrap_db.open()
        // await bootstrap_db.insert_self()

        // this.db = registry.site.database         // the ultimate database

        // // load the cluster's full and ultimate data from the bootstrap DB;
        // // this may override the db property with the ultimate DB object
        // this._id_ = CLUSTER_ID
        // this.load()
        // registry.setDB(this.prop('db'))
        // await registry.boot()   // reload `root` and `site`
    }
}

