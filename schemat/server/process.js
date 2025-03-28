import cluster from 'node:cluster'
import fs from 'node:fs'
import {AsyncLocalStorage} from 'node:async_hooks'

import "../common/globals.js"           // global flags: CLIENT, SERVER

import {print, assert, T, sleep} from "../common/utils.js";
import {ServerSchemat} from "../core/schemat_srv.js";
import {Database, BootDatabase} from "../db/db.js";
import {Agent} from "./agent.js";
import {IPC_Mailbox} from "./node.js";


// print NODE_PATH:
// console.log('NODE_PATH:', process.env.NODE_PATH)


/**********************************************************************************************************************/

export async function boot_schemat(opts, callback) {
    /* Create the global `schemat` object and initialize its database. */

    opts.config ??= './schemat/config.yaml'
    let config = await _load_config(opts.config)
    config = {...config, ...opts}
    // print('config:', config)

    // // globalThis.schemat is a getter that reads the current Schemat object from the async store `_schemat`
    // Object.defineProperty(globalThis, 'schemat', {
    //     get() { return this._schemat.getStore() },
    //     enumerable: true
    // })
    // globalThis._schemat = new AsyncLocalStorage()
    // globalThis._schemat.run(new ServerSchemat(config), callback)

    globalThis.schemat = new ServerSchemat(config)
    await schemat.boot(() => _open_bootstrap_db())

    async function _load_config(filename) {
        let fs = await import('node:fs')
        let yaml = (await import('yaml')).default
        let content = fs.readFileSync(filename, 'utf8')
        return yaml.parse(content)
    }

    async function _open_bootstrap_db() {
        let db = BootDatabase.new()
        let rings = config.bootstrap_rings
        rings.forEach(ring => { if(ring.readonly === undefined) ring.readonly = true })
        await db.open(rings)
        await db.load()             // run __init__() and activate the database object
        return db
    }
}

/**********************************************************************************************************************/

class Frame {
    /* Information about a running agent. */
    agent               // web object that created this frame
    state               // proxied state object that tracks calls
    raw_state           // original unproxied state object returned by agent.__start__()
    calls = []          // promises for currently executing concurrent calls on this agent
    stopping = false    // if true, no more RPC calls can be started

    constructor(agent, state = null) {
        this.agent = agent
        this.set_state(state)
    }
    
    set_state(state) {
        /* Store the raw state and create a proxied version of it for tracking calls */
        this.raw_state = state
        if (!state) return this.state = state
        if (!T.isPlain(state)) throw new Error(`state of ${this.agent.__label} agent must be a plain object`)
        
        let frame = this
        this.state = new Proxy(state, {
            // whenever a function from state (state.fun()) is called, wrap it up with _track_call()
            get: (state, prop) => (typeof state[prop] !== 'function') ? state[prop] : function(...args) {
                if (frame.stopping) throw new Error(`agent ${frame.agent.__label} is in the process of stopping`)
                print(`calling agent ${frame.agent.__label}.state.${prop}() in tracked mode`)
                return frame._track_call(state[prop].apply(state, args))
            }
        })
    }

    call_agent(method, args) {
        /* Call agent's method in tracked mode and pass `state` context as an extra argument. */
        let {agent, state} = this
        let func = agent.__self[method]
        if (!func) throw new Error(`agent ${agent.__label} has no RPC endpoint "${method}"`)

        // print(`calling agent ${agent.__label}.${method}() in tracked mode`)
        return this._track_call(func.call(agent, state, ...args))
    }
    
    _track_call(call) {
        /* Create a wrapped promise that removes itself from `calls` when done. */
        let promise = Promise.resolve(call)
        let tracked = promise.finally(() => {
            this.calls = this.calls.filter(p => p !== tracked)
        })
        this.calls.push(tracked)
        return tracked
    }
}

export class KernelProcess {
    /* Wrapper class around the kernel process. Executes message loops of Agents assigned to the current node
       and performs TCP communication between nodes.
     */

    node                    // Node web object that represents the Schemat cluster node this process is running
    frames = new Map()      // Frame objects of currently running agents, keyed by agent IDs
    agents_running = []     // web objects that should be running now as agents
    _promise                // Promise returned by .main(), kept here for graceful termination in .stop()

    get worker_id() {
        /* Numeric ID (1, 2, 3, ...) of the current worker process of the node; 0 for the master process. */
        return process.env.WORKER_ID || 0
    }

    is_master() { return !this.worker_id}

    _print(...args) { print(`${this.node?.id}/#${this.worker_id}`, ...args) }


    constructor() {
        print('KernelProcess WORKER_ID:', process.env.WORKER_ID || 0)
        process.on('SIGTERM', () => this.stop())        // listen for TERM signal, e.g. kill
        process.on('SIGINT', () => this.stop())         // listen for INT signal, e.g. Ctrl+C
    }

    async init(opts) {
        // node = schemat.get_loaded(this_node_ID)
        // return node.activate()     // start the life-loop and all worker processes (servers)

        // let m = await schemat.import('/$/local/schemat/test/temp1.js')
        // print('loaded:', m)
        // let {WebServer} = await schemat.import('/$/local/schemat/server/agent.js')

        await boot_schemat(opts)

        let node_file = opts['node-file']
        let node_id = opts.node || this._read_node_id(node_file)
        this.node = node_id ? await schemat.load(node_id) : await this._create_node(node_file)
        assert(this.node)
    }

    _read_node_id(path) {
        /* Read from file the ID of the node object to be executed in this local installation. */
        try { return Number(fs.readFileSync(path, 'utf8').trim()) }
        catch (ex) { print('node ID not found in', path) }
    }

    async _create_node(path) {
        if (!cluster.isPrimary) throw new Error('unexpected error: a new Node object should only be created in the primary process, not in a worker')
        let Node = await schemat.import('/$/sys/Node')
        let node = await Node.new().save({ring: '01_site'})
        fs.writeFileSync(path, this.node.id.toString())
        print(`created new node:`, this.node.id)
        return node
    }

    async start() {
        schemat.process = this
        if (this.is_master()) await sleep(2.0)      // master waits for workers to start their IPC before sending requests
        else await sleep(3.0)                       // worker waits for master to provide an initial list of agents
        return this._promise = this.main()
    }

    async stop() {
        if (schemat.is_closing) return
        schemat.is_closing = true

        let node = await this.node.reload()
        let delay = node.agent_refresh_interval

        if (cluster.isPrimary) print(`\nReceived kill signal, shutting down gracefully in approx. ${delay} seconds...`)
        setTimeout(() => process.exit(1), 2 * delay * 1000)

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
        while (true) {
            let beginning = Date.now()
            // this.node = this.node.refresh()

            let new_node = this.node.refresh()
            if (new_node.__ttl_left() < 0) new_node = await new_node.reload()

            // if (new_node !== this.node) print(`worker ${this.worker_id}: node replaced, ttl left = ${new_node.__ttl_left()}`)
            // else print(`worker ${this.worker_id}: node kept, ttl left = ${this.node.__ttl_left()}`)

            this.node = new_node
            await this._start_stop()

            if (schemat.is_closing)
                if (this.frames.size) continue; else break          // let the currently-running agents gently stop

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

    async _start_stop() {
        /* In each iteration of the main loop, start/stop the agents that should (or should not) be running now.
           Update `this.frames` accordingly.
         */
        let current_agents = Array.from(this.frames.values(), frame => frame.agent)     // currently running agents
        let desired_agents = this.is_master() ? [this.node] : [...this.agents_running]  // agents that should be running when this method completes; master process runs the node agent and nothing else

        if (schemat.is_closing) {
            desired_agents = []                                 // enforce clean shutdown by stopping all agents
            this._print(`closing and stopping all agents`)
        }

        // sets of IDs for quick lookup
        let current_ids = current_agents.map(agent => agent.id)
        let desired_ids = desired_agents.map(agent => agent.id)
        let current_set = new Set(current_ids)
        let desired_set = new Set(desired_ids)
        
        let to_stop = current_ids.filter(id => !desired_set.has(id))        // find agents to stop (currently running but not desired)
        let to_start = desired_ids.filter(id => !current_set.has(id))       // find agents to start (desired but not running)
        let to_refresh = current_ids.filter(id => desired_set.has(id))      // find agents to refresh (running and still desired)

        // start new agents
        for (let id of to_start) {
            let agent = schemat.get_object(id)
            if (!agent.is_loaded() || agent.__ttl_left() < 0) agent = await agent.reload()

            // print(`_start_stop():`, agent.id, agent.name, agent.constructor.name, agent.__start__, agent.__data)
            assert(agent.is_loaded())
            assert(agent instanceof Agent)
            this._print(`starting agent ${agent.__label} ...`)

            let state = await agent.__start__()
            this.frames.set(agent.id, new Frame(agent, state))
            this._print(`starting agent ${agent.__label} done`)
        }

        // refresh agents
        for (let id of to_refresh) {
            let frame = this.frames.get(id)
            let agent = frame.agent.refresh()
            if (agent.__ttl_left() < 0) agent = await agent.reload()
            if (agent === frame.agent) continue

            this._print(`restarting agent ${agent.__label} ...`)
            frame.set_state(await agent.__restart__(frame.raw_state, frame.agent))
            frame.agent = agent
            this._print(`restarting agent ${agent.__label} done`)

            // TODO: before __start__(), check for changes in external props and invoke setup.* triggers to update the environment & the installation
            //       and call explicitly __stop__ + triggers + __start__() instead of __restart__()
        }

        // stop agents - still use reverse order as some agents may depend on previous ones
        for (let id of to_stop.reverse()) {
            let frame = this.frames.get(id)
            let {agent, calls} = frame
            frame.stopping = true                       // mark agent as stopping to prevent new calls

            if (calls.length > 0) {                     // wait for pending calls to complete before stopping
                this._print(`waiting for ${calls.length} pending calls to agent ${agent.__label} to complete`)
                await Promise.all(calls)
            }

            this._print(`stopping agent ${agent.__label} ...`)
            await agent.__stop__(frame.raw_state)
            this.frames.delete(agent.id)
            this._print(`stopping agent ${agent.__label} done`)
        }
    }

    set_agents_running(agents) {
        this.agents_running = agents.map(id => schemat.get_object(id))
    }

    // _get_agents_running() {
    //     /* Array of agents that should be running now on this process. */
    //     let master = this.is_master()
    //     return master ? [this.node] : [...this.node.agents_installed]
    //     // return master ? [this.node] : Array.from(this.node.agents_installed.values())
    // }

    // async main() {
    //     for (let {prev, agent, oper, migrate} of actions) {
    //         if (schemat.is_closing) return
    //         if (!oper) continue                     // no action if the agent instance hasn't changed
    //
    //         let state = prev?.__state
    //         let external = (agent || prev)._external_props
    //
    //         // cases:
    //         // 1) install new agent (from scratch):     status == pending_install_fresh   >   installed
    //         // 2) install new agent (from migration):   status == pending_install_clone   >   installed
    //         // 3) migrate agent to another machine:     status == pending_migration & destination   >   installed
    //         // 3) uninstall agent:   status == 'pending_uninstall'
    //         // 4)
    //
    //         if (oper === 'uninstall') {
    //             if (prev.__meta.started) await prev.__stop__(state)
    //             await prev.__uninstall__()
    //
    //             // tear down all external properties that represent/reflect the (desired) state (property) of the environment; every modification (edit)
    //             // on such a property requires a corresponding update in the environment, on every machine where this object is deployed
    //             for (let prop of external) if (prev[prop] !== undefined) prev._call_setup[prop](prev, prev[prop])
    //         }
    //     }
    // }
}

/**********************************************************************************************************************/

export class MasterProcess extends KernelProcess {
    /* Top-level Schemat kernel process running on a given node. Spawns and manages worker processes that execute agents:
       web server(s), data server(s), load balancer etc.
     */
    workers         // array of Node.js Worker instances (child processes); each item has .mailbox (IPC_Mailbox) for communication with this worker
    worker_pids     // PID to WORKER_ID association

    get_worker(process_id) {
        return this.workers[process_id - 1]     // workers 1,2,3... stored under indices 0,1,2...
    }

    async start() {
        print(`starting node:`, this.node.id)
        this._start_workers()
        await super.start()
    }

    _start_workers(num_workers = 2) {
        print(`starting ${num_workers} worker(s) in the master process (PID=${process.pid})...`)

        this.workers = []
        this.worker_pids = new Map()

        for (let i = 0; i < num_workers; i++)
            this._start_worker(i + 1)

        cluster.on('exit', (worker) => {
            if (schemat.is_closing) return
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
        this.worker_pids.set(worker.process.pid, id)                        // remember PID-to-ID mapping
        worker.mailbox = new IPC_Mailbox(worker, msg => this.node.from_worker(msg))     // messages to/from `worker`
        return worker
    }
}

/**********************************************************************************************************************/

export class WorkerProcess extends KernelProcess {
    mailbox     // IPC_Mailbox for communication with the master process

    async start() {
        print(`starting worker #${this.worker_id} (PID=${process.pid})...`)
        this.mailbox = new IPC_Mailbox(process, msg => this.node.from_master(msg))    // messages to/from master
        await super.start()
    }
}

