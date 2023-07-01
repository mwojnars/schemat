/*
    Launch & management of a Schemat cluster.
    TODO: move out static CLI functionality to another class & file.
*/

import yargs from 'yargs'
import {hideBin} from 'yargs/helpers'

import {print, T} from '../utils.js'
import {AdminProcess, WorkerProcess} from "./processes_srv.js"


const HOST      = '127.0.0.1'
const PORT      =  3000
const WORKERS   =  1 //Math.floor(os.cpus().length / 2)


/**********************************************************************************************************************/

async function main() {

    let argv = yargs(hideBin(process.argv))
        .command(
            'run', 'start a Schemat cluster', {
                host:       {default: HOST},
                port:       {default: PORT},
                workers:    {default: WORKERS},
            }
        )
        .command(
            'move <id> <newid>',
            'change IID of a given item; update references in other items (if occur inside standard data types)',
            // (yargs) => yargs
            //     .positional('id')
            //     .positional('newid')
        )
        .command(
            'build [path_db_boot]', 'generate the core "db-boot" database anew',
        )
        .option('bottom', {
            alias: 'b',
            description: 'if set, new items are inserted at the lowest possible DB level',
            type: 'boolean'
        })
        .option('db', {
            description: 'name of the DB in a stack where insertion of new items should start (can propagate upwards)',
            type: 'string'
        })

        .demandCommand(1, 'Please provide a command to run.')
        .help().alias('help', 'h')
        .argv

    let commands = [
        'run',
        'move',
        'build',
    ]

    let cmd = argv._[0]
    if (!commands.includes(cmd)) return print("Unknown command:", cmd)

    let schemat = (cmd === 'run') ?
        new WorkerProcess() :
        new AdminProcess()

    await schemat.init()
    return schemat.start(cmd, {...argv})
}

await main()
