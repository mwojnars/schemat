import node_path from "node:path"
import node_url from "node:url"
import yargs from 'yargs'
import {hideBin} from 'yargs/helpers'

import {Loader} from "./loader.js"
import {WorkerProcess} from "./processes.js"


const HOST    = '127.0.0.1'
const PORT    =  3000
const WORKERS =  1 //Math.floor(os.cpus().length / 2)


export function create_loader(file_url) {
    const file = node_url.fileURLToPath(file_url)                   // or: process.argv[1]
    const root = node_path.dirname(node_path.dirname(file))         // root folder of the project
    // const root = node_path.dirname(import.meta.dirname)             // root folder of the project  -- this doesn't work in Mocha tests
    
    // create custom loader for dynamic module imports from the SUN namespace
    return new Loader(root)
}

/**********************************************************************************************************************/

await (async function main() {
    let argv = yargs(hideBin(process.argv))
        .option('host',    {type: 'string', default: HOST})
        .option('port',    {type: 'number', default: PORT})
        .option('workers', {type: 'number', default: WORKERS})
        .help().alias('help', 'h')
        .argv

    let loader = create_loader(import.meta.url)
    
    // TODO: this line must be uncommented if dynamic code loading is needed (!!!); however, currently the dynamic loading causes errors for unknown reasons
    // let {WorkerProcess} = await loader.import('/system/local/server/processes.js')

    return new WorkerProcess(loader).start('run', argv)
}())
