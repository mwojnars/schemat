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

export class Process {
    /* Master or worker process that executes message loops of Agents assigned to the current node. */

    agents = []     // Agent objects that are currently running in this process
    state  = {}     // {agent_name: state}, current states of execution of the agents running in this process

    constructor(node, opts) {
        this.node = node        // Node web object that represents the physical node this process is running on
        this.opts = opts
    }

    _print(...args) {
        print(`${this.node.id}/#${schemat.worker_id}:`, ...args)
    }

    async run() {
        /* Start/stop loop of active agents. */
        while (true) {
            let beginning = Date.now()
            // this.node = this.node.refresh()

            let new_node = this.node.refresh()
            if (new_node.__ttl_left() < 0) new_node = await new_node.reload()

            // if (new_node !== this.node) print(`worker ${schemat.worker_id}: node replaced, ttl left = ${new_node.__ttl_left()}`)
            // else print(`worker ${schemat.worker_id}: node kept, ttl left = ${this.node.__ttl_left()}`)

            this.node = new_node
            this.agents = await this._start_stop()

            if (schemat.is_closing)
                if (this.agents.length) continue; else break        // let the currently-running agents gently stop

            let passed = (Date.now() - beginning) / 1000
            let offset_sec = 1.0                                    // the last 1 sec of each iteration is spent on refreshing/reloading the objects

            let remaining = this.node.refresh_interval - offset_sec - passed
            if (remaining > 0) await sleep(remaining);

            [this.node, ...this.agents].map(obj => obj.refresh())   // schedule a reload of relevant objects in the background, for next iteration
            await sleep(offset_sec)
        }

        this._print(`process closed`)
    }

    async _start_stop() {
        /* In each iteration of the main loop, start/stop the agents that should (or should not) be running now. */
        let current = this.agents
        let agents = this._get_agents_running()     // agents that *should* be running now on this process (possibly need to be started)

        if (schemat.is_closing) {
            agents = []         // enforce clean shutdown by stopping all agents
            this._print(`closing and stopping all agents`)
        }

        let agent_ids = agents.map(agent => agent.id)
        let current_ids = current.map(agent => agent.id)

        let to_stop = current.filter(agent => !agent_ids.includes(agent.id))
        let to_start = agents.filter(agent => !current_ids.includes(agent.id))
        let to_refresh = current.filter(agent => agent_ids.includes(agent.id))

        let promises = []
        let next = []                               // agents started in this loop iteration, or already running

        // find agents in `current` that are not in `agents` and need to be stopped
        for (let agent of to_stop.toReversed()) {       // iterate in reverse order as some agents may depend on previous ones
            this._print('will stop agent', agent.id)
            let state = this.state.agent
            promises.push(agent.__stop__(agent.__state).then(() => {delete agent.__self.__state}))
        }

        // find agents in `current` that are still in `agents` and need to be refreshed
        for (let prev of to_refresh) {
            let agent = prev.refresh()
            if (agent.__ttl_left() < 0) agent = await agent.reload()
            next.push(agent)
            if (agent === prev) continue
            promises.push(agent.__restart__(prev.__state, prev).then(state => agent.__self.__state = state))

            // TODO: before __start__(), check for changes in external props and invoke setup.* triggers to update the environment & the installation
            //       and call explicitly __stop__ + triggers + __start__() instead of __restart__()
            // promises.push(prev.__stop__(prev.__state).then(async () => agent.__self.__state = await agent.__start__()))
        }

        // find agents in `agents` that are not in `current` and need to be started
        for (let agent of to_start) {
            this._print('will start agent', agent.id)
            if (!agent.is_loaded() || agent.__ttl_left() < 0) agent = await agent.reload()
            next.push(agent)
            promises.push(agent.__start__().then(state => agent.__self.__state = state))
            // promises.push(agent.load().then(async agent => agent.__self.__state = await agent.__start__()))
        }

        await Promise.all(promises)
        return next
    }

    _get_agents_running() {
        /* List of agents that should be running now on this process. When an agent is to be stopped, it should be first removed from this list. */
        return schemat.worker_id ? this.node.agents_running : this.node.master_agents_running   // master process has its own list of agents
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
            print(`starting worker #${schemat.worker_id} (PID=${process.pid})...`)
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
}

