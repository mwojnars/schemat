import cluster from 'node:cluster'
import fs from 'node:fs'
import yaml from 'yaml'

import "../common/globals.js"           // global flags: CLIENT, SERVER

import {print, assert, T, sleep} from "../common/utils.js";
import {CustomMap} from "../common/structs.js";
import {ServerSchemat} from "../core/schemat_srv.js";
import {BootDatabase} from "../db/db.js";
import {Agent, AgentState} from "./agent.js";
import {IPC_Mailbox} from "./node.js";


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
        let db = BootDatabase.draft()
        let rings = config.bootstrap_rings
        rings.forEach(ring => { if(ring.readonly === undefined) ring.readonly = true })
        await db.open(rings)
        await db.load()             // run __init__() and activate the database object
        return db
    }
}


/**********************************************************************************************************************/

export class FramesMap extends CustomMap {
    /* A Map where keys are id+role strings. */

    _frames_by_id = new Map()    // internal map: id -> list of frames

    convert([id, role]) {
        role ??= schemat.GENERIC_ROLE
        return `${id}_${role}`          // 1234_$agent
    }

    reverse(key) {
        let [id, role] = key.split('_')
        return [Number(id), role]
    }

    set(key, frame) {
        /* Update _frames_by_id in addition to the base mapping by id+role. */
        let [id, role] = key
        let frames = this._frames_by_id.get(id) || []
        frames.push(frame)
        this._frames_by_id.set(id, frames)
        return super.set(key, frame)
    }

    delete(key) {
        /* Update _frames_by_id in addition to the base mapping by id+role. */
        let [id, role] = key
        let frames = this._frames_by_id.get(id)
        if (frames) {
            let frame = this.get(key)
            frames = frames.filter(f => f !== frame)
            if (frames.length) this._frames_by_id.set(id, frames)
            else this._frames_by_id.delete(id)
        }
        return super.delete(key)
    }

    get_any_role(id, unique = true) {
        /* Return any frame that has a given agent ID, no matter the role. */
        let frames = this._frames_by_id.get(id)
        if (frames)
            if (unique && frames.length > 1) throw new Error(`multiple frames found for agent [${id}]`)
            else return frames[0]
    }
}

class Frame {
    /* State (internal variables) and status of a running agent. */
    agent               // web object that created this frame, replaced with a new reference on every refresh
    state               // AgentState object wrapped around or returned by agent.__start__()

    calls = []          // promises for currently executing concurrent calls on this agent
    exclusive           // if true in a given moment, any new call to this agent will wait until existing calls terminate; configured by lock() on per-call basis

    paused              // if true, the agent should not execute now but can be resumed without restarting by $agent.resume()
    stopping            // if true, the agent should be stopping now and no more requests/calls are accepted
    stopped             // if true, the agent is permanently stopped and should not be restarted even after node restart unless explicitly requested by its creator/supervisor [UNUSED]
    migrating_to        // node ID where this agent is migrating to right now; all new requests are forwarded to that node

    constructor(agent, state = null) {
        this.agent = agent
        if (state !== null) this.set_state(state)
    }
    
    set_state(state) {
        /* Store the raw state and create a proxied version of it for tracking calls */
        state ??= new AgentState()
        
        // wrap state in AgentState if needed
        if (T.isPlain(state)) state = Object.assign(new AgentState(), state)
        else if (!(state instanceof AgentState))
            throw new Error(`state of ${this.agent} agent must be an AgentState instance or a plain object (no class), got ${state}`)

        state.__frame = this
        this.state = state
    }

    async call_agent(method, args, caller_ctx = schemat.current_context, caller_tx = null, callback = null) {
        let {agent} = this
        let ctx = agent.switch_context ? caller_ctx : agent.__ctx
        let call = async () => {
            let result = await this._call_agent(method, args)
            return callback ? callback(result) : result
        }
        return schemat.in_context(ctx, caller_tx ? () => schemat.in_transaction(caller_tx, call) : call)
        // return schemat.in_context(ctx, () => this._call_agent(method, args))
    }

    async _call_agent(method, args, pause_delay = 1.0 /*seconds*/) {
        /* Call agent's `method` in tracked mode, in a proper app context (caller's or own), passing the state as an extra argument. */
        let {agent, state} = this

        if (this.stopping) throw new Error(`agent ${agent} is in the process of stopping`)
        while (this.paused && !method.endsWith('.resume')) await sleep(pause_delay)

        let func = agent.__self[method]
        if (!func) throw new Error(`agent ${agent} has no RPC endpoint "${method}"`)
        // print(`calling agent ${agent}.${method}()`)

        while ((this.exclusive || state.__exclusive) && this.calls.length > 0) {
            // print(`... ${agent}.${method}() waits for a previous call(s) to complete`)
            await Promise.all(this.calls)
        }

        let result = func.call(agent, state, ...args)
        if (!(result instanceof Promise)) return result

        // if `result` is a Promise, create a wrapper that removes itself from `calls` when done
        let tracked = result.finally(() => {
            this.calls = this.calls.filter(p => p !== tracked)
        })
        this.calls.push(tracked)
        return tracked
    }

    async lock() {
        /* Set per-call exclusive mode and wait until all calls to this agent are completed. */
        this.exclusive = true
        while (this.calls.length > 0)
            await Promise.all(this.calls)
    }

    unlock() {
        /* Exit the per-call exclusive mode. */
        delete this.exclusive
    }

    /*** Serialization ***/

    get_status() {
        return {
            id:             this.agent.id,
            role:           this.state.__role,
            options:        this.state.__options,
            stopped:        this.stopped,
            migrating_to:   this.migrating_to,
        }
    }
}

/**********************************************************************************************************************/

export class Kernel {
    /* OS process (master or worker) of a cluster's node. Executes message loops of Agents assigned to the current node,
       performs TCP communication between nodes (if master) and IPC communication with the related master/worker process(es).
       Delegates some other duties to the Node class.
     */

    node                        // Node web object that represents the Schemat cluster node this process is running
    frames = new FramesMap()    // Frames of currently running agents, keyed by agent IDs
    _promise                    // Promise returned by .main(), kept here for graceful termination in .stop()
    _closing                    // true if .stop() was called and the process is shutting down right now

    get worker_id() {
        /* Numeric ID (1, 2, 3, ...) of the node's current worker process; 0 for the master process. */
        return process.env.WORKER_ID || 0
    }

    is_master() { return !this.worker_id}

    _print(...args) { print(`${this.node?.id}/#${this.worker_id}`, ...args) }


    async init(opts) {
        print('Kernel WORKER_ID:', process.env.WORKER_ID || 0)

        process.on('SIGTERM', () => this.stop())        // listen for TERM signal, e.g. kill
        process.on('SIGINT', () => this.stop())         // listen for INT signal, e.g. Ctrl+C

        // let m = await schemat.import('/$/local/schemat/test/temp1.js')
        // print('loaded:', m)
        // let {WebServer} = await schemat.import('/$/local/schemat/server/agent.js')

        schemat.set_kernel(this)

        let node_id = Number(opts['node'].split('.').pop())
        this.node = await schemat.load(node_id)
        assert(this.node)

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

    async start(opts) {}    // implemented in subclasses

    async stop() {
        if (this._closing) return
        this._closing = true

        let node = await this.node.reload()
        let delay = node.agent_refresh_interval

        if (cluster.isPrimary) this._print(`Received kill signal, shutting down gracefully in approx. ${delay} seconds...`)

        let timeout = 2 * delay         // exceeding this timeout may indicate a deadlock in one of child processes
        setTimeout(() => {throw new Error(`exceeded timeout of ${timeout} seconds for shutting down`)}, timeout * 1000)

        if (cluster.isPrimary)
            await Promise.all(this.workers.map(worker => new Promise((resolve, reject) => {
                worker.on('exit', resolve)
                worker.on('error', reject)
                worker.kill()
            })))

        await this._promise
        process.exit(0)
    }

    async main() {
        /* Start/stop agents. Refresh agent objects and the `node` object itself. */

        let role = this.is_master() ? '$master' : '$worker'
        let {starting_agents} = await this.start_agent(this.node, role)     // start this node's own agent to enable internode communication
        await starting_agents                                               // on master, wait for other agents (in child processes) to start

        // this._print(`Kernel.main() frames.keys:`, [...this.frames.keys()])
        await sleep(this.node.agent_refresh_interval || 10)         // avoid reloading the agents immediately after creation

        while (true) {
            let beginning = Date.now()
            // this.node = this.node.refresh()

            let new_node = this.node.refresh()
            if (new_node.__ttl_left() < 0) new_node = await new_node.reload()

            // if (new_node !== this.node) print(`worker ${this.worker_id}: node replaced, ttl left = ${new_node.__ttl_left()}`)
            // else print(`worker ${this.worker_id}: node kept, ttl left = ${this.node.__ttl_left()}`)

            this.node = new_node

            if (schemat.terminating) {                              // if closing, let the currently running agents gently stop
                for (let [id, role] of [...this.frames.keys()].reverse())
                    await this.stop_agent(id, role)
                if (this.frames.size) continue; else break
            }

            for (let frame of this.frames.values())                 // refresh/reload agents if needed
                await this.refresh_agent(frame)

            let passed = (Date.now() - beginning) / 1000
            let offset_sec = 1.0                                    // the last 1 sec of each iteration is spent on refreshing/reloading the objects

            let remaining = this.node.agent_refresh_interval - offset_sec - passed
            if (remaining > 0) await sleep(remaining);

            let agents = Array.from(this.frames.values(), frame => frame.agent);
            [this.node, ...agents].map(obj => obj.refresh())        // schedule a reload of relevant objects in the background, for next iteration
            await sleep(offset_sec)
        }

        this._print(`process closed`)
    }

    async start_agent(obj, role, options) {
        let agent = schemat.as_object(obj)
        this._print(`starting agent ${agent} ...`)
        role ??= schemat.GENERIC_ROLE           // "$agent" role is the default for running agents

        if (this.frames.has([agent.id, role])) throw new Error(`agent ${agent} in role ${role} is already running`)
        if (!agent.is_loaded() || agent.__ttl_left() < 0) agent = await agent.reload()

        // print(`_start_agent():`, agent.id, agent.name, agent.constructor.name, agent.__start__, agent.__data)
        assert(agent.is_loaded())
        assert(agent instanceof Agent)

        let frame = new Frame(agent)
        this.frames.set([agent.id, role], frame)    // the frame must be assigned to `frames` already before __start__() is executed

        let state = await schemat.in_context(agent.__ctx, () => agent.__start__({node: this.node, role, options})) || {}
        state.__role = role
        state.__options = options
        frame.set_state(state)

        this._print(`starting agent ${agent} done`)
        return state
    }

    async refresh_agent(frame) {
        let agent = frame.agent.refresh()

        if (agent.__ttl_left() < 0) agent = await agent.reload()
        if (agent === frame.agent) return       // no need to restart the agent if it's still the same object after refresh

        this._print(`restarting agent ${agent} ...`)
        let prev = frame.state
        let restart = () => agent.__restart__(prev, frame.agent)

        let state = await schemat.in_context(agent.__ctx, restart)
        state.__role = prev.__role
        state.__options = prev.__options

        frame.set_state(state)
        frame.agent = agent
        this._print(`restarting agent ${agent} done`)

        // TODO: before __start__(), check for changes in external props and invoke setup.* triggers to update the environment & the installation
        //       and call explicitly __stop__ + triggers + __start__() instead of __restart__()
    }

    async stop_agent(id, role) {
        let frame = this.frames.get([id, role])
        let {agent, calls} = frame
        frame.stopping = true               // prevent new calls from being executed on the agent

        if (calls.length > 0) {             // wait for pending calls to complete before stopping
            this._print(`waiting for ${calls.length} pending calls to agent ${agent} to complete`)
            await Promise.all(calls)
        }
        this._print(`stopping agent ${agent} ...`)

        let stop = () => agent.__stop__(frame.state)
        await schemat.in_context(agent.__ctx, stop)

        this.frames.delete([id, role])
        this._print(`stopping agent ${agent} done`)
    }
}

/**********************************************************************************************************************/

export class MasterProcess extends Kernel {
    /* Top-level Schemat kernel process that manages a given node. Spawns and manages worker processes. */

    workers         // array of Node.js Worker instances (child processes); each item has .mailbox (IPC_Mailbox) for communication with this worker
    worker_pids     // PID to WORKER_ID association

    get_worker(process_id) {
        assert(process_id >= 1)
        return this.workers[process_id - 1]     // workers 1,2,3... stored under indices 0,1,2...
    }

    async start(opts) {
        await this.init(opts)

        print(`starting node:`, this.node.id)
        this._start_workers()
        // await sleep(2.0)            // wait for workers to start their IPC before sending requests
        await schemat._boot_done()

        await (this._promise = this.main())
    }

    _start_workers(num_workers = 2) {
        print(`starting ${num_workers} worker(s) in the master process (PID=${process.pid})...`)

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
}

/**********************************************************************************************************************/

export class WorkerProcess extends Kernel {
    /* Descendant Schemat kernel process that executes agents: web servers, data nodes (blocks), load balancers etc. */

    mailbox     // IPC_Mailbox for communication with the master process

    async start(opts) {
        await this.init(opts)

        print(`starting worker #${this.worker_id} (PID=${process.pid})...`)
        this.mailbox = new IPC_Mailbox(process, msg => this.node.ipc_worker(msg))    // IPC requests from master to this worker
        // await sleep(3.0)            // wait for master to provide an initial list of agents; delay here must be longer than in MasterProcess.start()
        await schemat._boot_done()

        await (this._promise = this.main())
    }
}

