/*
    Administration and execution of the Schemat installation.
*/

import yargs from 'yargs'
import {hideBin} from 'yargs/helpers'

import {assert, print} from './utils.js'
import {RingsDB, YamlDB} from "./server/db.js";
import {ServerRegistry} from "./server/registry-s.js";
import {Server} from "./server.js";


const DB_ROOT   = '/home/marcin/Documents/priv/catalog/src/schemat/server'
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

    async imove({cid, iid, new_iid}) {
        print(`imove: changing item's ID=[${cid},${iid}] to ID=[${cid},${new_iid}] ...`)

        if (await this.itemExists({cid, new_iid})) throw new Error(`target ID already exists: [${cid},${new_iid}]`)

        // load the item from its current ID
        // save the item as a new one, under the new ID
        // update children (of a category item)
        // update references
        // remove the old ID

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
        .demandCommand(1, 'Please provide a command.')
        .help().alias('help', 'h')
        .argv

    let commands = [
        'run',
        'imove',
    ]

    let cmd = argv._[0]
    if (!commands.includes(cmd)) return print("Unknown command:", cmd)

    let schemat = new Schemat(argv)
    await schemat.boot()

    return schemat[cmd](argv)
}

await main()
