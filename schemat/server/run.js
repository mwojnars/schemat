import yargs from 'yargs'
import {hideBin} from 'yargs/helpers'

import {WorkerProcess} from "./processes.js"


const HOST    = '127.0.0.1'
const PORT    =  3000
const WORKERS =  1 //Math.floor(os.cpus().length / 2)


/**********************************************************************************************************************/

await (async function main() {
    let argv = yargs(hideBin(process.argv))
        .option('host',    {type: 'string', default: HOST})
        .option('port',    {type: 'number', default: PORT})
        .option('workers', {type: 'number', default: WORKERS})
        .help().alias('help', 'h')
        .argv

    // let loader = new Loader(import.meta.url)
    
    // TODO: this line must be uncommented if dynamic code loading is needed (!!!); however, currently the dynamic loading causes errors for unknown reasons
    // let {WorkerProcess} = await loader.import('/system/local/server/processes.js')

    return new WorkerProcess().start('run', argv)
}())
