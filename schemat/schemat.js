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
            new YamlDB(DB_ROOT + '/db-conf.yaml', {start_iid: 0}),
            new YamlDB(DB_ROOT + '/db-demo.yaml', {start_iid: 100}),
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

    async move({id, newid}) {
        /* id, new_iid - strings of the form "CID:IID" */

        id = id.split(':').map(Number)
        newid = newid.split(':').map(Number)

        let [cid, iid] = id
        let [new_cid, new_iid] = newid

        if ((cid === ROOT_CID || new_cid === ROOT_CID) && cid !== new_cid)
            throw new Error(`cannot change a category item (CID=${ROOT_CID}) to a non-category (CID=${cid || new_cid}) or back`)

        if (await this.db.has(newid)) throw new Error(`target ID already exists: [${newid}]`)

        print(`move: changing item's ID=[${id}] to ID=[${newid}] ...`)

        // load the item from its current ID
        let db = await this.db.find(id)
        if (db === undefined) throw new Error(`item not found: [${id}]`)
        let data = await db.get(id)

        // save a copy under the new ID; this will propagate to a higher-level DB if `id` can't be stored in `db`
        await db.put(newid, data)
        let newItem = this.registry.getItem(newid)

        // update children of a category item: change their CID to `new_iid`
        if (cid === ROOT_CID)
            for await (let child of this.db.scan(iid))
                await this.move({id: child.id, newid: [new_iid, child.iid]})

        // update references
        for await (let ref of this.registry.scan()) {           // search for references to `id` in a referrer item, `ref`
            await ref.load()
            ref.data.transform({value: item => item instanceof Item && item.has_id(id) ? newItem : item})
            let jsonData = ref.dumpData()
            if (jsonData !== ref.jsonData)
                await this.db.update(ref)      //flush: false
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
            'move <id> <newid>',
            // 'move <cid> <iid> <new_iid>',
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
    if (cmd !== '_build_') await schemat.boot()         // _build_ command performs boot (creates registry) on its own

    return schemat[cmd](argv)
}

await main()
