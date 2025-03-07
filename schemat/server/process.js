import cluster from 'node:cluster'
import fs from 'node:fs'

import "../common/globals.js"           // global flags: CLIENT, SERVER

import {print, assert, T, sleep} from "../common/utils.js";
import {ServerSchemat} from "../core/schemat_srv.js";
import {Database, BootDatabase} from "../db/db.js";
import {Agent} from "./agent.js";
import {IPC_Mailbox} from "./node.js";


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
        let db = BootDatabase.new()
        let rings = config.bootstrap_rings
        rings.forEach(ring => { if(ring.readonly === undefined) ring.readonly = true })
        await db.open(rings)
        await db.load()             // run __init__() and activate the database object
        return db
    }
}

/**********************************************************************************************************************/

class Execution {
    /* Information about a running agent. */
    agent               // ref to web object
    context             // execution context returned by __start__()
    calls = []          // promises for currently executing concurrent calls on this agent
    stopping = false    // if true, no more RPC calls can be started

    constructor(agent, context = null) {
        this.agent = agent
        this.context = context
    }
    
    track_call(call) {
        /* Create a wrapped promise that removes itself from `calls` when done. */
        let promise = Promise.resolve(call)
        let tracked = promise.finally(() => {
            this.calls = this.calls.filter(p => p !== tracked)
        })
        this.calls.push(tracked)
        return tracked
    }
}

export class Process {
    /* Master or worker process that executes message loops of Agents assigned to the current node. */

    node                    // Node web object that represents the Schemat cluster node this process is running
    agents = new Map()      // Execution objects for currently running agents, keyed by agent names
    contexts = {}           // execution contexts of currently running agents, keyed by agent names, proxied; derived from `agents`
    running                 // Promise returned by .loop(), kept here for graceful termination in .stop()

    get worker_id() {
        /* Numeric ID (1, 2, 3, ...) of the current worker process of the node; 0 for the master process. */
        return process.env.WORKER_ID || 0
    }

    is_master() { return !this.worker_id}

    _print(...args) { print(`${this.node?.id}/#${this.worker_id}:`, ...args) }


    async init(opts) {
        // node = schemat.get_loaded(this_node_ID)
        // return node.activate()     // start the life-loop and all worker processes (servers)

        // let m = await schemat.import('/$/local/schemat/test/temp1.js')
        // print('loaded:', m)
        // let {WebServer} = await schemat.import('/$/local/schemat/server/agent.js')

        print('Process.start() WORKER_ID:', process.env.WORKER_ID || 0)
        await boot_schemat(opts)

        process.on('SIGTERM', () => this.stop())        // listen for TERM signal, e.g. kill
        process.on('SIGINT', () => this.stop())         // listen for INT signal, e.g. Ctrl+C

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

    start() {
        schemat.process = this
        this.running = this.loop()
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


    _update_contexts() {
        /* Create a new `contexts` object with proxied agent contexts, so that function calls on the contexts are tracked
           and the agent can be stopped gracefully.
         */
        let contexts = Object.fromEntries(Array.from(this.agents, ([name, state]) => [name, state.context]))
        
        for (let [name, state] of this.agents.entries()) {
            let context = state.context
            if (!context) continue
            if (!T.isPlain(context)) throw new Error(`context for agent '${name}' must be a plain object`)

            this.contexts[name] = new Proxy(context, {
                // whenever a function from context (ctx.fun()) is called, wrap it up with track_call()
                get: (ctx, prop) => (typeof ctx[prop] !== 'function') ? ctx[prop] : function(...args) {
                    if (state.stopping) throw new Error(`agent '${name}' is in the process of stopping`)
                    return state.track_call(ctx[prop].apply(ctx, args))
                }
            })
        }
        return contexts
    }

    async loop() {
        /* Start/stop loop of active agents. */
        while (true) {
            let beginning = Date.now()
            // this.node = this.node.refresh()

            let new_node = this.node.refresh()
            if (new_node.__ttl_left() < 0) new_node = await new_node.reload()

            // if (new_node !== this.node) print(`worker ${this.worker_id}: node replaced, ttl left = ${new_node.__ttl_left()}`)
            // else print(`worker ${this.worker_id}: node kept, ttl left = ${this.node.__ttl_left()}`)

            this.node = new_node
            this.agents = await this._start_stop()
            this.contexts = this._update_contexts()

            if (schemat.is_closing)
                if (this.agents.size) continue; else break          // let the currently-running agents gently stop

            let passed = (Date.now() - beginning) / 1000
            let offset_sec = 1.0                                    // the last 1 sec of each iteration is spent on refreshing/reloading the objects

            let remaining = this.node.refresh_interval - offset_sec - passed
            if (remaining > 0) await sleep(remaining);

            let agents = Array.from(this.agents.values(), state => state.agent);
            [this.node, ...agents].map(obj => obj.refresh())        // schedule a reload of relevant objects in the background, for next iteration
            await sleep(offset_sec)
        }

        this._print(`process closed`)
    }

    async _start_stop() {
        /* In each iteration of the main loop, start/stop the agents that should (or should not) be running now. */
        let current = this.agents                       // currently running agents, Map<name, Execution>
        let agents = this._get_agents_running()         // desired agents, Map<name, agent>

        if (schemat.is_closing) {
            agents = new Map()                          // enforce clean shutdown by stopping all agents
            this._print(`closing and stopping all agents`)
        }

        let current_names = Array.from(current.keys())
        let new_names = Array.from(agents.keys())

        let to_stop = current_names.filter(name => !agents.has(name))    // find agents in `current` that are not in `agents` and need to be stopped
        let to_start = new_names.filter(name => !current.has(name))      // find agents in `agents` that are not in `current` and need to be started
        let to_refresh = current_names.filter(name => agents.has(name))  // find agents in `current` that are still in `agents` and need to be refreshed

        let promises = []
        let next = new Map()                            // agents to continue running

        // stop agents
        for (let name of to_stop.toReversed()) {        // iterate in reverse order as some agents may depend on previous ones
            let state = current.get(name)
            this._print(`stopping agent '${name}'`)
            state.stopping = true                       // mark agent as stopping to prevent new calls
            
            if (state.calls.length > 0) {               // wait for pending calls to complete before stopping
                this._print(`waiting for ${state.calls.length} pending calls to agent '${name}' to complete`)
                await Promise.all(state.calls)
            }
            let stop = Promise.resolve(state.agent.__stop__(state.context))
            promises.push(stop.then(() => this.agents.delete(name)))
        }

        // refresh agents
        for (let name of to_refresh) {
            let state = current.get(name)
            let agent = state.agent.refresh()
            if (agent.__ttl_left() < 0) agent = await agent.reload()
            if (agent === state.agent) continue

            next.set(name, state)
            let restart = Promise.resolve(agent.__restart__(state.context, state.agent))
            promises.push(restart.then(ctx => state.context = ctx))

            // TODO: before __start__(), check for changes in external props and invoke setup.* triggers to update the environment & the installation
            //       and call explicitly __stop__ + triggers + __start__() instead of __restart__()
        }

        // start new agents
        for (let name of to_start) {
            let agent = agents.get(name)
            this._print(`starting agent '${name}'`)
            if (!agent.is_loaded() || agent.__ttl_left() < 0) agent = await agent.reload()

            // print(`_start_stop():`, agent.id, agent.name, agent.constructor.name, agent.__start__, agent.__data)
            assert(agent.is_loaded())
            assert(agent instanceof Agent)

            let start = Promise.resolve(agent.__start__())
            promises.push(start.then(ctx => next.set(name, new Execution(agent, ctx))))
        }

        await Promise.all(promises)
        return next
    }

    _get_agents_running() {
        /* Map of agents that should be running now on this process. */
        let master = this.is_master()
        let names  = master ? this.node.master_agents_running : this.node.agents_running    // different set of agents at master vs workers
        let agents = names.map(name => [name, this.node.agents_installed.get(name)])

        assert(!this.node.agents_installed.has('node'))
        if (master) agents = [['node', this.node], ...agents]       // on master, add the current node as implicit 'node' agent

        return new Map(agents)
    }

    // async loop() {
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

export class MasterProcess extends Process {
    /* Top-level Schemat process running on a given node. Spawns and manages worker processes that execute agents:
       web server(s), data server(s), load balancer etc. On worker nodes, the MasterProcess object is STILL being
       created, because run.js that creates MasterProcess is re-run for every child process, only the initialization
       follows a different path and finally assigns a WorkerProcess to schemat.process - so there are actually two
       Process instances (non-active MasterProcess + active WorkerProcess).
     */
    workers         // array of Node.js Worker instances (child processes); each item has .mailbox (IPC_Mailbox) for communication with this worker
    worker_pids     // PID to WORKER_ID association

    get_worker(process_id) {
        return this.workers[process_id - 1]     // workers 1,2,3... stored under indices 0,1,2...
    }

    start() {
        print(`starting node:`, this.node.id)
        this._start_workers()
        super.start()
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
            print(`worker #${id} (PID=${worker.process.pid}) exited`)
            worker = this._start_worker(id)
            print(`worker #${id} (PID=${worker.process.pid}) restarted`)
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

export class WorkerProcess extends Process {
    mailbox     // IPC_Mailbox for communication with the master process

    start() {
        print(`starting worker #${this.worker_id} (PID=${process.pid})...`)
        this.mailbox = new IPC_Mailbox(process, msg => this.node.from_master(msg))    // messages to/from master
        super.start()
    }
}

