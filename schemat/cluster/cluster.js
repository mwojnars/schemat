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
        // const mod_url  = await import('node:url')
        // const mod_path = await import('node:path')
        //
        // const __filename = mod_url.fileURLToPath(import.meta.url)       // or: process.argv[1]
        // const __dirname  = mod_path.dirname(__filename) + '/..'
        //
        // const DB_ROOT   = __dirname + '/data'

        let config_filename = './config.yaml'

        let fs = await import('node:fs')
        let yaml = (await import('yaml')).default

        let content = fs.readFileSync(config_filename, 'utf8')
        let config = yaml.parse(content)

        print('config:', config)


        const DB_ROOT   = './data'

        const ring_specs = [
            {file: DB_ROOT + '/db-boot.yaml',    start_id:    0, stop_id:  100, readonly: true},
            {file: DB_ROOT + '/db-base.yaml',    start_id:  100, stop_id:  200, readonly: true},
            {file: DB_ROOT + '/db-cluster.yaml', start_id:  200, stop_id:  300, readonly: true},
            {file: DB_ROOT + '/db-demo.yaml',    start_id: 1000, stop_id: null, readonly: true},
            // {file: DB_ROOT + '/../../app-demo/data/db-paperity.yaml', start_id: 1000, stop_id: null, readonly: true},

            // {item: 200},       // db-paperity.yaml
            // {item: 205},       // db-demo.yaml
        ]

        let bootstrap_db = Database.create(ring_specs)
        schemat.set_db(bootstrap_db)

        await bootstrap_db.open()
        // await bootstrap_db.insert_self()
    }
}

