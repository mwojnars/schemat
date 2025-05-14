import {assert, print, timeout, sleep} from '../common/utils.js'
import {JSONx} from "../common/jsonx.js";
import {Catalog} from "../core/catalog.js";
import {WebObject} from "../core/object.js";
import {Agent} from "./agent.js";
import {TCP_Receiver, TCP_Sender} from "./tcp.js";
import {Counter} from "../common/structs.js";


const MASTER = 0        // ID of the master process; workers are numbered 1,2,...,N


/**********************************************************************************************************************/

class Config extends WebObject {
    /* Global server-side configuration that can be defined separately at cluster/node/app/command-line level
       and then combined in a particular Schemat process to control high-level behaviour of the node.
     */
    merge(...others) {
        /* The expected order of `others` is from least to most specific: [node config, app config, command-line config]. */
        let configs = [...others.reverse(), this]
        let catalogs = configs.map(obj => obj.__data || new Catalog(obj))
        return Catalog.merge(catalogs)
    }
}

/**********************************************************************************************************************/

export class Mailbox {
    /* Request-response communication channel from a sender to a receiver built on top of two one-way communication
       channels represented by `_listen()` and `_send()` (to be implemented in subclasses).
       By calling `send()` with a message, the caller gets a promise that will be resolved with the response.
       The promise is rejected if the response is not received within the specified `timeout`.
       Alternatively, the sender may call `notify()` to send a message without waiting for a response.
       Here, "requests" are messages followed by a response, while "notifications" are fire-and-forget messages (no response).
     */

    // constructor(callback, timeout = null) {
    constructor(callback, timeout = 5000) {
        this.callback = callback        // processing function for incoming messages
        this.pending = new Map()        // requests sent awaiting a response
        this.message_id = 0             // last message ID sent

        this.timeout = timeout          // timeout for waiting for a response
        this.timestamps = new Map()     // timestamps for pending requests
        this.interval = timeout ? setInterval(() => this._check_timeouts(), timeout) : null
    }

    send(msg, {wait = true} = {}) {
        /* Send `msg` to the peer. Wait for the response if wait=true. */
        if (!wait) this._send([0, msg])
        else return new Promise((resolve, reject) => {
            let id = ++this.message_id
            if (this.message_id >= Number.MAX_SAFE_INTEGER) this.message_id = 0

            this.pending.set(id, resolve)
            this._send([id, msg])

            if (this.timeout)           // add timeout for safety
                this.timestamps.set(id, {timestamp: Date.now(), reject, msg})
        })
    }

    notify(msg) {
        /* Send a message without waiting for a response (fire-and-forget). */
        this._send([0, msg])
    }

    _check_timeouts() {
        const now = Date.now()
        for (const [id, {timestamp, reject, msg}] of this.timestamps.entries()) {
            if (now - timestamp > this.timeout) {
                this.timestamps.delete(id)
                this.pending.delete(id)
                reject(new Error(`response timeout for message no. ${id}, msg = ${JSON.stringify(msg)}`))
            }
        }
    }

    close() {
        // clear the interval to prevent memory leaks
        if (this.interval) {
            clearInterval(this.interval)
            this.interval = null
        }
    }

    _handle_response([id, result]) {
        id = -id
        if (this.pending.has(id)) {
            this.pending.get(id)(result)        // resolve the promise with the returned result (can be undefined)
            this.pending.delete(id)
            this.timestamps.delete(id)
        }
        else console.warn(`unknown response id: ${id}`)
    }

    async _handle_message([id, msg]) {
        if (id < 0) return this._handle_response([id, msg])     // received a response from the peer

        let result = this.callback(msg)                         // received a message: run the callback, send back the result
        if (id === 0) return

        // send response to the peer, negative ID indicates this is a response not a message
        if (result instanceof Promise) result = await result
        let response = (result === undefined) ? [-id] : [-id, result]   // this check is needed so undefined is not replaced with null during IPC

        return this._send(response)
    }

    _listen()       { throw new Error('not implemented') }
    _send(message)  { throw new Error('not implemented') }
}

export class IPC_Mailbox extends Mailbox {
    /* Request-response IPC communication channel from this process to `peer`. */

    constructor(peer, on_message) {
        super(on_message)
        this.peer = peer
        this._listen()
    }
    
    _listen()       { this.peer.on("message", schemat.with_context(message => this._handle_message(message))) }
    _send(message)  { return this.peer.send(message) }
}


/**********************************************************************************************************************/

export class Node extends Agent {
    /* Node of a Schemat cluster. Technically, each node is a local (master) process launched independently
       on a particular machine, together with its child (worker) processes, if any. Nodes communicate with each other
       using Kafka, and in this way they form a distributed compute & storage cluster.

       The node, as an Agent, must NOT have any __install__() or __uninstall__() method, because these methods will never
       be launched: the node is assumed to be installed on itself without any installation procedure and without
       being included in `agents_installed`. The node is added implicitly to the list of currently
       running agents in KernelProcess._get_agents_running().
     */

    agents
    agent_refresh_interval
    data_directory
    http_host
    http_port
    https_port
    tcp_host
    tcp_port
    tcp_retry_interval

    get worker_id()   { return schemat.kernel.worker_id }
    get num_workers() { assert(this.is_master()); return schemat.kernel.workers.length }

    is_master()     { return schemat.kernel.is_master() }
    is_worker()     { return !this.is_master() }
    get_worker(i)   { return schemat.kernel.get_worker(i) }     // i = 1,2,...,N

    _print(...args) { print(`${this.id}/#${this.worker_id}`, ...args) }

    get _tcp_port() { return schemat.config['tcp-port'] || this.tcp_port }      // FIXME: workaround

    get tcp_address() {
        if (!this.tcp_host || !this._tcp_port) throw new Error(`TCP host and port must be configured`)
        return `${this.tcp_host}:${this._tcp_port}`
    }

    get agents_installed() {
        // pull `agent` fields from this.agents, drop duplicates but preserve order
        let ids = []
        for (let status of this.agents)
            if (!ids.includes(status.agent.id)) ids.push(status.agent.id)
        return ids.map(id => schemat.get_object(id))
    }

    async __init__() {
        await Promise.all(this.agents.map(status => status.agent.load()))
    }


    /* This node as an agent (on master only!) */

    async __start__() {
        /* On master only. */
        if (this.is_worker()) return {}

        let tcp_sender = new TCP_Sender()
        let tcp_receiver = new TCP_Receiver()

        await tcp_sender.start(this.tcp_retry_interval * 1000)
        await tcp_receiver.start(this._tcp_port)

        let agents = this.agents
        let starting_agents = this._start_agents(agents)    // a promise

        return {tcp_sender, tcp_receiver, agents, starting_agents}
    }

    async __stop__({tcp_sender, tcp_receiver}) {
        if (this.is_worker()) return
        await tcp_receiver.stop()
        await tcp_sender.stop()
    }

    async _start_agents(agents) {
        for (let {worker, agent, role, options} of agents)
            await this.sys_send(worker, 'START_AGENT', agent.id, {role, options})
    }

    // _place_agents(agents) {
    //     /* For each process (master = 0, workers = 1,2,3...), create a list of agent IDs that should be running on this process.
    //        Notify each sublist to a corresponding process. Return an inverted Map: agent ID -> array of process IDs.
    //      */
    //     let N = this.num_workers
    //     assert(N >= 1)
    //
    //     let current_worker = 1
    //     let plan = Array.from({length: N + 1}, () => [])    // plan[k] is an array of agent IDs that should be running on worker `k`
    //
    //     // translate `agents` array of status objects to a plan per process
    //     for (let status of agents) {
    //         let worker = status.worker
    //         assert(worker >= 0 && worker <= N)
    //         plan[worker].push(status.agent.id)
    //     }
    //     this._print(`agents allocation:`, plan)
    //
    //     // // distribute agents uniformly across worker processes
    //     // for (let agent of agents) {
    //     //     // assert(agent.is_loaded())
    //     //     let num_workers = agent.num_workers
    //     //     if (num_workers === -1) num_workers = N
    //     //
    //     //     for (let i = 0; i < num_workers; i++) {
    //     //         plan[current_worker++].push(agent.id)
    //     //         if (current_worker > N) current_worker = 1
    //     //     }
    //     // }
    //
    //     // notify the plan to every process
    //     schemat.kernel.set_agents_running(plan[0])
    //     for (let i = 1; i <= N; i++)
    //         this.sys_notify(i, 'AGENTS_RUNNING', plan[i])
    //
    //     // convert the plan to a Map of: agent ID -> array of process IDs
    //     let locations = new Map()
    //     for (let i = 0; i <= N; i++)
    //         for (let agent of plan[i])
    //             if (locations.has(agent)) locations.get(agent).push(i)
    //             else locations.set(agent, [i])
    //     // this._print(`agents locations:`, locations)
    //
    //     return locations
    // }


    /* Agent routing */

    async find_node(agent_id, role) {
        // if agent is deployed on one of local processes, return this node
        if (this.find_process(agent_id) != null) return this
        return schemat.cluster.find_node(agent_id)  //,role
    }

    find_process(agent_id, role) {
        assert(this.$state?.agents, `list of running agents not yet initialized`)
        if (agent_id === this.id) return 0      // the node agent itself is contacted at the master process
        return this.$state.agents.find(status => status.agent.id === agent_id)?.worker
    }


    /* Message formation & parsing */

    _rpc_request(agent_id, method, args = [], opts) {
        /* RPC message format: [type, agent_id, method, args, tx, app_id?] */
        let request = ['RPC', agent_id, method, JSONx.encode(args), schemat.tx?.dump() || null]
        if (schemat.app_id) request.push(schemat.app_id)
        return request
    }

    _rpc_request_parse(request) {
        let [type, agent_id, method, args, tx, app_id] = request
        assert(type === 'RPC', `incorrect message type, expected RPC`)
        if (tx) tx = schemat.load_transaction(tx)
        return {type, agent_id, method, args: JSONx.decode(args), tx, app_id}
    }

    _rpc_response(result, error) {
        /* RPC result must be JSONx-encoded, and execution context & transaction metadata must be added to the response.
           Response format: {result, error, records}
         */
        if (error) return JSONx.encode({error})
        let response = {}
        let records = schemat.tx?.dump_records()

        if (result !== undefined) response.result = result
        if (records?.length) response.records = records

        return JSONx.encode(response)
        // return JSONx.encode_checked(result)
    }

    _rpc_response_parse(response) {
        if (response === undefined) throw new Error(`missing RPC response`)
        let {result, error, records} = JSONx.decode(response)
        if (error) throw error
        if (records?.length) schemat.tx?.register_changes(...records)
        return result
        // return JSONx.decode_checked(response)
    }


    /* RPC: remote calls to agents */

    async rpc_send(agent, method, args, opts /*{role, node, worker, tx, wait, wait_delegated, broadcast}*/ = {}) {
        /* Send an RPC message to a remote `agent`. If needed, the message is first sent over internal (IPC) and
           external (TCP) communication channels to arrive at a proper node and worker process where the `agent` is running.
           There, '$agent.<method>'(...args) of `agent` is invoked and the response is returned via the same path.
           Arguments and the result of the call are JSONx-encoded/decoded.
           If broadcast=true, all known deployments of the agent are targeted and an array of results is returned (TODO);
           otherwise, only one arbitrary (random?) deployment is targeted in case of multiple deployments.
           Additionally, `role`, `node` and `worker` can be used to restrict the set of target deployments to be considered.
           TODO: wait_delegated=true if the caller waits for a response that may come from a different node,
                 not the direct recipient of the initial request (delegated RPC request, multi-hop RPC, asymmetric routing)
         */
        let agent_id = (typeof agent === 'object') ? agent.id : agent
        let message = this._rpc_request(agent_id, method, args, opts)
        // this._print("rpc_send():", JSON.stringify(message))

        assert(schemat.kernel.frames.size, `kernel not yet initialized`)

        // check if the target object is deployed here on the current process, then no need to look any further
        // -- this rule is important for loading data blocks during and after bootstrap
        if (!opts.broadcast) {
            let frame = schemat.get_frame(agent_id)
            if (frame) return this._rpc_response_parse(await this.rpc_recv(message))
        }

        let result = await this.ipc_send(MASTER, message)
        return this._rpc_response_parse(result)
    }

    async rpc_recv(message) {
        /* Execute an RPC message addressed to an agent running on this process.
           Error is raised if the agent cannot be found, *no* forwarding. `args` are JSONx-encoded.
         */
        let {agent_id, method, args, app_id, tx} = this._rpc_request_parse(message)
        if (tx?.debug) this._print("rpc_recv():", JSON.stringify(message))

        // locate the agent by its `agent_id`, should be running here in this process
        let frame = await this._find_frame(agent_id)
        if (!frame) throw new Error(`agent [${agent_id}] not found on this process`)

        let role = frame.state.__role || '$agent'
        assert(role[0] === '$', `incorrect name of agent role (${role})`)

        let call = async () => {
            let result = await frame.call_agent(`${role}.${method}`, args)
            return this._rpc_response(result)
        }
        return schemat.in_tx_context(app_id, tx, call)
    }

    async _find_frame(agent_id, attempts = 5, delay = 0.2) {
        /* Find an agent by its ID in the current process. Retry `attempts` times with a delay to allow the agent start during bootstrap. */
        for (let i = 0; i < attempts; i++) {
            let frame = schemat.get_frame(agent_id)
            if (frame) return frame
            this._print(`_find_frame(): retrying agent_id=${agent_id}`)
            await sleep(delay)
        }
    }


    /* IPC: vertical communication between master/worker processes */

    async ipc_master(message) {
        /* On master process, handle an IPC message received from a worker process or directly from itself.
           IPC calls do NOT perform JSONx-encoding/decoding of arguments/result, so the latter must be
           plain JSON-serializable objects, or already JSONx-encoded.
         */
        assert(this.is_master())
        let [type] = message
        // this._print(`ipc_master():`, JSON.stringify(message))

        if (type === 'SYS') return this.sys_recv(message)
        if (type === 'RPC') {
            let {agent_id} = this._rpc_request_parse(message)
            // print(`ipc_master():`, `agent_id=${agent_id} method=${method} args[0]=${args[0]}`) // JSON.stringify(message))

            // check if the target object is deployed here on this node, then no need to look any further
            // -- this rule is important for loading data blocks during and after bootstrap

            let node = await this.find_node(agent_id)

            if (!node) throw new Error(`missing host node for RPC target agent [${agent_id}]`)
            if (node.is(schemat.node)) {
                // this._print(`ipc_master(): redirecting to self`)
                return this.tcp_recv(message)       // target agent is deployed on the current node
            }

            // await node.load()
            // this._print(`ipc_master(): sending to ${node.id} at ${node.tcp_address}`)

            return this.tcp_send(node, message)
        }
        else throw new Error(`unknown worker-to-master message type: ${type}`)
    }

    ipc_worker(message) {
        // this._print(`ipc_worker(${type}):`, JSON.stringify(msg))
        let [type] = message
        if (type === 'SYS') return this.sys_recv(message)
        if (type === 'RPC') return this.rpc_recv(message)
    }

    ipc_send(process_id = 0, message, opts = {}) {
        /* Send an IPC message from master down to a worker process, or the other way round.
           Set opts.wait=false to avoid waiting for the response.
         */
        // this._print(`ipc_send() process_id=${process_id} worker_id=${this.worker_id} message=${message}`)
        if (process_id === this.worker_id)      // shortcut when sending to itself, on master or worker
            return process_id ? this.ipc_worker(message) : this.ipc_master(message)

        if (process_id) {
            assert(this.is_master())
            let worker = this.get_worker(process_id)
            return worker.mailbox.send(message, opts)
        }
        else {
            assert(this.is_worker())
            return schemat.kernel.mailbox.send(message, opts)
        }
    }

    ipc_notify(process_id, message) {
        /* Send an IPC message to another process and do NOT wait for a reply. */
        return this.ipc_send(process_id, message, {wait: false})
    }


    /* TCP: horizontal communication between nodes */

    async tcp_send(node, msg) {
        /* On master process, send a message to another node via TCP. */
        // print("tcp_send():", JSON.stringify(msg))
        assert(this.is_master())
        if (!node.is_loaded()) await node.load()    // target node's TCP address is needed
        return this.$state.tcp_sender.send(msg, node.tcp_address)
    }

    tcp_recv(message) {
        /* On master process, handle a message received via TCP from another node or directly from this node via a shortcut.
           `msg` is a plain object/array whose elements may still need to be JSONx-decoded.
         */
        // print("tcp_recv():", JSON.stringify(message))
        assert(this.is_master())
        let [type] = message
        // this._print(`tcp_recv():`, JSON.stringify(message))

        if (type === 'RPC') {
            let {agent_id} = this._rpc_request_parse(message)

            // find out which process (worker >= 1 or master = 0), has the `agent_id` agent deployed

            // let locs = this.locate_processes(agent_id)
            // if (locs.length > 1) throw new Error(`TCP target agent [${agent_id}] is deployed multiple times on ${this}`)
            // let proc = locs[0]

            let proc = this.find_process(agent_id)
            // print("tcp_recv(): process", proc)

            if (proc === undefined)
                throw new Error(`${this.id}/#${this.worker_id}: agent [${agent_id}] not found on this node`)

            if (proc !== this.worker_id)
                return this.ipc_send(proc, message)             // forward the message down to a worker process, to its ipc_worker()
            return this.rpc_recv(message)                       // process the message here in the master process
        }
        else throw new Error(`unknown node-to-node message type: ${type}`)
    }


    /* SYS: control signals between master <> worker processes */

    sys_send(process_id, method, ...args) {
        /* Send a system message (SYS) via IPC. */
        return this.ipc_send(process_id, this._sys_message(method, ...args))
    }

    sys_notify(process_id, method, ...args) {
        return this.ipc_notify(process_id, this._sys_message(method, ...args))
    }

    sys_recv(message) {
        let {command, args} = this._sys_parse(message)
        return this[command](...args)
    }

    _sys_message(command, ...args) {
        /* Form a system message ('SYS' type). */
        return ['SYS', command, args]
    }

    _sys_parse(message) {
        let [type, command, args] = message
        assert(type === 'SYS', `incorrect message type, expected SYS`)
        return {type, command, args}
    }


    /* list of SYS signals */

    async START_AGENT(agent_id, {role, options}) {
        await schemat.kernel.start_agent(agent_id, {role, options})
    }

    async STOP_AGENT(agent_id, {role}) {
        await schemat.kernel.stop_agent(agent_id, {role})
    }

    // CACHE_RECORD() / REGISTER_RECORD()


    /*************/

    // 'edit.add_installed'(name, agent) {
    //     /* Add the agent to `agents_installed` under the given `name`. Idempotent. */
    //
    //     // check that the name is not already taken
    //     let current = this.agents_installed.get(name)
    //     if (current && current.id !== agent.id) throw new Error(`an agent with the same name (${name}), id=${current.id}, is already installed on node [${this.id}]`)
    //
    //     // check that the agent is not already installed under a different name
    //     let other_name = Array.from(this.agents_installed.entries()).find(([n, a]) => a.id === agent.id && n !== name)?.[0]
    //     if (other_name) throw new Error(`agent [${agent.id}] is already installed on node [${this.id}] under a different name (${other_name})`)
    //
    //     this.agents_installed.set(name, agent)
    // }
    //
    // 'edit.delete_installed'(agent_or_name) {
    //     /* Remove the agent from `agents_installed`; agent_or_name is either an Agent object or its name in `agents_installed`. Idempotent. */
    //
    //     if (typeof agent_or_name === 'string')
    //         this.agents_installed.delete(agent_or_name)
    //     else
    //         // search for the agent ID in the map and remove it
    //         for (let [name, agent] of this.agents_installed.entries())
    //             if (agent.id === agent_or_name.id) {
    //                 this.agents_installed.delete(name)
    //                 break
    //             }
    // }
    //
    // 'edit.add_running'(agent, {workers = true, master = false}) {
    //     /* Check that the `agent` is installed and not yet on the list of running agents,
    //        then add it to the corresponding array(s). Idempotent.
    //      */
    //     let agents = Array.from(this.agents_installed.values())
    //     if (!agents.some(a => a.id === agent.id)) throw new Error(`agent [${agent.id}] is not installed on node [${this.id}]`)
    //
    //     if (workers && this.agents_running.every(a => a.id !== agent.id))
    //         this.agents_running.push(agent)
    //
    //     if (master && this.master_agents_running.every(a => a.id !== agent.id))
    //         this.master_agents_running.push(agent)
    // }
    //
    // 'edit.delete_running'(agent) {
    //     /* Remove the `agent` from the list of agents_running and master_agents_running, if present. Idempotent. */
    //     this.agents_running = this.agents_running.filter(a => a.id !== agent.id)
    //     this.master_agents_running = this.master_agents_running.filter(a => a.id !== agent.id)
    // }
    //
    //
    // async '$agent.install'(name, agent, {start = true, workers = true, master = false} = {}) {
    //     /* Call agent.__install__() on this node and add the agent to `agents_installed`. If start=true, the agent
    //        is also added to `agents_running` and is started on the next iteration of the host process's life loop.
    //      */
    //     // process.chdir(this.local_root || schemat.app.local_root)
    //     await agent.load()
    //     await agent.__install__(this)       // can modify the local environment of the host node
    //
    //     let node = this.get_mutable()
    //     node.edit.add_installed(name, agent)
    //
    //     if (start) node.edit.add_running(agent, {workers, master})
    //     await node.save()
    // }
    //
    // async '$agent.uninstall'(agent) {
    //     await agent.load()
    //
    //     let node = this.get_mutable()
    //     node.edit.delete_running(agent)             // let workers know that the agent should be stopped
    //     await node.save()
    //     await sleep(this.agent_refresh_interval * 2 + node.__ttl)     // TODO: wait for actual confirmation(s) that the agent is stopped on all processes
    //
    //     node.edit.delete_installed(agent)           // mark the agent as uninstalled
    //     await node.save()
    //
    //     await agent.__uninstall__(this)             // clean up any node-specific resources
    // }

    /*************/

    // async '$worker.start_agent'()

    async '$master.start_agent'(...args) { return this['$agent.start_agent'](...args) }

    async '$agent.start_agent'(state, agent, {role, options, worker, num_workers = 1} = {}) {
        /* `agent` is a web object or ID. */
        this._print(`$agent.start_agent() agent=${agent}`)
        agent = schemat.as_object(agent)
        // if (agents.has(agent)) throw new Error(`agent ${agent} is already running on node ${this}`)
        // agents.set(agent, {params, role, workers})
        
        if (num_workers === -1) num_workers = this.num_workers
        assert(num_workers <= this.num_workers, `num_workers (${num_workers}) must be <= ${this.num_workers}`)

        let workers = worker ? (Array.isArray(worker) ? worker : [worker]) : this._rank_workers(state)
        workers = workers.slice(0, num_workers)
        
        for (let worker of workers) {
            assert(worker >= 1 && worker <= this.num_workers)
            state.agents.push({worker, agent, role, options})

            // request the worker process to start the agent:
            await this.sys_send(worker, 'START_AGENT', agent.id, {role, options})
            // this.$worker({node: this, worker: i}).start_agent(agent.id, {role, options})
        }
    }

    async '$agent.stop_agent'(state, agent, {role, worker} = {}) {
        /* `agent` is a web object or ID. */
        this._print(`$agent.stop_agent() agent=${agent}`)
        agent = schemat.as_object(agent)

        let stop = state.agents.filter(status => status.agent.is(agent))
        state.agents = state.agents.filter(status => !status.agent.is(agent))
        if (!stop.length) return

        // stop every agent from `stop`, in reverse order
        for (let status of stop.reverse())
            await this.sys_send(status.worker, 'STOP_AGENT', agent.id, {role})
    }

    async '$agent.flush_agents'({agents}) {
        /* Save the current {agents} state to DB. */
        let node = this.get_mutable()
        node.agents = agents
        await node.save()
    }

    _rank_workers(state) {
        /* Order workers by utilization, from least to most busy. */
        let workers = state.agents.map(status => status.worker).filter(w => w >= 1)     // pull out worker IDs, skip the master process (0)
        let counts = new Counter(workers)
        let sorted = counts.least_common()
        return sorted.map(entry => entry[0])
    }
}

