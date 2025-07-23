import fs from 'node:fs'
import cluster from 'node:cluster'
import yaml from 'yaml'
// import why from 'why-is-node-running'

import "../common/globals.js"           // global flags: CLIENT, SERVER

import {print, assert, T, sleep} from "../common/utils.js";
import {StoppingNow} from "../common/errors.js";
import {ServerSchemat} from "../core/schemat_srv.js";
import {BootDatabase} from "../db/db.js";
import {Agent} from "./agent.js";
import {IPC_Mailbox} from "./node.js";
import {Frame, FramesMap} from "./frame.js";


// print NODE_PATH:
// console.log('NODE_PATH:', process.env.NODE_PATH)


/**********************************************************************************************************************/

export async function boot_schemat(opts, callback) {
    /* Create global (async local) `schemat` object, load the initial database, and run `callback`. */

    process.on("unhandledRejection", (reason, promise) => {
        console.error(`\n${schemat?.node?.id}/#${process.env.WORKER_ID || 0} UNHANDLED PROMISE REJECTION! A promise is created somewhere in the call stack that has NO .catch() handler and is NOT immediately awaited (possibly stored in a variable for future awaiting):`)
        console.error(reason, '\n')
    })

    let node_dir = opts['node']
    if (node_dir) opts.config ??= `cluster/${node_dir}/config.yaml`
    let config = await _load_config(opts.config)
    config = {...config, ...opts}
    // print('config:', config)

    ServerSchemat.global_init()

    await globalThis._schemat.run(new ServerSchemat(config), async () => {
        await schemat.boot(_create_boot_db, false)
        await callback()
    })

    async function _load_config(filename = null) {
        if (filename) return yaml.parse(fs.readFileSync(filename, 'utf8'))

        // if no config file is given, use the default config suitable for low-level admin operations like cluster creation
        return {
            bootstrap_rings: [{
                name: 'boot_kernel',
                file: './schemat/data/00_kernel.data.yaml'
            }]
        }
    }

    async function _create_boot_db() {
        let rings = config.bootstrap_rings
        rings.forEach(ring => { ring.readonly ??= true })
        return BootDatabase.draft({}, rings)
    }
}


/**********************************************************************************************************************/

export class Kernel {
    /* OS process (master or worker) of a cluster's node. Executes message loops of Agents assigned to the current node,
       performs TCP communication between nodes (if master) and IPC communication with the related master/worker process(es).
       Delegates some other duties to the Node class.
     */

    // booting = new Promise(resolve => this._booting_resolve = resolve)   // resolves when the kernel is fully booted; false after that

    node_id                     // ID of `node`
    frames = new FramesMap()    // Frames of currently running agents, keyed by agent IDs
    root_frame                  // frame that holds the running `node` agent
    _closing                    // true if .stop() was called and the process is shutting down right now

    // web object of [Node] category that represents the physical node this process is running on
    get node() { return this.root_frame.agent }

    get worker_id() {
        /* Numeric ID (1, 2, 3, ...) of the node's current worker process; 0 for the master process. */
        return Number(process.env.WORKER_ID) || 0
    }

    is_master() { return !this.worker_id}


    async run(opts) {
        await this.init(opts)
        return this.start()
    }

    async init(opts) {
        schemat._print('Kernel WORKER_ID:', process.env.WORKER_ID || 0)

        process.on('SIGTERM', () => this.stop())        // listen for TERM signal, e.g. kill
        process.on('SIGINT', () => this.stop())         // listen for INT signal, e.g. Ctrl+C

        // let m = await schemat.import('/$/local/schemat/test/temp1.js')
        // print('loaded:', m)
        // let {WebServer} = await schemat.import('/$/local/schemat/server/agent.js')

        schemat.set_kernel(this)
        this.node_id = Number(opts['node'].split('.').pop())
        // this._node = await schemat.load(this.node_id)

        // let node_file = './schemat/node.id'
        // let node_id = opts.node || Number(opts['node-dir'].split('.').pop()) || this._read_node_id(node_file)
        // this.node = node_id ? await schemat.load(node_id) : await this._create_node(node_file)
        // assert(this.node)
    }

    // _read_node_id(path) {
    //     /* Read from a file the ID of the node object to be executed in this local installation. */
    //     try { return Number(fs.readFileSync(path, 'utf8').trim()) }
    //     catch (ex) { print('node ID not found in', path) }
    // }
    //
    // async _create_node(path) {
    //     if (!cluster.isPrimary) throw new Error('unexpected error: a new Node object should only be created in the primary process, not in a worker')
    //     let Node = await schemat.import('/$/sys/Node')
    //     let node = await Node.new().save({ring: 'ring-cluster'})
    //     fs.writeFileSync(path, this.node.id.toString())
    //     print(`created new node:`, this.node.id)
    //     return node
    // }

    // _boot_done() {
    //     this._booting_resolve()     // resolve this.booting promise and replace it with false
    //     this.booting = false
    // }

    async start() {
        try {
            await schemat._boot_done()
            schemat._print(`boot done`)
            await this.start_node_agent()
        }
        catch (ex) {
            schemat._print_error(`start() of node process FAILED with`, ex)
        }
    }

    async start_node_agent() {
        // start this node's own agent and all agents in workers
        let role = this.is_master() ? '$master' : '$worker'
        let {state} = this.root_frame = await this.start_agent(this.node_id, role)
        assert(this.frames.size === 1)
        assert(this.root_frame.agent)

        // on master, wait for other agents (in child processes) to start; only then the TCP receiver can be started, as the last step of boot up
        if (this.is_master())
            await this._start_agents(state.agents)
            // await tcp_receiver.start(this.node.tcp_port)
            // this._boot_done()
    }

    async start_agent(id, role) {
        if (this.frames.has([id, role])) throw new Error(`agent [${id}] in role ${role} is already running`)
        role ??= schemat.GENERIC_ROLE           // "$agent" role is the default for running agents

        try {
            let agent = await schemat.get_loaded(id)

            // schemat._print(`start_agent(): ${agent}`, agent.__content)
            assert(agent.is_loaded())
            assert(agent instanceof Agent)

            let frame = new Frame(agent, role)
            this.frames.set([id, role], frame)      // the frame must be assigned to `frames` already before .start()
            await frame.start()
            return frame
        }
        catch (ex) {
            // schemat._print_error(`starting agent [${id}].${role} FAILED with`, ex)
            throw ex
        }
    }

    async stop() {
        if (this._closing) return
        this._closing = true

        process.removeAllListeners('message')       // don't accept new IPC messages

        let delay = this.node.agent_refresh_interval
        if (cluster.isPrimary) schemat._print(`Received kill signal, shutting down gracefully in approx. ${delay} seconds...`)

        let timeout = 1 * delay         // exceeding this timeout may indicate a deadlock in one of child processes
        setTimeout(() => {
            // why()
            schemat._print(`exceeded timeout of ${timeout} seconds for shutting down`)
            process.exit(1)
        }, timeout * 1000)

        this.workers?.map(worker => worker.kill())

        if (cluster.isPrimary)
            await Promise.all(this.workers.map(worker => new Promise((resolve, reject) => {
                worker.on('exit', resolve)
                worker.on('error', reject)
            })))

        try {
            // this.stop_calls()
            await this.stop_agents()
        }
        catch (ex) {
            if (!(ex instanceof StoppingNow)) throw ex
        }

        schemat._print(`process closed`)
        process.exit(0)
    }

    // stop_calls() {
    //     /* Terminate ongoing IPC/RPC calls. */
    //     let ex = new StoppingNow(`the process is closing`)
    //     for (let _schemat of globalThis._contexts.values())
    //         [..._schemat.on_exit].reverse().map(fn => fn(ex))
    // }

    async stop_agents() {
        /* Stop all agents at shutdown. Do it in reverse order, because newer agents may depend on the older ones. */
        // return Promise.all([...this.frames.values()].reverse().map(frame => frame.stop()))
        for (let [[id, role], frame] of [...this.frames.entries()].reverse()) {
            await frame.stop(true)
            this.frames.delete([id, role])
        }
    }

    async stop_agent(id, role) {
        /* Stop all agents. Do it in reverse order, because newer agents may depend on the older ones. */
        // return Promise.all([...this.frames.values()].reverse().map(frame => frame.stop()))
        let frame = this.frames.get([id, role])
        await frame.stop()
        this.frames.delete([id, role])
    }
}

/**********************************************************************************************************************/

export class KernelMaster extends Kernel {
    /* Top-level Schemat kernel process that manages a given node. Spawns and manages worker processes. */

    workers         // array of Node.js Worker instances (child processes); each item has .mailbox (IPC_Mailbox) for communication with this worker
    worker_pids     // PID to WORKER_ID association

    get_worker(process_id) {
        assert(process_id >= 1)
        assert(process_id <= this.workers.length, `worker #${process_id} is not present`)
        return this.workers[process_id - 1]     // workers 1,2,3... stored under indices 0,1,2...
    }

    async start() {
        schemat._print(`starting node:`, this.node_id)
        let node = await schemat.load(this.node_id)

        this._start_workers(node.num_workers)
        // await sleep(2.0)            // wait for workers to start their IPC before sending requests
        await super.start()
    }

    _start_workers(num_workers) {
        schemat._print(`spawning ${num_workers} worker(s) from master process (PID=${process.pid})...`)

        this.workers = []
        this.worker_pids = new Map()

        for (let i = 0; i < num_workers; i++)
            this._start_worker(i + 1)

        cluster.on('exit', (worker) => {
            if (schemat.terminating) return
            let id = this.worker_pids.get(worker.process.pid)               // retrieve WORKER_ID using PID
            throw new Error(`worker #${id} (PID=${worker.process.pid}) exited`)
            // print(`worker #${id} (PID=${worker.process.pid}) exited`)
            // worker = this._start_worker(id)
            // print(`worker #${id} (PID=${worker.process.pid}) restarted`)
        })
    }

    _start_worker(id) {
        /* Start or restart a worker process. */
        let worker = this.workers[id-1] = cluster.fork({WORKER_ID: id})
        this.worker_pids.set(worker.process.pid, id)                                // remember PID-to-ID mapping
        worker.mailbox = new IPC_Mailbox(worker, msg => this.node.ipc_master(msg))  // IPC requests from `worker` to master
        // worker.mailbox = new IPC_Mailbox(worker, msg => this.node.$master.ipc_master(msg))
        return worker
    }

    async _start_agents(agents) {
        /* Inform worker processes what `agents` to start. */
        let num_workers = this.workers.length
        for (let {worker, id, role} of agents) {
            assert(id)
            role ??= schemat.GENERIC_ROLE

            // adjust the `worker` index if it does not match a valid worker ID (should be in 1,2,...,num_workers)
            if (worker < 1 || worker > num_workers) {
                let new_worker = (worker-1) % num_workers + 1
                this._print(`_start_agents(): adjusted worker process index of agent [${id}] from #${worker} to #${new_worker}`)
                worker = new_worker
            }

            // below, the limited scope='node' for RPC routing is deduced from _xxx() command name
            try { await this.node.$worker({worker})._start_agent(id, role) }
            catch (ex) {
                this.node._print_error(`boot start of agent [${id}].${role} at worker #${worker} FAILED with`, ex)
            }
        }
    }
}

/**********************************************************************************************************************/

export class KernelWorker extends Kernel {
    /* Descendant Schemat kernel process that executes agents: web servers, data nodes (blocks), load balancers etc. */

    mailbox     // IPC_Mailbox for communication with the master process

    async start() {
        schemat._print(`starting worker #${this.worker_id} (PID=${process.pid})...`)
        this.mailbox = new IPC_Mailbox(process, msg => this.node.ipc_worker(msg))    // IPC requests from master to this worker
        // await sleep(3.0)            // wait for master to provide an initial list of agents; delay here must be longer than in KernelMaster.start()
        await super.start()
    }
}

