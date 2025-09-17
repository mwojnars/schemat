import fs from 'node:fs'
import cluster from 'node:cluster'
import yaml from 'yaml'
// import why from 'why-is-node-running'

import "../common/globals.js"           // global flags: CLIENT, SERVER
import {AgentRole} from "../common/globals.js";

import {print, assert, T} from "../common/utils.js";
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

    // web object of [Node] category that represents the physical node this process is running on; since it is taken
    // from root_frame, it has .$frame and .$state attributes which can be accessed in methods
    get node() { return this.root_frame.agent }

    get worker_id() {
        /* Numeric ID (1, 2, 3, ...) of the node's current worker process; 0 for the master process. */
        return Number(process.env.WORKER_ID) || 0
    }

    is_master() { return !this.worker_id}


    async run(opts) {
        let node = await this.init(opts)
        return this.start(node)
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
        return await schemat.load(this.node_id)

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

    async start(node) {
        try {
            await schemat._boot_done()
            schemat._print(`boot done`)
            await this.start_agents(node)
        }
        catch (ex) {
            schemat._print_error(`start() of node process FAILED with`, ex)
        }
    }

    async start_agents(node) {
        // start this node's own agent
        let role = this.is_master() ? '$master' : '$worker'
        this.root_frame = await this.start_agent(this.node_id, role, {fid: null})
        assert(this.frames.size === 1)
        assert(this.root_frame.agent)

        // agents to be started at this process
        let agents = node.agents.filter(({worker}) => worker === this.worker_id)

        // start ordinary agents
        for (let {id, role, fid} of agents) {
            assert(id)
            assert(fid)
            role ??= AgentRole.GENERIC
            await this.start_agent(id, role, {fid})
        }
    }

    async start_agent(id, role, {fid, migrate} = {}) {
        if (this.frames.has([id, role])) throw new Error(`agent [${id}] in role ${role} is already running`)
        role ??= AgentRole.GENERIC                  // "$agent" role is the default for running agents

        try {
            let agent = await schemat.get_loaded(id)
            if (migrate) await agent.__migrate__(role)

            // schemat._print(`start_agent(): ${agent}`, agent.__content)
            assert(agent.is_loaded())
            assert(agent instanceof Agent)

            // if (!fid && fid !== null) fid = Frame.generate_fid()
            let frame = new Frame(agent, role, fid)
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

        let timeout = 3
        if (cluster.isPrimary) schemat._print(`Received kill signal, shutting down gracefully in approx. ${timeout} seconds...`)

        setTimeout(() => {
            // why()
            schemat._print(`exceeded timeout of ${timeout} seconds, shutting down forcefully`)
            process.exit(1)
        }, timeout * 1000)

        this.workers?.map(worker => worker.kill())

        if (cluster.isPrimary)
            await Promise.all(this.workers.map(worker => new Promise((resolve, reject) => {
                worker.on('exit', resolve)
                worker.on('error', reject)
            })))

        try {
            let frames = [...this.frames.values()].reverse()
            await Promise.all(frames.map(f => f.stop()))
        }
        catch (ex) {
            if (!(ex instanceof StoppingNow)) throw ex
        }

        schemat._print(`process closed`)
        process.exit(0)
    }

    async stop_agent(id, role = AgentRole.ANY) {
        // return Promise.all([...this.frames.values()].reverse().map(frame => frame.stop()))
        if (role === AgentRole.ANY) {
            let frames = this.frames._frames_by_id.get(id) || []
            this.frames._frames_by_id.delete(id);
            [...this.frames.keys()].forEach(key => key[0] === id && this.frames.delete(key))
            for (let frame of frames.reverse()) await frame.stop()
            return
        }

        let frame = this.frames.get([id, role])
        if (!frame) throw new Error(`no frame to stop for [${id}].${role} agent`)
        this.frames.delete([id, role])
        await frame.stop()
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

    async start(node) {
        schemat._print(`starting node:`, node.id)
        await super.start(node)
        this._start_workers(node.num_workers)
        // TODO: rearrange agents and save back to boot DB if they don't fit in `num_workers` workers
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
        worker.mailbox = new IPC_Mailbox(worker, msg => this.node.rpc_send(msg))    // IPC messages from `worker` to master
        return worker
    }

    // async _start_agents(agents) {
    //     /* Inform worker processes what `agents` to start. */
    //     let num_workers = this.workers.length
    //     for (let {worker, id, role} of agents) {
    //         assert(id)
    //         role ??= AgentRole.GENERIC
    //
    //         // adjust the `worker` index if it does not match a valid worker ID (should be in 1,2,...,num_workers)
    //         if (worker < 1 || worker > num_workers) {
    //             let new_worker = (worker-1) % num_workers + 1
    //             this._print(`_start_agents(): adjusted worker process index of agent [${id}] from #${worker} to #${new_worker}`)
    //             worker = new_worker
    //         }
    //
    //         // below, the limited scope='node' for RPC routing is deduced from _xxx() command name
    //         try { await this.node.$worker({worker})._start_agent(id, role) }
    //         catch (ex) {
    //             this.node._print_error(`boot start of agent [${id}].${role} at worker #${worker} FAILED with`, ex)
    //         }
    //     }
    // }
}

/**********************************************************************************************************************/

export class KernelWorker extends Kernel {
    /* Descendant Schemat kernel process that executes agents: web servers, data nodes (blocks), load balancers etc. */

    mailbox     // IPC_Mailbox for communication with the master process

    async start(node) {
        schemat._print(`starting worker #${this.worker_id} (PID=${process.pid})...`)
        this.mailbox = new IPC_Mailbox(process, msg => this.node.rpc_exec(msg))    // IPC requests from master to this worker
        await super.start(node)
    }
}

