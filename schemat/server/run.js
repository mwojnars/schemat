import yargs from 'yargs'
import {hideBin} from 'yargs/helpers'

import {Loader} from "./loader.js"
import {WorkerProcess} from "./processes.js"


const HOST    = '127.0.0.1'
const PORT    =  3000
const WORKERS =  1 //Math.floor(os.cpus().length / 2)


// export function create_loader(file_url, depth = 1) {
//     /* Create a custom loader for dynamic module imports. The loader's root folder will be placed `depth` levels up from the file_url's folder. */
//     let file = node_url.fileURLToPath(file_url)                 // or: process.argv[1]
//     let root = node_path.dirname(file)                          // folder of the file_url
//
//     for (let i = 0; i < depth; i++)                             // go up `depth` levels to get the root folder of the project
//         root = node_path.dirname(root)
//
//     return new Loader(root)
// }

/**********************************************************************************************************************/

await (async function main() {
    let argv = yargs(hideBin(process.argv))
        .option('host',    {type: 'string', default: HOST})
        .option('port',    {type: 'number', default: PORT})
        .option('workers', {type: 'number', default: WORKERS})
        .help().alias('help', 'h')
        .argv

    let loader = new Loader(import.meta.url)
    
    // TODO: this line must be uncommented if dynamic code loading is needed (!!!); however, currently the dynamic loading causes errors for unknown reasons
    // let {WorkerProcess} = await loader.import('/system/local/server/processes.js')

    return new WorkerProcess(loader).start('run', argv)
}())
