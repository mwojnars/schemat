import yargs from 'yargs'
import {hideBin} from 'yargs/helpers'

import {boot_schemat, MasterProcess, WorkerProcess} from "./kernel.js"
import cluster from "node:cluster";


const HOST    = '127.0.0.1'
const PORT    =  3000
const WORKERS =  1 //Math.floor(os.cpus().length / 2)


/**********************************************************************************************************************/

await (async function run() {
    let opts = yargs(hideBin(process.argv))
        .option('config',    {type: 'string'})
        // .option('node-file', {type: 'string', default: './schemat/node.id'})
        .option('workers',   {type: 'number', default: WORKERS})
        .option('host',      {type: 'string', default: HOST})
        .option('port',      {type: 'number', default: PORT})
        // .option('node',      {type: 'string', desc: "path to the node folder inside cluster/..."})
        .option('node',      {type: 'number', desc: "ID of the node object in DB, overrides the content of node.id"})
        .option('tcp-port',  {type: 'number'})
        // .option('kafka-port',               {type: 'number'})
        // .option('kafka-controller-port',    {type: 'number'})
        .help().alias('help', 'h')
        .argv

    // let loader = new Loader(import.meta.url)

    // TODO: this line must be uncommented if dynamic code loading is needed (!!!); however, currently the dynamic loading causes errors for unknown reasons
    // let {WorkerProcess} = await loader.import('/$/local/schemat/server/kernel.js')

    let kernel_process = cluster.isPrimary ? new MasterProcess() : new WorkerProcess()
    await boot_schemat(opts, () => kernel_process.start(opts))
    // await kernel_process.start(opts)
})()
