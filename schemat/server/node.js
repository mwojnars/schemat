import {assert, print, timeout, sleep} from '../common/utils.js'
import {RPC_Error} from "../common/errors.js";
import {JSONx} from "../common/jsonx.js";
import {Catalog} from "../common/catalog.js";
import {WebObject} from "../core/object.js";
import {Agent} from "./agent.js";
import {TCP_Receiver, TCP_Sender} from "./tcp.js";
import {Counter} from "../common/structs.js";


const MASTER = 0        // ID of the master process; workers are numbered 1,2,...,N


/**********************************************************************************************************************/

// class Config extends WebObject {
//     /* Global server-side configuration that can be defined separately at cluster/node/app/command-line level
//        and then combined in a particular Schemat process to control high-level behaviour of the node.
//      */
//     merge(...others) {
//         /* The expected order of `others` is from least to most specific: [node config, app config, command-line config]. */
//         let configs = [...others.reverse(), this]
//         let catalogs = configs.map(obj => obj.__data || new Catalog(obj))
//         return Catalog.merge(catalogs)
//     }
// }

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
    constructor(callback, timeout = 10 * 1000) {   //schemat.debug ? null : 5000
        this.callback = callback        // processing function for incoming messages
        this.pending = new Map()        // requests sent awaiting a response
        this.message_id = 0             // last message ID sent

        this.timeout = timeout          // timeout for waiting for a response
        this.timestamps = new Map()     // timestamps for pending requests
        this.interval = timeout ? setInterval(() => this._check_timeouts(), timeout).unref() : null
    }

    send(msg, {wait = true} = {}) {
        /* Send `msg` to the peer. Wait for the response if wait=true. */
        if (!wait) this._send([0, msg])
        else return new Promise((resolve, reject) => {
            let id = ++this.message_id
            if (this.message_id >= Number.MAX_SAFE_INTEGER) this.message_id = 0

            this._send([id, msg])
            this.pending.set(id, resolve)
            if (this.timeout) this.timestamps.set(id, {timestamp: Date.now(), reject, msg})

            // schemat.on_exit.add(reject)
            // if (schemat.on_exit.size > 1000)
            //     schemat._print(`WARNING schemat.on_exit.size = ${schemat.on_exit.size}`)
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
                // schemat.on_exit.delete(reject)   // WARN: here, `schemat` may be a different object than in send(), such deletion is incorrect!!
                this.pending.delete(id)
                this.timestamps.delete(id)
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
            // schemat.on_exit.delete(this.timestamps.get(id)?.reject)
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

class RPC_Request {
    static create(agent_id, cmd, args = [], opts = {}) {
        /* RPC message format: [type, agent_id, cmd, args, opts], where `opts` may include {broadcast, scope, worker, role, app, tx}.
           - scope = routing scope: whether the request is target at entire 'cluster', or current 'node', or current 'process' only
           - worker = local ID of the target worker process
           - app = application ID
           - tx = transaction info
           - broadcast
           - role
         */
        let {scope, role} = opts

        if (this.is_private(cmd) && scope !== 'process')        // local scope enforced when targeting a private command ("_" prefix)
            opts.scope = 'node'

        if (role === schemat.GENERIC_ROLE) delete opts.role     // default role passed implicitly

        let tx = schemat.tx?.dump_tx()
        let ctx = schemat.db.id
        opts = {...opts, ctx, tx}
        // opts.rpc = [agent_id, cmd, ...args]

        // in `args`, truncate trailing undefined values and replace the remaining ones with nulls
        if (args.length) {
            args = args.slice(0, args.findLastIndex(arg => arg !== undefined) + 1)
            args = args.map(arg => arg === undefined ? null : arg)
        }

        return ['RPC', agent_id, cmd, JSONx.encode(args), opts]
    }

    static is_private(cmd_or_request) {
        /* Private command (private request) is the one whose name starts with "_". */
        let cmd = (typeof cmd_or_request === 'string') ? cmd_or_request : cmd_or_request[2]
        return cmd[0] === '_'
    }

    static rescope(req, scope) {
        /* Change scope of the request to `scope`. */
        let opts = req[4]
        req = [...req]
        req[4] = {...opts, scope}
        return req
    }

    static parse(request) {
        let [type, agent_id, cmd, args, {role, tx, ctx, scope, worker, broadcast}] = request
        assert(type === 'RPC', `incorrect message type, expected RPC`)
        return {type, agent_id, role, cmd, args: JSONx.decode(args), tx, ctx, scope, worker, broadcast}
    }
}

class RPC_Response {
    static create(ret, err) {
        /* RPC result must be JSONx-encoded, and execution context & transaction metadata must be added to the response.
           Response format: {result, error, records}
         */
        if (err) return JSONx.encode({err})
        let response = {}
        let records = schemat.tx?.dump_records()

        if (ret !== undefined) response.ret = ret
        if (records?.length) response.records = records

        return JSONx.encode(response)
    }

    static parse(response) {
        if (response === undefined) throw new Error(`missing RPC response`)
        let {ret, err, records} = JSONx.decode(response)
        if (err) throw new RPC_Error("peer error during RPC call", {cause: err})
        if (records?.length) schemat.register_changes(...records)
        // TODO: above, use register_changes() only for important records that should be stored in TX and passed back to the originator
        return ret
    }
}

/**********************************************************************************************************************/

export class Node extends Agent {
    /* Node of a Schemat cluster. Technically, each node is a local (master) process launched independently
       on a particular machine, together with its child (worker) processes. Nodes communicate with each other
       using TCP connections, and in this way they form a distributed compute & storage cluster.
       The node's own agent is started implicitly on itself.
     */

    agents                  // array of AgentStatus objects of the form {worker, id, role, ...}; AgentStatus class is not yet defined, so these are plain objects
    agent_refresh_interval
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


    // get _tcp_port() { return schemat.config['tcp-port'] || this.tcp_port }      // FIXME: workaround

    get tcp_address() {
        if (!this.tcp_host || !this.tcp_port) throw new Error(`TCP host and port must be configured`)
        return `${this.tcp_host}:${this.tcp_port}`
    }

    get file_path() {
        /* Absolute path to this node's local folder. */
        assert(schemat.cluster)
        let parts = [schemat.PATH_CLUSTER, schemat.cluster.file_tag, `node.${this.id}`]
        return parts.filter(p => p).join('/')
    }


    __new__(tcp_addr) {
        /* If provided as a custom argument, split the TCP address of the form "host:port" into parts. */
        if (!tcp_addr) return
        let [tcp_host, tcp_port] = tcp_addr.split(':')
        if (tcp_host) this.tcp_host = tcp_host
        if (tcp_port) this.tcp_port = Number(tcp_port)
    }

    async __load__() {
        let agents = this.agents || []
        if (SERVER && schemat.booting)      // core agents (ex. data blocks) must be loaded initially from bootstrap DB; NOT a cluster object to avoid cyclic dependency
            await Promise.all(agents.map(({id}) => id !== schemat.cluster_id && schemat.load(id)))
    }


    /* This node as an agent (on master only!) */

    async __start__({role}) {
        /* On master only. */
        // this._print(`Node.__start__() role:`, role)
        if (this.is_worker()) return

        let tcp_sender = new TCP_Sender()
        let tcp_receiver = new TCP_Receiver()
        await tcp_sender.start(this.tcp_retry_interval * 1000)

        await sleep(1.0)        // wait for worker processes to start before external RCP requests are received
        await tcp_receiver.start(this.tcp_port)

        return {tcp_sender, tcp_receiver, agents: this.agents}
    }

    async __restart__(state) { return state }

    async __stop__({tcp_sender, tcp_receiver}) {
        if (this.is_worker()) return
        await tcp_receiver.stop()
        await tcp_sender.stop()
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

    _find_node(agent_id, role) {
        /* Return the node where the `agent` is running in a given `role`. The current node has a priority:
           if the agent is deployed on one of the local processes, `this` is returned.
         */
        if (this._find_process(agent_id, role) != null) return this
        return schemat.cluster.find_node(agent_id, role)
    }

    _find_process(agent_id, role) {
        /* On master, look up the `agents` array of agent placements to find the local process where the agent runs
           in a given `role` (or in any role if `role` is missing or GENERIC_ROLE).
         */
        let agents = this.$master.state?.agents
        assert(agents, `array of running agents not yet initialized`)
        if (agent_id === this.id) return 0      // the node agent itself is contacted at the master process

        if (role === schemat.GENERIC_ROLE) role = undefined

        let status = agents.find(status => status.id === agent_id && (!role || status.role === role))
        return status?.worker
    }

    // async _find_frame(agent_id, role, attempts = 1, delay = 0.2) {
    //     /* Find an agent by its ID in the current process. Retry `attempts` times with a delay to allow the agent to start during bootstrap. */
    //     for (let i = 0; i < attempts; i++) {
    //         let frame = schemat.get_frame(agent_id, role)
    //         if (frame) return frame
    //         this._print(`_find_frame(): retrying agent_id=${agent_id}`)
    //         await sleep(delay)
    //     }
    // }


    /* RPC: remote calls to agents */

    async rpc(agent, cmd, args, opts /*{role, node, worker, wait, wait_delegated, broadcast}*/ = {}) {
        /* Make an RPC call to a remote `agent`. If needed, use IPC (internal) and TCP (external) communication to transmit
           the request to the right node and worker process, where the `agent` is running, and to receive a response back.
           At the target process, <role>.<cmd>(...args) or $agent.<cmd>(...args) of `agent` is invoked. Arguments and result are JSONx-encoded.
           If broadcast=true, all known deployments of the agent are targeted and an array of results is returned (TODO);
           otherwise, only one arbitrary (random?) deployment is targeted in case of multiple deployments.
           Additionally, `role`, `node`, `worker`, `scope` options can be used to restrict the set of target deployments to be considered.
           TODO: wait_delegated=true if the caller waits for a response that may come from a different node,
                 not the direct recipient of the initial request (delegated RPC request, multi-hop RPC, asymmetric routing)
         */
        assert(schemat.kernel.frames.size, `kernel not yet initialized`)

        let agent_id = (typeof agent === 'object') ? agent.id : agent
        let request = RPC_Request.create(agent_id, cmd, args, opts)
        // this._print("rpc():", JSON.stringify(message))

        if (opts.worker !== undefined) this._print(`rpc() opts.worker = ${opts.worker}`)
        try {
            let response = await this.rpc_send(request)
            return RPC_Response.parse(response)
        }
        catch (ex) {
            this._print("rpc() FAILED on request:", JSON.stringify(request))
            throw ex
        }
    }

    async rpc_send(request) {
        let {agent_id, role, scope, worker, broadcast} = RPC_Request.parse(request)

        // no forwarding when `scope` enforces local execution
        if (scope === 'process') return this.rpc_exec(request)

        // no forwarding when a target `worker` is given and it's the current process
        if (scope === 'node' && worker === this.worker_id) return this.rpc_exec(request)

        // no forwarding when a target object is deployed here on the current process
        // -- this rule is important for loading data blocks during and after bootstrap
        let frame = !broadcast && schemat.get_frame(agent_id, role)
        if (frame) return this.rpc_exec(request)

        return this.ipc_send(MASTER, request)
    }

    async rpc_frwd(message) {
        /* On master, forward an RPC message originating at this node either to a remote peer or a local worker process. */
        let {node, worker, agent_id, role} = RPC_Request.parse(message)
        // this._print(`rpc_frwd():`, `agent_id=${agent_id} method=${method} args=${args}`)

        // if `worker` is given, `node` is itself by default
        if (worker != null) node ??= schemat.node

        node ??= this._find_node(agent_id, role)
        if (!node) throw new Error(`missing host node for RPC target agent [${agent_id}]`)

        // check if the target object is deployed here on this node, then no need to look any further
        // -- this rule is important for loading data blocks during and after bootstrap
        if (node.is(schemat.node)) {
            // this._print(`rpc_frwd(): redirecting to self`)
            return this.rpc_recv(message)       // target agent is deployed on the current node
        }

        // await node.load()
        // this._print(`rpc_frwd(): sending to ${node.id} at ${node.tcp_address}`)
        return this.tcp_send(node, message)
    }

    async rpc_recv(message) {
        /* Route an incoming RPC request to the right process on this node and execute. */
        let {worker, agent_id, role} = RPC_Request.parse(message)

        // find out which process (worker >= 1 or master = 0), has the `agent_id` agent deployed

        // let locs = this.locate_processes(agent_id)
        // if (locs.length > 1) throw new Error(`TCP target agent [${agent_id}] is deployed multiple times on ${this}`)
        // let proc = locs[0]

        worker ??= this._find_process(agent_id, role)
        // print("tcp_recv(): process", proc)

        if (worker == null)
            throw new Error(`${this.id}/#${this.worker_id}: agent [${agent_id}] not found on this node`)

        if (worker !== this.worker_id)
            return this.ipc_send(worker, message)           // forward the message down to a worker process, to its ipc_worker()

        return this.rpc_exec(message)                       // process the message here in the master process
    }

    async rpc_exec(message) {
        /* Execute an RPC message addressed to an agent running on this process.
           Error is raised if the agent cannot be found, *no* forwarding. `args` are JSONx-encoded.
         */
        let {agent_id, role, cmd, args, ctx, tx} = RPC_Request.parse(message)
        if (tx?.debug) this._print("rpc_exec():", JSON.stringify(message))

        role ??= schemat.GENERIC_ROLE
        assert(role[0] === '$', `incorrect name of agent role (${role})`)

        // locate the agent by its `agent_id`, should be running here in this process
        let frame = schemat.get_frame(agent_id, role)
        if (!frame) throw new Error(`[${agent_id}].${role} not found on this process`)

        return frame.exec(cmd, args, ctx, tx, (out, err) => RPC_Response.create(out, err))
    }


    /* IPC: vertical communication between master/worker processes */

    async ipc_send(process_id = 0, message, opts = {}) {
        /* Send an IPC message from master down to a worker process, or the other way round.
           Set opts.wait=false to avoid waiting for the response.
         */
        // this._print(`ipc_send() process_id=${process_id} worker_id=${this.worker_id} message=${message}`)
        try {
            if (process_id === this.worker_id)      // shortcut when sending to itself, on master or worker
                return process_id ? await this.ipc_worker(message) : await this.ipc_master(message)

            if (process_id) {
                assert(this.is_master())
                let worker = this.get_worker(process_id)
                return await worker.mailbox.send(message, opts)
            }
            else {
                assert(this.is_worker())
                return await schemat.kernel.mailbox.send(message, opts)
            }
        }
        catch (ex) {
            this._print(`ipc_send() FAILED request to proc #${process_id}:`, JSON.stringify(message))
            throw ex
        }
    }

    ipc_notify(process_id, message) {
        /* Send an IPC message to another process and do NOT wait for a reply. */
        return this.ipc_send(process_id, message, {wait: false})
    }

    ipc_master(message) {
        /* On master process, handle an IPC message received from a worker process or directly from itself.
           IPC calls do NOT perform JSONx-encoding/decoding of arguments/result, so the latter must be
           plain JSON-serializable objects, or already JSONx-encoded.
         */
        assert(this.is_master())
        let [type] = message
        // this._print(`ipc_master():`, JSON.stringify(message))

        // if (type === 'SYS') return this.sys_recv(message)
        if (type === 'RPC') return this.rpc_frwd(message)
        throw new Error(`unknown worker-to-master message type: ${type}`)
    }

    ipc_worker(message) {
        // this._print(`ipc_worker(${type}):`, JSON.stringify(msg))
        let [type] = message
        // if (type === 'SYS') return this.sys_recv(message)
        if (type === 'RPC') return this.rpc_exec(message)
    }


    /* TCP: horizontal communication between nodes */

    async tcp_send(node, msg) {
        /* On master process, send a message to another node via TCP. */
        // print("tcp_send():", JSON.stringify(msg))
        assert(this.is_master())
        if (!node.is_loaded()) await node.load()    // target node's TCP address is needed
        return this.$master.state.tcp_sender.send(msg, node.tcp_address)
    }

    tcp_recv(message) {
        /* On master process, handle a message received via TCP from another node.
           `msg` is a plain object/array whose elements may still need to be JSONx-decoded.
         */
        assert(this.is_master())
        let [type] = message

        if (type === 'RPC') {
            if (RPC_Request.is_private(message)) throw new Error(`cannot handle private message received from another node`)
            return this.rpc_recv(message)
        }
        throw new Error(`unknown node-to-node message type: ${type}`)
    }


    /* SYS: control signals between master <> worker processes */

    // sys_send(process_id, method, ...args) {
    //     /* Send a system message (SYS) via IPC. */
    //     return this.ipc_send(process_id, this._sys_message(method, ...args))
    // }
    //
    // sys_notify(process_id, method, ...args) {
    //     return this.ipc_notify(process_id, this._sys_message(method, ...args))
    // }
    //
    // _sys_message(command, ...args) {
    //     /* Form a system message ('SYS' type). */
    //     return ['SYS', command, args]
    // }
    //
    // sys_recv(message) {
    //     let {command, args} = this._sys_parse(message)
    //     return this[command](...args)
    // }
    //
    // _sys_parse(message) {
    //     let [type, command, args] = message
    //     assert(type === 'SYS', `incorrect message type, expected SYS`)
    //     return {type, command, args}
    // }


    async '$worker._start_agent'(agent_id, role) {
        await schemat.kernel.start_agent(agent_id, role)
    }

    async '$worker._stop_agent'(agent_id, role) {
        await schemat.kernel.stop_agent(agent_id, role)
    }

    // async '$worker._capture_records'(records) {}


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

    // async '$master.ipc_recv'()
    // async '$worker.ipc_recv'()

    async '$master.start_agent'(agent, {role, worker, num_workers = 1} = {}) {
        /* `agent` is a web object or ID. */
        this._print(`$master.start_agent() agent=${agent} role=${role}`)
        // this._print(`$master.start_agent() agents:`, this.$state.agents.map(({worker, agent, role}) => ({worker, id: agent.id, role})))

        let {agents} = this.$state
        agent = schemat.as_object(agent)
        // if (agents.has(agent)) throw new Error(`agent ${agent} is already running on node ${this}`)
        // agents.set(agent, {params, role, workers})
        
        if (num_workers === -1) num_workers = this.num_workers
        assert(num_workers <= this.num_workers, `num_workers (${num_workers}) must be <= ${this.num_workers}`)

        let workers = worker ? (Array.isArray(worker) ? worker : [worker]) : this._rank_workers(agents)
        workers = workers.slice(0, num_workers)

        if (role === schemat.GENERIC_ROLE) role = undefined     // the default role "$agent" is passed implicitly
        
        for (let worker of workers) {
            assert(worker >= 1 && worker <= this.num_workers)
            agents.push({worker, id: agent.id, role})

            // request the worker process to start the agent:
            await this.$worker({worker})._start_agent(agent.id, role)
        }
        await this.action.update({agents})
    }

    async '$master.stop_agent'(agent, {role, worker} = {}) {
        /* `agent` is a web object or ID. */
        this._print(`$master.stop_agent() agent=${agent} role=${role}`)
        // this._print(`$master.stop_agent() agents:`, this.$state.agents.map(({worker, agent, role}) => ({worker, id: agent.id, role})))

        let {agents} = this.$state
        agent = schemat.as_object(agent)

        let stop = agents.filter(status => status.id === agent.id)
        if (!stop.length) return

        this.$state.agents = agents = agents.filter(status => status.id !== agent.id)

        // stop every agent from `stop`, in reverse order
        for (let {worker} of stop.reverse())
            await this.$worker({worker})._stop_agent(agent.id, role)

        await this.action.update({agents})
    }

    _rank_workers(agents) {
        /* Order workers by utilization, from least to most busy. */
        let workers = agents.map(status => status.worker).filter(w => w >= 1)     // pull out worker IDs, skip the master process (0)
        let counts = new Counter(workers)
        let sorted = counts.least_common()
        return sorted.map(entry => entry[0])
    }
}

