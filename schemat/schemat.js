/*
    Schemat CLI: the main entry point to run and manage a Schemat installation.
*/

import path from 'path'
import {fileURLToPath} from 'url'

import yargs from 'yargs'
import {hideBin} from 'yargs/helpers'

import {assert, print} from './utils.js'
import {RingsDB, YamlDB} from "./server/db.js";
import {ServerRegistry} from "./server/registry-s.js";
import {Server} from "./server.js";


const __filename = fileURLToPath(import.meta.url)       // or: process.argv[1]
const __dirname  = path.dirname(__filename)


const DB_ROOT   = __dirname + '/database'
const HOST      = '127.0.0.1'
const PORT      =  3000
const WORKERS   =  1 //Math.floor(os.cpus().length / 2)


/**********************************************************************************************************************/

class Schemat {

    constructor(opts) {
        this.opts = opts
    }

    async boot() {
        this.db = new RingsDB(
            new YamlDB(DB_ROOT + '/db-boot.yaml', {writable: false}),
            new YamlDB(DB_ROOT + '/db-base.yaml', {writable: false}),
            new YamlDB(DB_ROOT + '/db-conf.yaml', {start_IID: 0}),
            new YamlDB(DB_ROOT + '/db-demo.yaml', {start_IID: 100}),
        )
        this.registry = globalThis.registry = new ServerRegistry(this.db)

        await this.db.load()
        await this.registry.boot()
    }

    /*****  Core functionality  *****/

    async run({host, port, workers})        { return new Server(this, {host, port}).serve_cluster(workers) }


    /*****  Admin interface  *****/

    async _build_({path_db_boot}) {
        /* Generate the core "db-boot" database file anew. */
        let {bootstrap} = await import('./server/bootstrap.js')
        return bootstrap(path_db_boot || (DB_ROOT + '/db-boot.yaml'))
    }

    async imove({cid, iid, new_iid}) {
        print(`imove: changing item's ID=[${cid},${iid}] to ID=[${cid},${new_iid}] ...`)

        let id    = [cid, iid]
        let newid = [cid, new_iid]

        if (await this.db.exists(newid)) throw new Error(`target ID already exists: [${cid},${new_iid}]`)

        // load the item from its current ID
        // save the item as a new one under the new ID
        // update children (of a category item)

        let data = this.db.get(id)
        this.db.put(newid, data)
        // db.add(cid, data, {min_iid}) -- low-level insert, returns an IID created

        if (cid === ROOT_CID)               // category item: must change CID of children to `new_iid`
            for await (let child of this.db.scan(iid))
                this.db.move(child.id, [new_iid, child.iid])

        let newItem = this.registry.getItem(newid)

        // update references
        for await (let ref of this.registry.scan()) {           // search for references to `id` in the `ref` referrer item
            await ref.load()
            ref.data.transform({value: item => item instanceof Item && item.has_id(id) ? newItem : item})
            let jsonData = ref.dumpData()
            if (jsonData !== ref.jsonData)
                this.db.put(ref.id, jsonData)
        }

        // remove the old item from DB
        this.db.del(id)

        print('imove: done')
    }

}

/**********************************************************************************************************************/

async function main() {

    let argv = yargs(hideBin(process.argv))
        .command(
            'run', 'start a Schemat web server', {
                host:       {default: HOST},
                port:       {default: PORT},
                workers:    {default: WORKERS},
            }
        )
        .command(
            'imove <cid> <iid> <new_iid>',
            'change IID of a given item; update references nested within standard data types; if the item is a category than CID of child items is updated, too',
            // (yargs) => yargs
            //     .positional('cid')
            //     .positional('iid')
            //     .positional('new_iid')
        )
        .command(
            '_build_ [path_db_boot]', 'generate the core "db-boot" database anew',
        )

        .demandCommand(1, 'Please provide a command to run.')
        .help().alias('help', 'h')
        .argv

    let commands = [
        'run',
        'imove',
        '_build_',
    ]

    let cmd = argv._[0]
    if (!commands.includes(cmd)) return print("Unknown command:", cmd)

    let schemat = new Schemat(argv)
    await schemat.boot()

    return schemat[cmd](argv)
}

await main()
