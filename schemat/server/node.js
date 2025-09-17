import {AgentRole} from "../common/globals.js";
import {assert, print, timeout, sleep} from '../common/utils.js'
import {IPC_Error, RPC_Error} from "../common/errors.js";
import {JSONx} from "../common/jsonx.js";
import {Counter} from "../common/structs.js";
import {Agent} from "./agent.js";
import {TCP_Receiver, TCP_Sender} from "./tcp.js";
import {MASTER, LocalPlacements} from "./place.js";
import {Frame} from "./frame.js";


/**********************************************************************************************************************/

export class Mailbox {
    /* Request-response communication channel from a sender to a receiver built on top of two one-way communication
       channels represented by `_listen()` and `_send()` (to be implemented in subclasses).
       By calling `send()` with a message, the caller gets a promise that will be resolved with the response.
       The promise is rejected if the response is not received within the specified `timeout`.
       Alternatively, the sender may call `notify()` to send a message without waiting for a response.
       Here, "requests" are messages followed by a response, while "notifications" are fire-and-forget messages (no response).
     */

    constructor(callback, timeout = 10 * 1000) {   //schemat.debug ? null : 5000
        this.callback = callback        // processing function for incoming messages
        this.pending = new Map()        // stores [resolve, reject, timestamp, msg] for requests awaiting response
        this.message_id = 0             // last message ID sent
        this.timeout = timeout          // timeout for waiting for a response
        this.interval = timeout ? setInterval(() => this._check_timeouts(), timeout).unref() : null
    }

    send(msg, {wait = true} = {}) {
        /* Send `msg` to the peer. Wait for the response if wait=true. */
        if (!wait) return this._send([0, msg])

        return new Promise((resolve, reject) => {
            let id = ++this.message_id
            if (this.message_id >= Number.MAX_SAFE_INTEGER) this.message_id = 0

            this._send([id, msg])

            let entry = this.timeout ? [resolve, reject] : [resolve, reject, Date.now(), JSON.stringify(msg)]
            this.pending.set(id, entry)
        })
    }

    notify(msg) {
        /* Send a message without waiting for a response (fire-and-forget). */
        this._send([0, msg])
    }

    _check_timeouts() {
        if (this.pending.size > 1000)
            schemat._print(`WARNING: high number of unresolved IPC requests (${this.pending.size})`)

        let now = Date.now()
        for (let [id, [resolve, reject, timestamp, msg]] of this.pending.entries()) {
            if (timestamp && now - timestamp > this.timeout) {
                this.pending.delete(id)
                reject(new Error(`response timeout for message no. ${id}, msg = ${msg}`))
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

    async _handle_message([id, msg, err]) {
        /* Handle a request OR response received from the peer. */
        if (id < 0) return this._handle_response([id, msg, err])    // received a response not a request
        let result, error, resp

        // received a request message: run the callback, send back the result or error;
        // response format: [-id, result, error], where error is missing if `result` is present, and `result` can be missing
        // if undefined was returned from the call; `error` and `result` are JSONx-encoded objects;
        // negative ID indicates this is a response not a message
        try {
            result = await this.callback(msg)
            // if (result instanceof Promise) result = await result
        }
        catch (ex) {
            if (id === 0) schemat._print(`IPC notification ${JSON.stringify(msg)} ended with error on recipient:`, ex)
            else error = JSONx.encode(ex)
        }

        if (id === 0) return                            // only when non-zero ID, a response is expected by the caller
        if (error) resp = [-id, null, error]
        else if (result === undefined) resp = [-id]     // this is needed so undefined is _not_ replaced with null during IPC
        else resp = [-id, result]

        return this._send(resp)
    }

    _handle_response([id, result, error]) {
        id = -id
        let [resolve, reject] = this.pending.get(id) || []
        if (!resolve) return console.warn(`unknown IPC response id: ${id}`)

        this.pending.delete(id)

        // return result or error to the caller
        if (error) {
            let cause = JSONx.decode(error)
            reject(IPC_Error.with_cause('error processing request', cause))
        }
        else resolve(result)
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

    _send(message)  { return this.peer.send(message) }
    _listen()       { this.peer.on("message", schemat.with_context(message => this._handle_message(message))) }
}


/**********************************************************************************************************************/

class RPC_Request {
    static create(agent_id, cmd, args = [], opts = {}) {
        /* RPC message format: [agent_id, cmd, args, opts], where `opts` may include {broadcast, scope, worker, role, app, tx}.
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

        if (role === AgentRole.GENERIC) delete opts.role        // default role passed implicitly

        let tx = schemat.tx?.dump_tx()
        let ctx = schemat.db.id
        opts = {...opts, ctx, tx}

        // in `args`, truncate trailing undefined values and replace the remaining ones with nulls
        if (args.length) {
            args = args.slice(0, args.findLastIndex(arg => arg !== undefined) + 1)
            args = args.map(arg => arg === undefined ? null : arg)
        }
        assert(!('rpc' in opts))

        return {rpc: [agent_id, cmd, JSONx.encode(args)], ...opts}
    }

    static parse(request) {
        let {rpc: [agent_id, cmd, args], ...opts} = request
        return {agent_id, cmd, args: JSONx.decode(args), ...opts}
    }

    static is_private(cmd_or_request) {
        /* Private command (private request) is the one whose name starts with "_". */
        let cmd = (typeof cmd_or_request === 'string') ? cmd_or_request : cmd_or_request.rpc[1]
        return cmd[0] === '_'
    }
}

class RPC_Response {
    static create(ret, err) {
        /* RPC response, as {ret, err, snap} object encoded via JSONx, with:
           - ret = returned value
           - err = exception caught
           - snap = array of {id, data} records updated and captured (snapped) during request processing
         */
        if (err) return JSONx.encode({err})
        let response = {}
        let snap = schemat.tx?.dump_records()

        if (ret !== undefined) response.ret = ret
        if (snap?.length) response.snap = snap

        return JSONx.encode(response)
    }

    static parse(response, request) {
        if (response === undefined) {
            schemat.node._print_stack(`missing RPC response to request ${JSON.stringify(request)}`)
            throw new Error(`missing RPC response to request ${JSON.stringify(request)}`)
        }
        let {ret, err, snap} = JSONx.decode(response)

        if (err) {
            let {rpc: [id, cmd, args_encoded], role = AgentRole.GENERIC} = request
            let s_args = JSON.stringify(args_encoded).slice(1,-1)
            throw RPC_Error.with_cause(`error in request [${id}].${role}.${cmd}(${s_args})`, err, request)
        }

        // TODO: make sure that `snap` only contains the most recent versions of corresponding DB records, so that
        //       register_changes() below does NOT override newer records with older ones in Registry (!?), esp. in a lite transaction
        if (snap?.length) schemat.register_changes(...snap)

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

    num_workers
    agents                  // array of {fid, id, role, worker} describing worker placements of agents on this node
    http_host
    http_port
    https_port
    tcp_host
    tcp_port
    tcp_retry_interval

    // $master state attributes:
    // local_placements        // LocalPlacements object containing agent -> worker placements


    get worker_id()   { return schemat.kernel.worker_id }
    // get num_workers() { assert(this.is_master()); return schemat.kernel.workers.length }

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
        if (SERVER && schemat.booting) {
            // let ids = this.local_placements.list_agent_ids()        // core agents (ex. data blocks) must be loaded initially from bootstrap DB
            let ids = this.agents.map(({id}) => id)
            await Promise.all(ids.map(id => id !== schemat.cluster_id && schemat.load(id)))     // skip cluster object to avoid cyclic dependency
        }
        // this._save_placements()
    }

    async _impute_fid() {
        if (this.agents.every(({fid}) => fid)) return
        await sleep(3.0)
        this.agents.forEach(st => {st.fid = Frame.generate_fid()})
        await this.update_self({agents: this.agents}).save()
    }

    // async _save_placements() {
    //     await sleep(3.0)
    //     this.local_placements = new LocalPlacements(this)
    //     await this.save()
    // }


    /* This node as an agent (on master only!) */

    async __start__() {
        /* On master only. */
        if (this.is_worker()) return
        // this._impute_fid()

        let tcp_sender = new TCP_Sender()
        let tcp_receiver = new TCP_Receiver()

        await tcp_sender.start(this.tcp_retry_interval * 1000)
        await tcp_receiver.start(this.tcp_port)

        let local_placements = new LocalPlacements(this)
        // let local_placements = this.local_placements.clone()
        // local_placements.add_hidden(this)

        // TODO: retrieve global_placements from cluster.$leader instead of relying on information stored in DB (can be outdated?)
        //       ... or, update global_placements from cluster.$leader right after initializing the node
        let global_placements = schemat.cluster.global_placements()

        return {tcp_sender, tcp_receiver, local_placements, global_placements}
    }

    async __restart__() {}

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


    _rich_exception(ex, request) {
        ex.node = this.id
        ex.worker = this.worker_id
        ex.request = JSON.stringify(request)
        return ex
    }


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
        // this._print("rpc():", JSON.stringify(request))

        try {
            let response = await this.rpc_frwd(request)
            return RPC_Response.parse(response, request)
        }
        catch (ex) {
            // this._print("rpc() of request", JSON.stringify(request), "FAILED...")
            throw this._rich_exception(ex, request)
        }
    }

    async rpc_frwd(request) {
        /* Forward a newly-created RPC message from a (worker) process up to the master. Shortcuts may apply. */
        let {agent_id, role, scope, worker, broadcast} = RPC_Request.parse(request)

        // no forwarding when `scope` enforces local execution
        if (scope === 'process') return this.rpc_exec(request)

        // no forwarding when target `worker` is given and it's the current process
        if (scope === 'node' && worker === this.worker_id) return this.rpc_exec(request)

        // no forwarding when target object is deployed here on the current process
        // -- this rule is important for loading data blocks during and after bootstrap
        let frame = !broadcast && schemat.get_frame(agent_id, role)
        if (frame) return this.rpc_exec(request)

        if (!this.is_master()) return schemat.kernel.mailbox.send(request)  // forward to master if not yet there
        return this.rpc_send(request)                                       // on master, send out the message to a target node/process(es)
        // return this.ipc_send(MASTER, request)
    }

    async rpc_send(message) {
        /* On master, forward an RPC message originating at this node either to a remote peer or a local worker process. */
        let {node, worker, agent_id, role, broadcast} = RPC_Request.parse(message)
        // this._print(`rpc_send():`, `agent_id=${agent_id} method=${method} args=${args}`)

        if (broadcast) return this.rpc_bcst(message)
        node ??= this._find_node(worker, agent_id, role)
        if (node.is(this)) return this.rpc_recv(message)        // loopback connection if agent is deployed here on the current node
        return this.tcp_send(node, message)                     // remote connection otherwise
    }

    async rpc_bcst(request) {
        /* On master, broadcast message to all nodes and processes where the target (agent, role) is deployed.
           Collect all responses and return an array of results. Throw an error if any of the peers failed.
         */
        let {agent_id, role} = RPC_Request.parse(request)
        let nodes = this.$state.global_placements.find_nodes(agent_id, this._routing_role(role))
        let results = await Promise.all(nodes.map(node => node.is(this) ? this.rpc_recv(request) : this.tcp_send(node, request)))
        return results.flat()   // in broadcast mode, every peer returns an array of results, so they must be flattened at the end
    }

    async rpc_recv(message) {
        /* Route an incoming RPC request to the right process on this node and execute. */
        let {worker, agent_id, role, broadcast} = RPC_Request.parse(message)
        // TODO: broadcast

        worker ??= this._find_worker(agent_id, role)
        if (worker == null) throw new Error(`agent [${agent_id}] not found on this node`)
        if (worker === MASTER) return this.rpc_exec(message)    // process the message here in the master process
        return this.get_worker(worker).mailbox.send(message)    // forward the message down to a worker process
        // return this.ipc_send(worker, message)
    }

    async rpc_exec(message) {
        /* Execute an RPC message addressed to an agent running on this process.
           Error is raised if the agent cannot be found, *no* forwarding. `args` are JSONx-encoded.
         */
        let {agent_id, role, cmd, args, ctx, tx} = RPC_Request.parse(message)
        if (tx?.debug) this._print("rpc_exec():", JSON.stringify(message))

        // locate the agent by its `agent_id`, should be running here in this process
        let frame = schemat.get_frame(agent_id, role)
        if (!frame) throw new Error(`[${agent_id}].${role} not found on this process (worker #${this.worker_id}) to execute RPC message ${JSON.stringify(message)}`)

        return frame.exec(cmd, args, ctx, tx, (out, err) => RPC_Response.create(out, err))
    }

    _find_node(worker, agent_id, role) {
        /* On master, for request routing, find a node where (agent_id, role) is deployed. The current node has a priority:
           if the agent is deployed here on a local process, `this` is always returned -- this rule is important
           for loading data blocks during and after bootstrap. If `agent` is deployed on multiple nodes, one of them
           is chosen at random, or by hashing (TODO), or according to a routing policy...
           If `role` is GENERIC ("$agent"), every target deployment is accepted no matter its declared role.
         */
        role = this._routing_role(role)
        if (worker != null) return this                                 // if target worker was specified by the caller, the current node is assumed
        if (this._find_worker(agent_id, role) != null) return this      // if agent is deployed here on this node, it is preferred over remote nodes

        // check `global_placements` to find the node
        let node = this.$state.global_placements.find_node(agent_id, role)
        if (node) return node

        throw new Error(`agent [${agent_id}].${role} not found on any node in the cluster`)
    }

    _find_worker(agent, role) {
        /* On master, for request routing, look up $state.local_placements to find the process where `agent` runs in a given role
           (or in any role if `role` is missing or GENERIC).
         */
        role = this._routing_role(role)
        return this.$state.local_placements.find_first(agent, role)
    }

    _routing_role(role) {
        /* For request routing, interpret role=GENERIC as ANY. */
        return role && role !== AgentRole.GENERIC ? role : AgentRole.ANY
    }


    // /* IPC: vertical communication between master/worker processes */
    //
    // async ipc_send(process_id, request) {
    //     /* Send an IPC request from master down to a worker process, or the other way round. */
    //
    //     // this._print(`ipc_send() process_id=${process_id} worker_id=${this.worker_id} request=${request}`)
    //     try {
    //         if (process_id === this.worker_id)      // shortcut when sending to itself, on master or worker
    //             return process_id ? await this.rpc_exec(request) : await this.rpc_send(request)
    //
    //         if (process_id) {
    //             assert(this.is_master())
    //             let worker = this.get_worker(process_id)
    //             return await worker.mailbox.send(request)
    //         }
    //         else {
    //             assert(this.is_worker())
    //             return await schemat.kernel.mailbox.send(request)
    //         }
    //     }
    //     catch (ex) {
    //         // this._print(`ipc_send() FAILED request to proc #${process_id}:`, JSON.stringify(request))
    //         throw this._rich_exception(ex, request)
    //     }
    // }
    //
    // ipc_master(message) {
    //     /* On master process, handle an IPC message received from a worker process or directly from itself.
    //        IPC calls do NOT perform JSONx-encoding/decoding of arguments/result, so the latter must be
    //        plain JSON-serializable objects, or already JSONx-encoded.
    //      */
    //     // this._print(`ipc_master():`, JSON.stringify(message))
    //     return this.rpc_send(message)
    // }
    //
    // ipc_worker(message) {
    //     // this._print(`ipc_worker():`, JSON.stringify(msg))
    //     return this.rpc_exec(message)
    // }


    /* TCP: horizontal communication between nodes */

    async tcp_send(node, msg) {
        /* On master process, send a message to another node via TCP. */
        // print("tcp_send():", JSON.stringify(msg))
        assert(this.is_master())
        if (!node.is_loaded()) await node.load()    // target node's TCP address is needed
        return this.$state.tcp_sender.send(msg, node.tcp_address)
    }

    tcp_recv(message) {
        /* On master process, handle a message received via TCP from another node.
           `msg` is a plain object/array whose elements may still need to be JSONx-decoded.
         */
        assert(this.is_master())
        if (RPC_Request.is_private(message)) throw new Error(`cannot handle a private message received from another node`)
        return this.rpc_recv(message)
    }


    /* Managing agents */

    _has_agent(agent) {
        /* True if there is at least one running instance of `agent` (any role) on this node. For install/uninstall. */
        return this.$state.local_placements.has(agent)
    }

    async '$master.update_placements'(placements) {
        /* Update global_placements with a new configuration sent by cluster.$leader. */
        // this._print(`Node.$master.update_placements() received:`, placements._placements)
        this.$state.global_placements = placements
    }

    async '$master.start_agent'(agent, role, {worker, copies = 1, migrate} = {}) {
        /* Start `agent` (object or ID) on this node: first, install it if needed, then find the least busy
           worker process and start (agent, role) there.
         */
        agent = await schemat.as_loaded(agent)
        this._print(`$master.start_agent(${agent}, ${role})`)

        // install the agent unless it's already deployed here on this node
        if (!this._has_agent(agent)) await agent.__install__(this)

        let {local_placements} = this.$state
        // if (local_placements.has(agent, role)) throw new Error(`agent ${agent}.${role} is already running on node ${this}`)

        if (copies > this.num_workers) throw new Error(`no. of copies (${copies}) must be <= ${this.num_workers}`)
        if (copies === -1) copies = this.num_workers

        let workers = worker ? (Array.isArray(worker) ? worker : [worker]) : local_placements.rank_places()
        workers = workers.slice(0, copies)

        if (role === null || role === AgentRole.GENERIC)
            role = undefined             // the default role "$agent" is passed implicitly
        
        for (let worker of workers) {                                   // start `agent` on each of `workers`
            assert(worker >= 1 && worker <= this.num_workers)
            await this.$worker({worker})._start_agent(agent.id, role, {migrate})
            local_placements.add(worker, agent, role)
        }

        this.agents = local_placements.get_status()
        await this.save()

        // agents = local_placements.get_status()
        // await this.update_self({agents}).save()     // save new configuration of agents to DB

        return copies
    }

    async '$master.stop_agent'(agent, role = AgentRole.ANY, {worker} = {}) {
        /* Stop and uninstall (agent, role) from this node. All messages addressed to (agent, role) will be discarded from now on. */
        this._print(`$master.stop_agent(${agent}, ${role})`)
        // this._print(`$master.stop_agent() agents:`, this.$state.agents.map(({worker, agent, role}) => ({worker, id: agent.id, role})))

        agent = await schemat.as_loaded(agent)

        let {local_placements} = this.$state
        let stop = local_placements.find_all(agent, role)

        // let stop = agents.filter(st => st.id === agent.id && (!role || st.role === role)).map(({worker}) => worker)
        // this.$state.agents = agents = agents.filter(st => !(st.id === agent.id && (!role || st.role === role)))

        if (!stop.length) return

        // stop every agent from `stop`, in reverse order
        for (let worker of stop.reverse()) {
            local_placements.remove(worker, agent, role)
            await this.$worker({worker})._stop_agent(agent.id, role)
        }
        this.agents = local_placements.get_status()

        await Promise.all([
            // this.update_self({agents}).save(),                   // save new configuration of agents to DB
            this.save(),                                            // save new configuration of agents to DB
            !this._has_agent(agent) && agent.__uninstall__(this)    // uninstall the agent locally if the last deployment was removed
        ])
    }

    _rank_workers(agents) {
        /* Order workers by utilization, from least to most busy. */
        let workers = agents.map(status => status.worker).filter(w => w >= 1)     // pull out worker IDs, skip the master process (0)
        let counts = new Counter(workers)
        let sorted = counts.least_common()
        return sorted.map(entry => entry[0])
    }

    async '$worker._start_agent'(agent_id, role, opts) {
        /* Start agent on the current worker process. */
        await schemat.kernel.start_agent(agent_id, role, opts)
    }

    async '$worker._stop_agent'(agent_id, role) {
        await schemat.kernel.stop_agent(agent_id, role)
    }

    // async '$worker._capture_records'(records) {}

}

