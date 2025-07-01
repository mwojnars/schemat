import fs from 'node:fs'
import cluster from 'node:cluster'
import {AsyncLocalStorage} from 'node:async_hooks'
import yaml from 'yaml'

import "../common/globals.js"           // global flags: CLIENT, SERVER

import {print, assert, T, sleep} from "../common/utils.js";
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

        let state = await agent.in_context(() => agent.__start__(this)) || {}
        this.set_state(state)
        // this._schedule_restart()

        schemat._print(`starting agent ${agent} done`)
        return state
    }

    _schedule_restart(fallback_ttl = 10.0) {
        /* Schedule this.restart() execution after the agent's TTL expires.
           If a restart is already scheduled, clear it and re-schedule. 
           After restart, schedule a new restart, unless the agent is stopped.
         */
        if (this.restart_timeout) {                // clear any existing scheduled restart
            clearTimeout(this.restart_timeout)
            this.restart_timeout = null
        }
        if (this.stopping) return

        let ttl = this.agent.__ttl ?? fallback_ttl
        if (ttl <= 0) ttl = 0

        this.restart_timeout = setTimeout(async () => {
            try { await this.restart() }
            catch (err) {
                schemat._print(`error restarting agent ${this.agent}:`, err)
            }
            finally { this._schedule_restart() }
        }, ttl * 1000)
    }

    async restart(agent = null) {
        /* Replace this.agent with its newer copy, `agent` or this.agent reloaded, and call its __restart__(). */
        agent ??= this.agent.reload()
        if (agent === this.agent) return
        assert(agent.id === this.agent.id)

        let was_running = !this.paused
        await this.pause()                      // wait for termination of ongoing RPC calls
        if (this.stopping) return

        schemat._print(`restarting agent ${agent} ...`)
        let restart = () => agent.__restart__(this.state, this.agent)
        let state = await this._tracked(agent.in_context(() => this._frame_context(restart)))

        this.set_state(state)
        this.agent = agent
        if (was_running) await this.resume()    // resume RPC calls, unless the agent was paused initially

        schemat._print(`restarting agent ${agent} done`)
        return state
    }

    async stop() {
        /* Let running calls complete, then stop the agent by calling its __stop__(). */
        this.stopping = true                // prevent new calls from being executed on the agent
        let {agent, calls} = this

        if (calls.length > 0) {             // wait for pending calls to complete before stopping
            schemat._print(`waiting for ${calls.length} pending calls to agent ${agent} to complete`)
            await Promise.all(calls)
        }
        schemat._print(`stopping agent ${agent} ...`)

        let stop = () => agent.__stop__(this.state)
        await agent.in_context(() => this._frame_context(stop))
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
        let [method] = this._find_command(command)      // check that `command` is recognized by the agent
        // print(`calling agent ${this.agent}.${method}()`)

        // wait for the agent to start
        if (this.starting) await this.starting

        // wait for running call(s) to complete if in exclusive mode
        while ((this.exclusive || !this.agent.__concurrent) && this.calls.length > 0)
            // print(`... ${agent}.${method}() waits for a previous call(s) to complete`)
            await Promise.all(this.calls)

        // handle paused/stopping state
        if (this.paused && command !== 'resume') await this.paused
        if (this.stopping) throw new Error(`agent ${this.agent} is in the process of stopping`)

        let {agent, state} = this;
        let [_, func] = this._find_command(command)     // `agent` may have been replaced while pausing, the existence of `command` must be verified again
        let callA = () => func.call(agent, state, ...args)

        let callB = async () => {
            // agent._print(`exec(${method}) context=${schemat.current_context}`)
            let result = await this._tracked(this._frame_context(callA))
            return callback ? callback(result) : result
        }
        return agent.in_context(tx ? () => schemat.in_transaction(callB, tx, false) : callB, caller_ctx)
    }

    _find_command(command) {
        /* Find implementation of `command` in the agent and return as a pair [method-name, method-function]. */
        let method = `${this.role}.${command}`
        let func = this.agent.__self[method]
        if (typeof func !== 'function') {
            // generic $agent.*() method is used as a fallback when there's no role-specific implementation of the `command`
            method = `${schemat.GENERIC_ROLE}.${command}`
            func = this.agent.__self[method]
        }
        if (typeof func !== 'function') throw new Error(`command "${command}" not recognized by agent ${this.agent}`)
        return [method, func]
    }

    _frame_context(call) {
        /* Run call() in the context (agent.__frame/$frame/$state) of this frame. */
        let {agent} = this
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
            id:             this.agent.id,
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

    node                        // Node web object that represents the Schemat cluster node this process is running
    frames = new FramesMap()    // Frames of currently running agents, keyed by agent IDs
    root_frame                  // frame that holds the running `node` agent
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
        await this._stop_agents()

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

    // _boot_done() {
    //     this._booting_resolve()     // resolve this.booting promise and replace it with false
    //     this.booting = false
    // }

    async main() {
        /* Start/stop agents. Refresh agent objects and the `node` object itself. */

        // start this node's own agent and all agents in workers
        let role = this.is_master() ? '$master' : '$worker'
        let {state} = this.root_frame = await this.start_agent(this.node, role)
        assert(this.frames.size === 1)

        // on master, wait for other agents (in child processes) to start; only then the TCP receiver can be started, as the last step of boot up
        if (this.is_master()) {
            await state.starting_agents
            // await tcp_receiver.start(this.node.tcp_port)
            // this._boot_done()
        }

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

            // if (this._closing) {
            //     await this._stop_agents()
            //     if (this.frames.size) continue; else break
            // }

            for (let frame of this.frames.values())                 // refresh/reload agents if needed
                await this.refresh_agent(frame)

            let passed = (Date.now() - beginning) / 1000
            let offset_sec = 1.0                                    // the last 1 sec of each iteration is spent on refreshing/reloading the objects

            let remaining = this.node.agent_refresh_interval - offset_sec - passed
            if (remaining > 0) await sleep(remaining);

            if (!this.frames.size) break        // stop the loop when no more running agents

            let agents = Array.from(this.frames.values(), frame => frame.agent);
            [this.node, ...agents].map(obj => obj.refresh())        // schedule a reload of relevant objects in the background, for next iteration
            await sleep(offset_sec)
        }

        this._print(`process closed`)
    }

    async start_agent(obj, role) {
        let agent = schemat.as_object(obj)
        role ??= schemat.GENERIC_ROLE           // "$agent" role is the default for running agents

        if (this.frames.has([agent.id, role])) throw new Error(`agent ${agent} in role ${role} is already running`)
        if (!agent.is_loaded() || agent.__ttl_left() < 0) agent = await agent.reload()

        // this._print(`start_agent(): ${agent}`, agent.__content)
        assert(agent.is_loaded())
        assert(agent instanceof Agent)

        let frame = new Frame(agent, role)
        this.frames.set([agent.id, role], frame)    // the frame must be assigned to `frames` already before __start__()
        await frame.start()
        return frame
    }

    async refresh_agent(frame) {
        let agent = frame.agent.refresh()
        if (agent.__ttl_left() < 0) agent = await agent.reload()

        // no need to restart the agent if it's still the same object after refresh
        if (agent !== frame.agent) return frame.restart(agent)

        // TODO: check for changes in external props; if any, invoke setup.* triggers to update the environment & installation
        //       and call explicitly __stop__ + triggers + __start__() instead of __restart__()
    }

    async stop_agent(id, role) {
        let frame = this.frames.get([id, role])
        await frame.stop()
        this.frames.delete([id, role])
    }

    async _stop_agents() {
        /* When closing, let the currently running agents gently stop. */
        for (let [id, role] of [...this.frames.keys()].reverse())
            await this.stop_agent(id, role)
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

