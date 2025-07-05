import fs from 'node:fs'
import cluster from 'node:cluster'
import {AsyncLocalStorage} from 'node:async_hooks'
import yaml from 'yaml'

import "../common/globals.js"           // global flags: CLIENT, SERVER

import {print, assert, T, sleep, fluctuate} from "../common/utils.js";
import {CustomMap} from "../common/structs.js";
import {ServerSchemat} from "../core/schemat_srv.js";
import {BootDatabase} from "../db/db.js";
import {Agent} from "./agent.js";
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
        rings.forEach(ring => { ring.readonly ??= true })
        await db.open(rings)
        await db.load()             // run __load__() and activate the database object
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
    agent_id
    agent               // web object that created this frame, replaced with a new reference on every refresh
    role                // name of the role this agent is running in
    state               // state object returned by agent.__start__()

    calls = []          // promises for currently executing (concurrent) calls on this agent
    exclusive           // if true in a given moment, any new call to this agent will wait until existing calls terminate; configured by lock() on per-call basis

    starting            // a Promise that gets resolved when .state is assigned after the agent's __start__() is finished; false after that
    paused              // after the agent was paused with $agent.pause(), `paused` contains a Promise that will be resolved by $agent.resume()
    stopping            // if true, the agent is stopping now and no more requests/calls should be accepted
    stopped             // if true, the agent is permanently stopped and should not be restarted even after node restart unless explicitly requested by its creator/supervisor [UNUSED]
    migrating_to        // node ID where this agent is migrating to right now; all new requests are forwarded to that node

    restart_timeout     // timeout for agent's scheduled restart

    constructor(agent, role) {
        this.agent = agent
        this.role = role

        let _resolve
        this.starting = new Promise(resolve => {_resolve = resolve})
        this.starting.resolve = _resolve
    }

    set_state(state) {
        /* Remember the `state` (can be null/undefined) in this.state and mark the agent's starting phase has finished. */
        this.state = state
        this.starting?.resolve?.()
        this.starting = false
    }

    async start() {
        /* Start this.agent by calling its __start__(). */
        let {agent} = this
        schemat._print(`starting agent ${agent} ...`)

        let state = await agent.app_context(() => agent.__start__(this)) || {}
        this.set_state(state)
        await this._schedule_restart()

        schemat._print(`starting agent ${agent} done`)
        return state
    }

    async _schedule_restart(boot_ttl = 1.0, randomize_ttl = 0.1) {
        /* Schedule this.restart() execution after the agent's TTL expires.
           If a restart is already scheduled, clear it and re-schedule. 
           After restart, schedule a new restart, unless the agent is stopped.
         */
        if (this.restart_timeout) this._cancel_restart()    // clear any existing scheduled restart
        if (this.stopping) return

        let {agent} = this
        let ttl = agent.__ttl           // it's assumed that __ttl is never missing, although it can be 0.0 during boot
        if (ttl <= 0) ttl = boot_ttl    // restart faster during boot to quickly arrive at a clean version of the object
        ttl = fluctuate(ttl)            // multiply ttl by random factor between 0.9 and 1.0 to spread restarts more uniformly

        // schemat._print(`_schedule_restart() will restart ${agent} after ${ttl.toFixed(2)} seconds; __ttl=${agent.__ttl}`)

        this.restart_timeout = setTimeout(async () => {
            try { await this.restart() }
            catch (ex) { schemat._print(`error restarting agent ${agent}:`, ex) }
            finally {
                if (!this.stopping) await this._schedule_restart()
            }
        }, ttl * 1000)
    }

    _cancel_restart() {
        clearTimeout(this.restart_timeout)
        this.restart_timeout = null
    }

    async restart() {
        /* Replace the agent with its newest copy after reload and call its __restart__(). */
        if (this.stopping || schemat.terminating) return
        let agent

        // LEAK: storing and reloading the agent causes memory leaks in a long run (several hours)
        try { agent = await this.agent.reload() }
        catch (ex) {
            schemat._print(`error reloading agent ${this.agent}:`, ex, `- restart skipped`)
            return
        }
        // if (agent === this.agent) return
        // assert(agent.id === this.agent.id)
        // assert(agent !== this.agent)

        let was_running = !this.paused
        await this.pause()                      // wait for termination of ongoing RPC calls
        if (this.stopping) return

        schemat._print(`restarting agent ${agent} ...`)
        try {
            let restart = () => agent.__restart__(this.state, agent)
            let state = await this._tracked(agent.app_context(() => this._frame_context(agent, restart)))
            this.set_state(state)
            this.agent = agent
        }
        catch (ex) {
            schemat._print(`error restarting agent ${agent}:`, ex, `- using previous instance`)
        }

        if (was_running) await this.resume()    // resume RPC calls unless the agent was already paused
        schemat._print(`restarting agent ${agent} done`)

        // TODO: check for changes in external props; if needed, invoke setup.* triggers to update the environment & installation
        //       and call explicitly __stop__ + triggers + __start__() instead of __restart__()
    }

    async stop() {
        /* Let running calls complete, then stop the agent by calling its __stop__(). */
        this.stopping = true                // prevent new calls from being executed on the agent
        this._cancel_restart()              // clear any scheduled restart of the agent
        let {calls} = this

        if (calls.length > 0) {             // wait for pending calls to complete before stopping
            schemat._print(`waiting for ${calls.length} pending calls to agent ${this.agent} to complete`)
            await Promise.all(calls)
        }
        let {agent} = this
        schemat._print(`stopping agent ${agent} ...`)

        let stop = () => agent.__stop__(this.state)
        await agent.app_context(() => this._frame_context(agent, stop))
        schemat._print(`stopping agent ${agent} done`)
    }

    async pause() {
        /* Await currently running RPC calls and don't start any new calls until resume(). */
        let ongoing = Promise.all(this.calls)
        if (!this.paused) {
            let _resolve
            this.paused = new Promise(resolve => {_resolve = resolve})
            this.paused.resolve = async () => { await ongoing; _resolve() }
        }
        return ongoing
    }

    async resume() {
        /* Resume RPC calls after pause(). If called during the initial phase of pausing, it awaits
           for ongoing calls to return, so it never returns before the preceding pause().
         */
        if (!this.paused) return
        await this.paused.resolve()
        this.paused = false
    }

    async exec(command, args, caller_ctx = schemat.current_context, tx = null, callback = null) {
        /* Call agent's `command` in tracked mode, in a proper app context (own or caller's) + schemat.tx context + agent.__frame context.
         */
        let {agent} = this
        let [method] = this._find_command(agent, command)       // check that `command` is recognized by the agent
        // schemat._print(`exec() of ${this.agent}.${method}(${args}) ...`)

        // wait for the agent to start
        if (this.starting) await this.starting

        // wait for running call(s) to complete if in exclusive mode
        while ((this.exclusive || !agent.__concurrent) && this.calls.length > 0)
            // print(`... ${agent}.${method}() waits for a previous call(s) to complete`)
            await Promise.all(this.calls)

        // handle paused/stopping state
        if (this.paused && command !== 'resume') await this.paused
        if (this.stopping) throw new Error(`agent ${agent} is in the process of stopping`)

        agent = this.agent
        let [_, func] = this._find_command(agent, command)      // `agent` may have been replaced while pausing, the existence of `command` must be verified again
        let callA = () => func.call(agent, this.state, ...args)

        let callB = async () => {
            // agent._print(`exec() of ${method}(${args}) context=${schemat.current_context}`)
            let result = await this._tracked(this._frame_context(agent, callA))
            return callback ? callback(result) : result
        }

        return agent.app_context(tx ? () => schemat.in_transaction(callB, tx, false) : callB, caller_ctx)
            .catch(ex => {
                agent._print(`exec() of ${method}(${args}) FAILED:`, ex)
                throw ex
            })
    }

    _find_command(agent, command) {
        /* Find implementation of `command` in the agent and return as a pair [method-name, method-function]. */
        let method = `${this.role}.${command}`
        let func = agent.__self[method]
        if (typeof func !== 'function') {
            // generic $agent.*() method is used as a fallback when there's no role-specific implementation of the `command`
            method = `${schemat.GENERIC_ROLE}.${command}`
            func = agent.__self[method]
        }
        if (typeof func !== 'function') throw new Error(`command "${command}" not recognized by agent ${agent}`)
        return [method, func]
    }

    _frame_context(agent, call) {
        /* Run call() on `agent` in the context of this frame (agent.__frame/$frame/$state is set up). */
        agent.__frame ??= new AsyncLocalStorage()
        return agent.$frame === this ? call() : agent.__frame.run(this, call)
    }

    async _tracked(promise) {
        /* Track the running call represented by `promise` by saving it in this.calls and removing upon its completion. */
        if (!(promise instanceof Promise)) return promise

        // create a wrapper promise that removes itself from `calls` when done
        let tracked = promise.finally(() => {
            this.calls = this.calls.filter(p => p !== tracked)
        })
        this.calls.push(tracked)
        return tracked
    }

    async lock(fn = null) {
        /* Run `fn` function inside a one-time exclusive lock (no other agent methods are executed concurrently with `fn`);
           or wait until all calls to this agent are completed, set exclusive mode on to prevent concurrent calls,
           and return `unlock` function to be used to exit the exclusive mode. Usage inside an agent object:

           1)  let result = this.$frame.lock(() => {...})
           or
           2)  let unlock = await this.$frame.lock()
               ...
               unlock()

           Note that lock() must NOT be preceded by any asynchronous instruction (await), nor be used in recursive RPC methods,
           as both these cases will cause a deadlock. Ideally, lock() should be the first instruction in the method body.
         */
        if (this.exclusive) throw new Error(`another call is already executing in exclusive lock`)

        this.exclusive = true
        while (this.calls.length > 0)
            await Promise.all(this.calls)

        let unlock = () => {this.exclusive = false}
        if (!fn) return unlock

        try { return await fn() }
        finally { unlock() }
    }

    // switch_context(callback)     -- execute callback() in originator's not agent's context; for use inside agent methods


    /*** Serialization ***/

    get_status() {      // will be needed for persisting the current list of node.$state.agents to DB
        return {
            id:             this.agent_id,
            role:           this.role,
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

    // booting = new Promise(resolve => this._booting_resolve = resolve)   // resolves when the kernel is fully booted; false after that

    node_id                     // ID of `node`
    node                        // web object of [Node] category that represents the physical node this process is running on
    frames = new FramesMap()    // Frames of currently running agents, keyed by agent IDs
    root_frame                  // frame that holds the running `node` agent
    _closing                    // true if .stop() was called and the process is shutting down right now

    // get node() { return this.root_frame.agent }  //|| this._node }

    get worker_id() {
        /* Numeric ID (1, 2, 3, ...) of the node's current worker process; 0 for the master process. */
        return process.env.WORKER_ID || 0
    }

    is_master() { return !this.worker_id}


    async run(opts) {
        await this.init(opts)
        return this.start()
    }

    async init(opts) {
        print('Kernel WORKER_ID:', process.env.WORKER_ID || 0)

        process.on('SIGTERM', () => this.stop())        // listen for TERM signal, e.g. kill
        process.on('SIGINT', () => this.stop())         // listen for INT signal, e.g. Ctrl+C

        // let m = await schemat.import('/$/local/schemat/test/temp1.js')
        // print('loaded:', m)
        // let {WebServer} = await schemat.import('/$/local/schemat/server/agent.js')

        schemat.set_kernel(this)
        this.node_id = Number(opts['node'].split('.').pop())
        this.node = await schemat.load(this.node_id)

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
        await schemat._boot_done()
        await this.start_node_agent()
    }

    async start_node_agent() {
        // start this node's own agent and all agents in workers
        let role = this.is_master() ? '$master' : '$worker'
        let {state} = this.root_frame = await this.start_agent(this.node_id, role)
        assert(this.frames.size === 1)

        // on master, wait for other agents (in child processes) to start; only then the TCP receiver can be started, as the last step of boot up
        if (this.is_master()) {
            await state.starting_agents
            // await tcp_receiver.start(this.node.tcp_port)
            // this._boot_done()
        }

        // await schemat._erase_registry()
    }

    async start_agent(id, role) {
        if (this.frames.has([id, role])) throw new Error(`agent [${id}] in role ${role} is already running`)

        let agent = await schemat.get_loaded(id)
        role ??= schemat.GENERIC_ROLE           // "$agent" role is the default for running agents

        // schemat._print(`start_agent(): ${agent}`, agent.__content)
        assert(agent.is_loaded())
        assert(agent instanceof Agent)

        let frame = new Frame(agent, role)
        this.frames.set([id, role], frame)      // the frame must be assigned to `frames` already before .start()
        await frame.start()
        return frame
    }

    async stop() {
        if (this._closing) return
        this._closing = true

        let delay = this.node.agent_refresh_interval
        if (cluster.isPrimary) schemat._print(`Received kill signal, shutting down gracefully in approx. ${delay} seconds...`)

        let timeout = 2 * delay         // exceeding this timeout may indicate a deadlock in one of child processes
        setTimeout(() => {throw new Error(`exceeded timeout of ${timeout} seconds for shutting down`)}, timeout * 1000)

        this.workers?.map(worker => worker.kill())

        if (cluster.isPrimary)
            await Promise.all(this.workers.map(worker => new Promise((resolve, reject) => {
                worker.on('exit', resolve)
                worker.on('error', reject)
            })))

        await this.stop_agents()
        schemat._print(`process closed`)
        process.exit(0)
    }

    async stop_agents() {
        /* Stop all agents. Do it in reverse order, because newer agents may depend on the older ones. */
        for (let [[id, role], frame] of [...this.frames.entries()].reverse()) {
            await frame.stop()
            this.frames.delete([id, role])
        }
    }
}

/**********************************************************************************************************************/

export class MasterProcess extends Kernel {
    /* Top-level Schemat kernel process that manages a given node. Spawns and manages worker processes. */

    workers         // array of Node.js Worker instances (child processes); each item has .mailbox (IPC_Mailbox) for communication with this worker
    worker_pids     // PID to WORKER_ID association

    get_worker(process_id) {
        assert(process_id >= 1)
        assert(process_id <= this.workers.length, `worker #${process_id} is not present`)
        return this.workers[process_id - 1]     // workers 1,2,3... stored under indices 0,1,2...
    }

    async start() {
        print(`starting node:`, this.node_id)
        this._start_workers()
        // await sleep(2.0)            // wait for workers to start their IPC before sending requests
        await super.start()
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

    async start() {
        print(`starting worker #${this.worker_id} (PID=${process.pid})...`)
        this.mailbox = new IPC_Mailbox(process, msg => this.node.ipc_worker(msg))    // IPC requests from master to this worker
        // await sleep(3.0)            // wait for master to provide an initial list of agents; delay here must be longer than in MasterProcess.start()
        await super.start()
    }
}

