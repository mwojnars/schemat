import {print, T} from "../common/utils.js"
import {Item} from "../item.js"
import {Ring, Database} from "../db/db.js"
import {DataRequest} from "../db/data_request.js";


/**********************************************************************************************************************/

export class Cluster { //extends Item {
    /* Managing the cluster's infrastructure. */

    // db  (property)

    async startup() {
        /* Load the bootstrap database & create the registry, then load this cluster's complete data from DB,
           which should replace the db object with the ultimate one (TODO).
         */
        const mod_url  = await import('node:url')
        const mod_path = await import('node:path')

        const __filename = mod_url.fileURLToPath(import.meta.url)       // or: process.argv[1]
        const __dirname  = mod_path.dirname(__filename) + '/..'

        const DB_ROOT   = __dirname + '/data'

        // const cluster_ring_spec =
        //     {file: DB_ROOT + '/db-cluster.yaml', start_id: 200, stop_id: 300}

        const ring_specs = [
            {file: DB_ROOT + '/db-boot.yaml', start_id:    0, stop_id:  100, readonly: false},
            {file: DB_ROOT + '/db-base.yaml', start_id:  100, stop_id: 1000, readonly: true},
            // {file: DB_ROOT + '/db-cluster.yaml', start_id: 200, stop_id: 300, readonly: true},
            {file: DB_ROOT + '/../../app-demo/data/db-paperity.yaml', start_id: 1000, stop_id: null, readonly: false},
            {file: DB_ROOT + '/db-demo.yaml', start_id: 1000, stop_id: null, readonly: false},

            // {item: 200},       // db-paperity.yaml
            // {item: 205},       // db-demo.yaml

            // {item: 1015, name: 'mysql', readonly: true},
        ]

        // let req = new DataRequest(this, 'startup')
        //
        // let cluster_ring_spec = this.constructor.cluster_ring_spec
        // try { fs.unlinkSync(cluster_ring_spec.file) } catch(ex) {}
        //
        // let cluster_ring = Ring.create(cluster_ring_spec)  //new Ring(cluster_ring_spec)
        // await cluster_ring.open(req)

        let bootstrap_db = Database.create(ring_specs)
        schemat.set_db(bootstrap_db)

        await bootstrap_db.open()
        // await bootstrap_db.insert_self()

        // this.db = schemat.site.database         // the ultimate database

        // // load the cluster's full and ultimate data from the bootstrap DB;
        // // this may override the db property with the ultimate DB object
        // this._id_ = CLUSTER_ID
        // this.load()
        // schemat.setDB(this.prop('db'))
        // await schemat.boot()   // reload `root_category` and `site`
    }
}

