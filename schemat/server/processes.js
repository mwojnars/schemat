import cluster from 'node:cluster'
import fs from 'node:fs'

import "../common/globals.js"           // global flags: CLIENT, SERVER

import {print, assert, T} from "../common/utils.js";
import {Server} from "./servers.js";
import {WebObject} from "../core/object.js";
import {ServerSchemat} from "../core/schemat_srv.js";
import {Database} from "../db/db.js";


// print NODE_PATH:
// console.log('NODE_PATH:', process.env.NODE_PATH)


/**********************************************************************************************************************/

export async function boot_schemat(opts) {
    /* Create the global `schemat` object and initialize its database. */

    opts.config ??= './schemat/config.yaml'
    let config = await _load_config(opts.config)
    config = {...config, ...opts}
    // print('config:', config)

    await new ServerSchemat(config).boot(() => _open_bootstrap_db())
    // await schemat.db.insert_self()

    async function _load_config(filename) {
        let fs = await import('node:fs')
        let yaml = (await import('yaml')).default
        let content = fs.readFileSync(filename, 'utf8')
        return yaml.parse(content)
    }

    async function _open_bootstrap_db() {
        let db = Database.new()
        let rings = config.bootstrap_rings
        rings.forEach(ring => { if(ring.readonly === undefined) ring.readonly = true })
        await db.open(rings)
        await db.load()             // run __init__() and activate the database object
        return db
    }
}

/**********************************************************************************************************************/

export class MasterProcess extends Server {
    /* Top-level Schemat process running on a given node. Spawns and manages worker processes that execute agents:
       web server(s), data server(s), load balancer etc.
     */
    machine         // the Machine web object that represents the physical machine this process is running on
    workers         // array of Node.js Worker instances (child processes); only present in the primary process
    server          // in a subprocess, the Server instance started inside the worker

    async start(opts) {
        // node = schemat.get_loaded(this_node_ID)
        // return node.activate()     // start the life-loop and all worker processes (servers)

        // let m = await schemat.import('/$/local/schemat/test/temp1.js')
        // print('loaded:', m)
        // let {WebServer} = await schemat.import('/$/local/schemat/server/servers.js')

        print('MasterProcess.start() WORKER_ID:', process.env.WORKER_ID)
        await boot_schemat(opts)
        this.opts = opts

        process.on('SIGTERM', () => this.stop())        // listen for TERM signal, e.g. kill
        process.on('SIGINT', () => this.stop())         // listen for INT signal, e.g. Ctrl+C

        let machine_id = this._read_machine_id()
        let Machine = await schemat.import('/$/sys/Machine')

        if (machine_id)
            this.machine = await schemat.load(machine_id)
        else {
            this.machine = await Machine.new().save({ring: 'db-site'})
            fs.writeFileSync('./schemat/machine.id', this.machine.id.toString())
        }
        assert(this.machine)

        if (cluster.isPrimary) {                // in the primary process, start the workers...
            this._start_workers()
            await this.run()
        }
        else {                                  // in the worker process, start this worker's server life-loop
            let id = process.env.WORKER_ID
            this.server = new Server(this.machine, this.opts)
            print(`starting worker #${id} (PID=${process.pid})...`)
            return this.running = this.server.run()
        }
    }

    _read_machine_id() {
        try { return Number(fs.readFileSync('./schemat/machine.id', 'utf8').trim()) }
        catch (ex) { print('machine ID not found') }
    }

    _start_workers(num_workers = 2) {

        this.workers = []
        print(`starting the main process (PID=${process.pid}) with ${num_workers} worker(s)...`)

        for (let i = 0; i < num_workers; i++)
            this.workers[i] = cluster.fork({WORKER_ID: i + 1})

        cluster.on('exit', (worker) => {
            if (schemat.is_closing) return
            let id = worker.process.env.WORKER_ID
            print(`worker #${id} (PID=${worker.process.pid}) exited`)
            this.workers[id-1] = worker = cluster.fork({WORKER_ID: id})      // restart the process
            print(`worker #${id} (PID=${worker.process.pid}) restarted`)
        })
    }

    async stop() {
        if (schemat.is_closing) return

        let machine = await this.machine.reload()
        let delay = machine.refresh_interval

        if (cluster.isPrimary) print(`\nReceived kill signal, shutting down gracefully in approx. ${delay} seconds...`)

        schemat.is_closing = true
        setTimeout(() => process.exit(1), 2 * delay * 1000)

        if (cluster.isPrimary)
            await Promise.all(this.workers.map(worker => new Promise(resolve => {
                worker.on('exit', resolve)
                worker.kill()
            })))
        else await this.running
        process.exit(0)
    }

    async run() {
        /* Perpetual loop: process Kafka messages, install/uninstall agents, refresh the node object. */
    }

    // _install_agents() {
    //     // agents installed sequentially (no concurrency), to avoid conflicting temporary changes in the environment (like CWD)
    //     process.chdir(schemat.machine.local_root || schemat.site.local_root)
    // }
}

