import cluster from 'node:cluster'
import fs from 'node:fs'

import "../common/globals.js"           // global flags: CLIENT, SERVER

import {print, assert, T, sleep} from "../common/utils.js";
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

class AgentState {
    agent               // ref to web object
    context             // execution context returned by __start__()
    pending_calls = []  // promises for currently executing concurrent calls on this agent
    stopping = false    // if true, no more RPC calls can be started

    constructor(agent, context = null) {
        this.agent = agent
        this.context = context
    }
    
    track_call(call_promise) {
        /* Create a wrapped promise that removes itself from `pending_calls` when done. */
        let tracked_promise = call_promise.finally(() => {
            this.pending_calls = this.pending_calls.filter(p => p !== tracked_promise)
        })
        
        this.pending_calls.push(tracked_promise)
        return tracked_promise
    }
}

export class Process {
    /* Master or worker process that executes message loops of Agents assigned to the current node. */

    agents = new Map()      // AgentState objects for currently running agents, keyed by agent names
    contexts = {}           // execution contexts of currently running agents, keyed by agent names, proxied; derived from `agents`

    constructor(node, opts) {
        this.node = node        // Node web object that represents the physical node this process is running on
        this.opts = opts
        if (!this.is_master()) process.on("message", msg => this.node.from_master(msg))    // let worker process accept messages from master
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
                get: (ctx, prop) => {
                    if (typeof ctx[prop] !== 'function') return ctx[prop]   // use non-function properties directly
                    return function(...args) {
                        if (state.stopping) throw new Error(`agent '${name}' is in the process of stopping`)
                        let call_promise = Promise.resolve(ctx[prop].apply(ctx, args))
                        return state.track_call(call_promise)
                    }
                }
            })
        }
        return contexts
    }

    _print(...args) {
        print(`${this.node.id}/#${this.worker_id}:`, ...args)
    }

    get worker_id() {
        /* Numeric ID (1, 2, 3, ...) of the current worker process of the node; 0 for the master process. */
        return process.env.WORKER_ID || 0
    }

    is_master() { return !this.worker_id}

    async run() {
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
        let current = this.agents                       // currently running agents, Map<name, AgentState>
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
            
            if (state.pending_calls.length > 0) {       // wait for pending calls to complete before stopping
                this._print(`waiting for ${state.pending_calls.length} pending calls to agent '${name}' to complete`)
                await Promise.all(state.pending_calls)
            }
            promises.push(state.agent.__stop__(state.context).then(() => this.agents.delete(name)))
        }

        // refresh agents
        for (let name of to_refresh) {
            let state = current.get(name)
            let agent = state.agent.refresh()
            if (agent.__ttl_left() < 0) agent = await agent.reload()
            if (agent === state.agent) continue

            next.set(name, state)
            promises.push(agent.__restart__(state.context, state.agent).then(ctx => state.context = ctx))

            // TODO: before __start__(), check for changes in external props and invoke setup.* triggers to update the environment & the installation
            //       and call explicitly __stop__ + triggers + __start__() instead of __restart__()
        }

        // start new agents
        for (let name of to_start) {
            let agent = agents.get(name)
            this._print(`starting agent '${name}'`)
            if (!agent.is_loaded() || agent.__ttl_left() < 0) agent = await agent.reload()
            promises.push(agent.__start__().then(ctx => next.set(name, new AgentState(agent, ctx))))
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
       web server(s), data server(s), load balancer etc.
     */
    workers         // array of Node.js Worker instances (child processes); only present in the primary process
    running         // the Promise returned by .run() of the `server`
    worker_pids     // PID to WORKER_ID association

    async start(opts) {
        // node = schemat.get_loaded(this_node_ID)
        // return node.activate()     // start the life-loop and all worker processes (servers)

        // let m = await schemat.import('/$/local/schemat/test/temp1.js')
        // print('loaded:', m)
        // let {WebServer} = await schemat.import('/$/local/schemat/server/agent.js')

        print('MasterProcess.start() WORKER_ID:', process.env.WORKER_ID || 0)
        await boot_schemat(opts)
        this.opts = opts

        process.on('SIGTERM', () => this.stop())        // listen for TERM signal, e.g. kill
        process.on('SIGINT', () => this.stop())         // listen for INT signal, e.g. Ctrl+C

        let node_id = opts.node || this._read_node_id()
        let Node = await schemat.import('/$/sys/Node')

        if (node_id) {
            if (cluster.isPrimary) print(`starting node:`, node_id)
            this.node = await schemat.load(node_id)
        }
        else {
            assert(!cluster.isPrimary, 'unexpected error: a new Node object should only be created in the primary process, not in a worker')
            this.node = await Node.new().save({ring: 'db-site'})
            fs.writeFileSync('./schemat/node.id', this.node.id.toString())
            print(`created new node:`, this.node.id)
        }
        assert(this.node)

        if (cluster.isPrimary) {                // in the primary process, start the workers...
            this._start_workers()
            schemat.process = this
        }
        else {                                  // in the worker process, start this worker's Process instance
            print(`starting worker #${this.worker_id} (PID=${process.pid})...`)
            schemat.process = new Process(this.node, this.opts)
        }
        this.running = schemat.process.run()
    }

    _read_node_id() {
        try { return Number(fs.readFileSync('./schemat/node.id', 'utf8').trim()) }
        catch (ex) { print('node ID not found') }
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
        worker.on("message", msg => this.node.from_worker(msg))             // let master process accept messages from `worker`
        return worker
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
}

