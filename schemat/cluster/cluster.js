import {print, T} from "../common/utils.js"
import {Database} from "../db/db.js"


/**********************************************************************************************************************/

export class Cluster { //extends Item {
    /* Managing the cluster's infrastructure. */

    async startup() {
        /* Load the bootstrap database & create the registry, then load this cluster's complete data from DB,
           which should replace the db object with the ultimate one (TODO).
         */
        let filename = './config.yaml'

        let fs = await import('node:fs')
        let yaml = (await import('yaml')).default

        let content = fs.readFileSync(filename, 'utf8')
        let config = yaml.parse(content)
        let rings = config.bootstrap_database.rings

        rings.forEach(ring => { if(ring.readonly === undefined) ring.readonly = true })

        let bootstrap_db = Database.create(rings)
        schemat.set_db(bootstrap_db)

        await bootstrap_db.open()
        // await bootstrap_db.insert_self()
    }
}

