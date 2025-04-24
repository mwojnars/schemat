import {assert, print, timeout, sleep} from '../common/utils.js'
import {JSONx} from "../common/jsonx.js";
import {Catalog} from "../core/catalog.js";
import {WebObject} from "../core/object.js";
import {Agent} from "./agent.js";
import {TCP_Receiver, TCP_Sender} from "./tcp.js";


/**********************************************************************************************************************/

class Config extends WebObject {
    /* Global server-side configuration that can be defined separately at cluster/node/site/command-line level
       and then combined in a particular Schemat process to control high-level behaviour of the node.
     */
    merge(...others) {
        /* The expected order of `others` is from least to most specific: [node config, site config, command-line config]. */
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

    async send(msg) {
        /* Send `msg` to the peer and wait for the response. */
        return new Promise((resolve, reject) => {
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

    data_directory
    agents_installed
    agents_running
    agent_refresh_interval
    http_host
    http_port
    https_port
    tcp_host
    tcp_port
    tcp_retry_interval

    get worker_id() { return schemat.kernel.worker_id }
    is_master()     { return schemat.kernel.is_master() }
    _print(...args) { print(`${this.id}/#${this.worker_id}`, ...args) }

    get _tcp_port() { return schemat.config['tcp-port'] || this.tcp_port }      // FIXME: workaround

    get tcp_address() {
        if (!this.tcp_host || !this._tcp_port) throw new Error(`TCP host and port must be configured`)
        return `${this.tcp_host}:${this._tcp_port}`
    }

    async __init__() {
        await Promise.all(this.agents_installed.map(agent => agent.load()))
    }


    /* This node as agent (on master only!) */

    async __start__() {
        /* On master only. */
        let tcp_sender = new TCP_Sender()
        let tcp_receiver = new TCP_Receiver()

        await tcp_sender.start(this.tcp_retry_interval * 1000)
        await tcp_receiver.start(this._tcp_port)

        let placements = this._place_agents()           // Map<agent ID, array of process IDs>
        return {tcp_sender, tcp_receiver, placements}
    }

    async __restart__(state, prev) {
        state.placements = this._place_agents()         // re-allocate agents in case their configuration changed
        return state
    }

    async __stop__({tcp_sender, tcp_receiver}) {
        await tcp_receiver.stop()
        await tcp_sender.stop()
    }

    _place_agents() {
        /* For each process (master = 0, workers = 1,2,3...), create a list of agent IDs that should be running on this process.
           Notify each sublist to a corresponding process. Return an inverted Map: agent ID -> array of process IDs.
         */
        let N = schemat.kernel.workers.length
        assert(N >= 1)

        let current_worker = 1
        let plan = Array.from({length: N + 1}, () => [])    // plan[k] is an array of agent IDs that should be running on worker `k`

        // distribute agents uniformly across worker processes
        for (let agent of this.agents_installed) {
            // assert(agent.is_loaded())
            let num_workers = agent.num_workers
            if (num_workers === -1) num_workers = N

            for (let i = 0; i < num_workers; i++) {
                plan[current_worker++].push(agent.id)
                if (current_worker > N) current_worker = 1
            }
        }
        this._print(`agents allocation:`, plan)

        // notify the plan to every process
        schemat.kernel.set_agents_running(plan[0])
        for (let i = 1; i <= N; i++) {
            let worker = schemat.kernel.get_worker(i)
            let message = this._sys_message('AGENTS_RUNNING', plan[i])
            worker.mailbox.notify(message)
        }

        // convert the plan to a Map<agent ID, array of process IDs>
        let locations = new Map()
        for (let i = 0; i <= N; i++)
            for (let agent of plan[i])
                if (locations.has(agent)) locations.get(agent).push(i)
                else locations.set(agent, [i])
        // this._print(`agents locations:`, locations)

        return locations
    }


    /* Agent routing */

    async find_node(agent_id, role) {
        // if agent is deployed on one of local processes, return this node
        if (this.find_process(agent_id) != null) return this
        return schemat.cluster.find_node(agent_id)  //,role
    }

    find_process(agent_id, role) {
        assert(this.$local?.placements, `placements not yet initialized`)
        return this.$local.placements.get(agent_id)?.[0]
    }


    /* Message formation & parsing */

    _rpc_request(agent_id, method, args = []) {
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
        let {result, error, records} = JSONx.decode(response)
        if (error) throw error
        if (records?.length) schemat.tx?.register_changes(...records)
        return result
        // return JSONx.decode_checked(response)
    }

    _sys_message(command, ...args) {
        return ['SYS', command, args]
    }

    _sys_parse(message) {
        let [type, command, args] = message
        assert(type === 'SYS', `incorrect message type, expected SYS`)
        return {type, command, args}
    }

    /* RPC calls to other processes or nodes */

    async rpc_send(agent_id, method, args) {
        /* Send an RPC message to the master process via IPC channel, so it gets sent over TCP to another node
           and then to the `agent_id` object (agent) where it should invoke its '$agent.<method>'(...args).
           Return a response from the remote target. RPC methods on sender/receiver automatically JSONx-encode/decode
           the arguments and the result of the function.
         */
        let message = this._rpc_request(agent_id, method, args)

        assert(schemat.kernel.agents_running, `kernel not yet initialized`)

        // check if the target object is deployed here on the current process, then no need to look any further
        // -- this rule is important for loading data blocks during and after bootstrap
        let frame = schemat.get_frame(agent_id)
        if (frame) return this._rpc_response_parse(await this.rpc_recv(message))

        // this._print("rpc_send():", JSON.stringify(message))

        let result = await (this.is_master() ? this.ipc_master(message) : schemat.kernel.mailbox.send(message))
        return this._rpc_response_parse(result)
    }

    async rpc_recv(message) {
        /* Execute an RPC message that's addressed to an agent running on this process.
           Error is raised if the agent cannot be found, *no* forwarding. `args` are JSONx-encoded.
         */
        let {agent_id, method, args, app_id, tx} = this._rpc_request_parse(message)
        if (tx?.debug) this._print("rpc_recv():", JSON.stringify(message))

        // locate the agent by its `agent_id`, should be running here in this process
        let frame = await this._find_frame(agent_id)
        if (!frame) throw new Error(`agent [${agent_id}] not found on this process`)

        // let call = () => frame.call_agent(`$agent.${method}`, args)
        // let result = await schemat.in_tx_context(app_id, tx, call)
        // return this._rpc_response(result)

        let call = async () => {
            let result = await frame.call_agent(`$agent.${method}`, args)
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
        if (type === 'RPC') return this.rpc_recv(message)
        if (type === 'SYS') {
            let {command, args} = this._sys_parse(message)
            return this[command](...args)
        }
    }


    /* TCP: horizontal communication between nodes */

    async tcp_send(node, msg) {
        /* On master process, send a message to another node via TCP. */
        // print("tcp_send():", JSON.stringify(msg))
        assert(this.is_master())
        if (!node.is_loaded()) await node.load()    // target node's TCP address is needed
        return this.$local.tcp_sender.send(msg, node.tcp_address)
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
            // if (locs.length > 1) throw new Error(`TCP target agent [${agent_id}] is deployed multiple times on ${this.__label}`)
            // let proc = locs[0]

            let proc = this.find_process(agent_id)
            // print("tcp_recv(): process", proc)

            if (proc === undefined) {
                // this._print(`agent locations:`, [...this.$local.placements.entries()])
                throw new Error(`${this.id}/#${this.worker_id}: agent [${agent_id}] not found on this node`)
            }
            if (proc !== this.worker_id) {
                assert(proc > 0)
                let worker = schemat.kernel.get_worker(proc)
                return worker.mailbox.send(message)             // forward the message down to a worker process, to its ipc_worker()
            }
            return this.rpc_recv(message)                       // process the message here in the master process
        }
        else throw new Error(`unknown node-to-node message type: ${type}`)
    }


    /* SYS: control signals between master <> worker processes */

    AGENTS_RUNNING(agents) {
        /* Set the list of agents that should be running now on this worker process. Sent by master. */
        // TODO: use START/STOP signals (per agent) instead of sending a list of all desired agents
        schemat.kernel.set_agents_running(agents)
    }

    // START_AGENT()
    // STOP_AGENT()
    // CACHE_RECORD() / REGISTER_RECORD()


    /*************/

    'edit.add_installed'(name, agent) {
        /* Add the agent to `agents_installed` under the given `name`. Idempotent. */

        // check that the name is not already taken
        let current = this.agents_installed.get(name)
        if (current && current.id !== agent.id) throw new Error(`an agent with the same name (${name}), id=${current.id}, is already installed on node [${this.id}]`)

        // check that the agent is not already installed under a different name
        let other_name = Array.from(this.agents_installed.entries()).find(([n, a]) => a.id === agent.id && n !== name)?.[0]
        if (other_name) throw new Error(`agent [${agent.id}] is already installed on node [${this.id}] under a different name (${other_name})`)

        this.agents_installed.set(name, agent)
    }

    'edit.delete_installed'(agent_or_name) {
        /* Remove the agent from `agents_installed`; agent_or_name is either an Agent object or its name in `agents_installed`. Idempotent. */

        if (typeof agent_or_name === 'string')
            this.agents_installed.delete(agent_or_name)
        else
            // search for the agent ID in the map and remove it
            for (let [name, agent] of this.agents_installed.entries())
                if (agent.id === agent_or_name.id) {
                    this.agents_installed.delete(name)
                    break
                }
    }

    'edit.add_running'(agent, {workers = true, master = false}) {
        /* Check that the `agent` is installed and not yet on the list of running agents,
           then add it to the corresponding array(s). Idempotent.
         */
        let agents = Array.from(this.agents_installed.values())
        if (!agents.some(a => a.id === agent.id)) throw new Error(`agent [${agent.id}] is not installed on node [${this.id}]`)

        if (workers && this.agents_running.every(a => a.id !== agent.id))
            this.agents_running.push(agent)

        if (master && this.master_agents_running.every(a => a.id !== agent.id))
            this.master_agents_running.push(agent)
    }

    'edit.delete_running'(agent) {
        /* Remove the `agent` from the list of agents_running and master_agents_running, if present. Idempotent. */
        this.agents_running = this.agents_running.filter(a => a.id !== agent.id)
        this.master_agents_running = this.master_agents_running.filter(a => a.id !== agent.id)
    }


    async '$agent.install'(name, agent, {start = true, workers = true, master = false} = {}) {
        /* Call agent.__install__() on this node and add the agent to `agents_installed`. If start=true, the agent
           is also added to `agents_running` and is started on the next iteration of the host process's life loop.
         */
        // process.chdir(this.local_root || schemat.site.local_root)
        await agent.load()
        await agent.__install__(this)       // can modify the local environment of the host node

        let node = this.get_mutable()
        node.edit.add_installed(name, agent)

        if (start) node.edit.add_running(agent, {workers, master})
        await node.save()
    }

    async '$agent.uninstall'(agent) {
        await agent.load()

        let node = this.get_mutable()
        node.edit.delete_running(agent)             // let workers know that the agent should be stopped
        await node.save()
        await sleep(this.agent_refresh_interval * 2 + node.__ttl)     // TODO: wait for actual confirmation(s) that the agent is stopped on all processes

        node.edit.delete_installed(agent)           // mark the agent as uninstalled
        await node.save()

        await agent.__uninstall__(this)             // clean up any node-specific resources
    }

    async 'action.start'(agent, opts = {}) {
        // TODO: confirm that agents are installed and stopped...
        // this.agents_running.push(agent)
        this.edit.add_running(agent, opts)
        await this.save()
    }

    async 'action.stop'(agent) {
        this.edit.delete_running(agent)
        await this.save()
    }
}

