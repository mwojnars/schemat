import cluster from 'node:cluster'
import fs from 'node:fs'

import "../common/globals.js"           // global flags: CLIENT, SERVER

import {print, assert, T} from "../common/utils.js";
import {Process} from "./servers.js";
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

export class MasterProcess extends Process {
    /* Top-level Schemat process running on a given node. Spawns and manages worker processes that execute agents:
       web server(s), data server(s), load balancer etc.
     */
    workers         // array of Node.js Worker instances (child processes); only present in the primary process
    server          // the Process instance running inside the current process (master/worker)
    running         // the Promise returned by .run() of the `server`
    worker_pids     // PID to WORKER_ID association

    async start(opts) {
        // node = schemat.get_loaded(this_node_ID)
        // return node.activate()     // start the life-loop and all worker processes (servers)

        // let m = await schemat.import('/$/local/schemat/test/temp1.js')
        // print('loaded:', m)
        // let {WebServer} = await schemat.import('/$/local/schemat/server/servers.js')

        print('MasterProcess.start() WORKER_ID:', this.worker_id)
        await boot_schemat(opts)
        this.opts = opts

        process.on('SIGTERM', () => this.stop())        // listen for TERM signal, e.g. kill
        process.on('SIGINT', () => this.stop())         // listen for INT signal, e.g. Ctrl+C

        let node_id = this._read_node_id()
        let Node = await schemat.import('/$/sys/Node')

        if (node_id)
            this.node = await schemat.load(node_id)
        else {
            this.node = await Node.new().save({ring: 'db-site'})
            fs.writeFileSync('./schemat/node.id', this.node.id.toString())
        }
        assert(this.node)

        if (cluster.isPrimary) {                // in the primary process, start the workers...
            this._start_workers()
            this.server = this
        }
        else {                                  // in the worker process, start this worker's Process instance
            print(`starting worker #${this.worker_id} (PID=${process.pid})...`)
            this.server = new Process(this.node, this.opts)
        }
        this.running = this.server.run()
    }

    _read_node_id() {
        try { return Number(fs.readFileSync('./schemat/node.id', 'utf8').trim()) }
        catch (ex) { print('node ID not found') }
    }

    _start_workers(num_workers = 2) {
        print(`starting ${num_workers} worker(s) in the master process (PID=${process.pid})...`)

        this.workers = []
        this.worker_pids = new Map()

        for (let i = 0; i < num_workers; i++) {
            let worker = this.workers[i] = cluster.fork({WORKER_ID: i + 1})
            this.worker_pids.set(worker.process.pid, i + 1)
        }

        cluster.on('exit', (worker) => {
            if (schemat.is_closing) return
            let id = this.worker_pids.get(worker.process.pid)               // retrieve WORKER_ID using PID
            print(`worker #${id} (PID=${worker.process.pid}) exited`)
            this.workers[id-1] = worker = cluster.fork({WORKER_ID: id})     // restart the process
            this.worker_pids.set(worker.process.pid, id)                    // update the map with new PID
            print(`worker #${id} (PID=${worker.process.pid}) restarted`)
        })
    }

    async stop() {
        if (schemat.is_closing) return
        schemat.is_closing = true

        let node = await this.node.reload()
        let delay = node.refresh_interval

        if (cluster.isPrimary) print(`\nReceived kill signal, shutting down gracefully in approx. ${delay} seconds...`)
        setTimeout(() => process.exit(1), 2 * delay * 1000)

        if (cluster.isPrimary)
            await Promise.all(this.workers.map(worker => new Promise((resolve, reject) => {
                worker.on('exit', resolve)
                worker.on('error', reject)
                worker.kill()
            })))

        await this.running
        process.exit(0)
    }

    _get_agents_running() {
        /* List of agents that should be running now on this process. When an agent is to be stopped, it should be first removed from this list. */
        // print('MasterProcess agents running:', this.node.master_agents_running.map(a => a.id), 'ttl left', this.node.__ttl_left())
        return [this.node, ...this.node.master_agents_running]
    }

    // _install_agents() {
    //     // agents installed sequentially (no concurrency), to avoid conflicting temporary changes in the environment (like CWD)
    //     process.chdir(schemat.node.local_root || schemat.site.local_root)
    // }
}

