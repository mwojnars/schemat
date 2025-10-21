import cluster from "node:cluster"
import yargs from 'yargs'
import {hideBin} from 'yargs/helpers'

import {boot_schemat, KernelMaster, KernelWorker} from "./kernel.js"

import {register} from 'node:module'
import {pathToFileURL} from 'node:url'

// register loaders for Svelte and JSX
register('./schemat/server/svelte_loader.js', pathToFileURL('./'))
register('./schemat/server/jsx_loader.js', pathToFileURL('./'))


const HOST    = '127.0.0.1'
const PORT    =  3000
const WORKERS =  1 //Math.floor(os.cpus().length / 2)


/**********************************************************************************************************************/

await (async function run() {
    let opts = yargs(hideBin(process.argv))
        .option('config',    {type: 'string'})
        .option('workers',   {type: 'number', default: WORKERS})
        .option('host',      {type: 'string', default: HOST})
        .option('port',      {type: 'number', default: PORT})
        .option('node',      {type: 'string', desc: "path to the node's local folder inside ./cluster/... for finding config.yaml and inferring node ID"})
        .option('debug',     {type: 'boolean'})
        // .option('tcp-port',  {type: 'number'})
        // .option('node-file', {type: 'string', default: './schemat/node.id'})
        // .option('node',      {type: 'number', desc: "ID of the node object in DB, overrides the content of node.id"})
        // .option('kafka-port',               {type: 'number'})
        // .option('kafka-controller-port',    {type: 'number'})
        .help().alias('help', 'h')
        .argv

    // let loader = new Loader(import.meta.url)

    // TODO: this line must be uncommented if dynamic code loading is needed (!!!); however, currently the dynamic loading causes errors for unknown reasons
    // let {KernelWorker} = await loader.import('/$/local/schemat/server/kernel.js')

    let kernel_process = cluster.isPrimary ? new KernelMaster() : new KernelWorker()
    await boot_schemat(opts, () => kernel_process.run(opts))
})()
