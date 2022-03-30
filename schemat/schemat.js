/*
    Schemat CLI: the main entry point to run and manage a Schemat installation.
*/

import path from 'path'
import {fileURLToPath} from 'url'

import yargs from 'yargs'
import {hideBin} from 'yargs/helpers'

import {assert, print} from './utils.js'
import {YamlDB, stackDB} from "./server/db.js";
import {ServerRegistry} from "./server/registry-s.js";
import {ROOT_CID} from "./item.js";
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
        this.db = stackDB(  //new RingsDB(
            new YamlDB(DB_ROOT + '/db-boot.yaml', {readOnly: true}),
            new YamlDB(DB_ROOT + '/db-base.yaml', {readOnly: true}),
            new YamlDB(DB_ROOT + '/db-conf.yaml', {start_IID: 0}),
            new YamlDB(DB_ROOT + '/db-demo.yaml', {start_IID: 100}),
        )
        this.registry = globalThis.registry = new ServerRegistry(this.db)

        await this.db.open()
        await this.registry.boot()
    }

    /*****  Core functionality  *****/

    async run({host, port, workers})        { return new Server(this, {host, port}).serve_cluster(workers) }


    /*****  Admin interface  *****/

    async _build_({path_db_boot}) {
        /* Generate the core "db-boot" database file anew. */
        let {bootstrap} = await import('./server/bootstrap.js')
        let db = new YamlDB(path_db_boot || (DB_ROOT + '/db-boot.yaml'))
        return bootstrap(db)
    }

    async move({cid, iid, new_iid}) {

        let id    = [cid, iid]
        let newid = [cid, new_iid]

        if (id[0] === ROOT_CID && newid[0] === ROOT_CID && id[0] !== newid[0])
            throw new Error(`move: `)

        if (await this.db.has(newid)) throw new Error(`target ID already exists: [${newid}]`)

        print(`move: changing item's ID=[${id}] to ID=[${newid}] ...`)

        // load the item from its current ID; save a copy under the new ID
        let data = await this.db.get(id)
        await this.db.put(newid, data)      //flush: false
        let newItem = this.registry.getItem(newid)

        // update children of a category item: change their CID to `new_iid`
        if (id[0] === ROOT_CID)
            for await (let child of this.db.scan(iid))
                await this.move({cid: child.cid, iid: child.iid, new_cid: new_iid})

        // update references
        for await (let ref of this.registry.scan()) {           // search for references to `id` in a referrer item, `ref`
            await ref.load()
            ref.data.transform({value: item => item instanceof Item && item.has_id(id) ? newItem : item})
            let jsonData = ref.dumpData()
            if (jsonData !== ref.jsonData)
                await ref.db.put(ref.id, jsonData)      //flush: false
        }

        // remove the old item from DB
        await this.db.del(id)       //flush: true

        print('move: done')
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
            'move <cid> <iid> <new_iid>',
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
        'move',
        '_build_',
    ]

    let cmd = argv._[0]
    if (!commands.includes(cmd)) return print("Unknown command:", cmd)

    let schemat = new Schemat(argv)
    await schemat.boot()

    return schemat[cmd](argv)
}

await main()
