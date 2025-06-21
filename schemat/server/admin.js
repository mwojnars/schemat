import fs from 'node:fs'
import yaml from 'yaml'

import {assert, print, sleep} from "../common/utils.js";
import {boot_schemat} from "./kernel.js";


/**********************************************************************************************************************/

export class Admin {
    /* Boot up Schemat and execute the <mode>__<command>() method to perform an administrative task.
       Dashes (-) in command name are replaced with underscores (_).
     */

    // "normal" mode: Schemat is fully booted with the final DB initialized
    // "rescue" mode: Schemat stays in the booting phase, only the bootstrap database is created, no final DB
    // "telnet" mode: no Schemat object created, the handler connects to the cluster leader via low-level TCP
    MODES = ['telnet', 'rescue', 'normal']

    static async run(...args) { return new this()._run(...args) }

    async _run(command, opts = {}) {
        /* Boot up Schemat and execute the cmd_XXX() method. Dashes (-) in command name are replaced with underscores (_). */
        if (!command) return
        let cmd = command.replace(/-/g, '_')
        let mode, fun

        // preparation method is executed before loading Schemat, so it can create ring files for the Schemat database
        if (this[`prepare__${cmd}`])
            await this[`prepare__${cmd}`](opts)

        // find the method and mode that together match the command name with MODE__ prefix, e.g. rescue__create_cluster
        for (let _mode of this.MODES) {
            let method = `${_mode}__${cmd}`
            if (this[method]) {
                mode = _mode
                fun = this[method]
                break
            }
        }
        assert(fun, `unknown command: ${command}`)

        // in "telnet" mode, the Schemat object is not created at all
        if (mode === 'telnet') return fun.call(this, opts)

        await boot_schemat(opts, async () => {
            // in "rescue" mode, only the bootstrap database is created; Schemat stays in booting phase; no final DB
            if (mode === 'normal') await schemat._boot_done()
            await fun.call(this, opts)
            process.exit(0)
        })
    }

    async prepare__create_cluster(opts) {}
    async normal__create_cluster(opts) {}

    async _create_cluster(opts) {
        /* Create database files for a new cluster by copying boot.01_cluster.data.XXXX.yaml ring image and doing plaintext modifications:
           - set cluster name and directory path
           - set TCP host and port for the first node (current physical node)
           - create an initial app-ring if missing (keep an existing one if present)
             - copy boot.02_app.data.XXXX.yaml
             - set application name
           - transform .yaml file(s) to the desired data format (rocksdb etc.)
         */
    }
    async _init_cluster(opts) {
        /* Open and modify a newly created cluster & app rings:
           - add cluster nodes #2, #3, ...
           - redistribute agents if needed (?)
           - generate index files
         */
    }

    async rescue__create_cluster(opts) {
        /* Create a new ring (ring-cluster) and cluster-related objects in it (nodes, database, etc.)
           according to cluster description read from a manifest file.
         */
        // print(`opts:`, opts)
        let {manifest_file} = opts
        let manifest = yaml.parse(fs.readFileSync(manifest_file, 'utf8'))
        let {cluster, ring} = manifest

        print(`manifest:`)
        print(manifest)

        let cluster_tag = cluster.file_tag || cluster.name || 'nodes'
        let cluster_path = `cluster/${cluster_tag}`
        let node_path = `${cluster_path}/node`          // to be renamed later

        let ring_tag = ring.file_tag || ring.name || 'ring-cluster'
        let ring_path = `${node_path}/${ring_tag}`      // the file name is incomplete

        await schemat.root_category.reload()            // load the root_category from DB so its .std is present
        await sleep()                                   // wait for root_category.std.* objects to load

        print(`std:`, schemat.std)
        print(`Ring:`, schemat.std.Ring.is_loaded())
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
    //             let new_id = await ring.insert(item.__json)
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

