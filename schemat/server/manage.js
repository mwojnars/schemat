/*
    Launch & manage a Schemat's local installation.
    TODO: move out static CLI functionality to another class & file.

    Usage:   node --experimental-vm-modules server/manage.js [run|move|reinsert] [options]
*/

import node_path from "node:path"
import node_url from "node:url"
import yargs from 'yargs'
import {hideBin} from 'yargs/helpers'

import {print, T} from '../common/utils.js'
import {Loader} from "./loader.js"
import {AdminProcess, WorkerProcess} from "./processes.js"


const HOST      = '127.0.0.1'
const PORT      =  3000
const WORKERS   =  1 //Math.floor(os.cpus().length / 2)


/**********************************************************************************************************************/

async function main() {

    let argv = yargs(hideBin(process.argv))

        .command('run', 'start a Schemat cluster',
            {
                host:       {default: HOST},
                port:       {default: PORT},
                workers:    {default: WORKERS},
            }
        )
        .command('move <id> <newid>', 'change ID of an object; update references in other objects (if occur inside standard data types)',
            // (yargs) => yargs
            //     .positional('id')
            //     .positional('newid')
        )
        .command('reinsert <ids> [ring]',
            'remove object(s) from their current ring(s) and insert under new IDs into `ring`, or to the top-most ring if `ring` is not specified; ' +
            '`ids` is a comma-separated list of specifiers, each one being an ID value (123) or an X-Y range (100-105), no spaces allowed!')

        // .command('build [path_db_boot]', 'generate the core "db-boot" database anew')
        //     .option('bottom', {
        //         alias: 'b',
        //         description: 'if set, new items are inserted at the lowest possible DB level',
        //         type: 'boolean'
        //     })
        //     .option('db', {
        //         description: 'name of the DB in a stack where insertion of new items should start (can propagate upwards)',
        //         type: 'string'
        //     })

        .demandCommand(1, 'Please provide a command to run.')
        .help().alias('help', 'h')
        .argv

    let commands = ['run', 'move', 'reinsert']     //'build'

    let cmd = argv._[0]
    if (!commands.includes(cmd)) return print("Unknown command:", cmd)

    const file = node_url.fileURLToPath(import.meta.url)            // or: process.argv[1]
    const root = node_path.dirname(node_path.dirname(file))         // root folder of the project
    // const root = node_path.dirname(import.meta.dirname)             // root folder of the project  -- this doesn't work in Mocha tests

    // create custom loader for dynamic module imports from the SUN namespace
    let loader = new Loader(root)

    // TODO: this line must be uncommented if dynamic code loading is needed (!!!); however, currently the dynamic loading causes errors for unknown reasons
    // let {AdminProcess, WorkerProcess} = await loader.import('/system/local/server/processes.js')

    let main_process = (cmd === 'run') ?
        new WorkerProcess(loader) :
        new AdminProcess(loader)

    return main_process.start(cmd, {...argv})
}

await main()
