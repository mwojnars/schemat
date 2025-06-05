/*
    Launch & manage a Schemat's local installation.

    Usage:   node --experimental-vm-modules server/manage.js [move|reinsert] [options]
*/

import yargs from 'yargs'
import {hideBin} from 'yargs/helpers'

import {print, T} from '../common/utils.js'
import {Admin} from "./admin.js"


/**********************************************************************************************************************/

await (async function main() {

    let opts = yargs(hideBin(process.argv))

        .command('create-cluster <manifest_file>',
            'create a new cluster and save its objects to a new ring on this node')

        .command('move <id> <newid>', 'change ID of an object; update references in other objects (if occur inside standard data types)',
            // (yargs) => yargs
            //     .positional('id')
            //     .positional('newid')
        )
        .command('reinsert <ids>',
            'remove object(s) from their current ring(s) and insert under new IIDs into `ring`, or to the top-most ring if `ring` is not specified; ' +
            '`ids` is a comma-separated list of specifiers, each one being an ID value (123) or an X-Y range (100-105), no spaces allowed!',
            (yargs) => yargs
                .option('new', {
                    desc: 'new ID to assign to the object being reinserted; only allowed when reinserting a single object; if not given, a new ID is selected automatically',
                    type: 'number'
                })
                .option('ring', {
                    desc: 'name of the DB ring where to insert',
                    type: 'string'
                })
        )

        // .command('find-orphans', 'find all objects that are not referenced by any other object; orphan cycles are NOT detected',)

        .option('node', {type: 'string', desc: "path to the node's local folder inside ./cluster/... for finding config.yaml, detecting cluster ID and inferring node ID"})

        .demandCommand(1, 'Please provide a command to run.')
        .help().alias('help', 'h')
        .argv

    let commands = ['create-cluster', 'move', 'reinsert']

    let cmd = opts._[0]
    if (!commands.includes(cmd)) return print("Unknown command:", cmd)

    // let loader = new Loader(import.meta.url)

    await Admin.run(cmd, {...opts})
})()
