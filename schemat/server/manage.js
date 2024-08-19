/*
    Launch & manage a Schemat's local installation.
    TODO: move out static CLI functionality to another class & file.

    Usage:   node --experimental-vm-modules server/manage.js [move|reinsert] [options]
*/

import yargs from 'yargs'
import {hideBin} from 'yargs/helpers'

import {print, T} from '../common/utils.js'
import {Loader} from "./loader.js"
import {AdminProcess} from "./processes.js"


/**********************************************************************************************************************/

await (async function main() {

    let argv = yargs(hideBin(process.argv))

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

    let commands = ['move', 'reinsert']

    let cmd = argv._[0]
    if (!commands.includes(cmd)) return print("Unknown command:", cmd)

    let loader = new Loader(import.meta.url)

    return new AdminProcess(loader).start(cmd, {...argv})
})()
