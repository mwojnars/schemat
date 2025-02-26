import yargs from 'yargs'
import {hideBin} from 'yargs/helpers'

import {MasterProcess, WorkerProcess} from "./process.js"
import cluster from "node:cluster";


const HOST    = '127.0.0.1'
const PORT    =  3000
const WORKERS =  1 //Math.floor(os.cpus().length / 2)


/**********************************************************************************************************************/

await (async function run() {
    let opts = yargs(hideBin(process.argv))
        .option('config',  {type: 'string', default: './schemat/config.yaml'})
        .option('workers', {type: 'number', default: WORKERS})
        .option('host',    {type: 'string', default: HOST})
        .option('port',    {type: 'number', default: PORT})
        .option('node',    {type: 'number'})        // ID of the node object in DB, overrides the content of node.id
        .option('tcp-port',{type: 'number'})
        // .option('kafka-port',               {type: 'number'})
        // .option('kafka-controller-port',    {type: 'number'})
        .help().alias('help', 'h')
        .argv

    // let loader = new Loader(import.meta.url)

    // TODO: this line must be uncommented if dynamic code loading is needed (!!!); however, currently the dynamic loading causes errors for unknown reasons
    // let {WorkerProcess} = await loader.import('/$/local/schemat/server/process.js')

    let node_process = cluster.isPrimary ? new MasterProcess() : new WorkerProcess()
    await node_process.init(opts)
    return node_process.start()

    // return new MasterProcess().start(opts)
})()
