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
        return Catalog.merge(configs)
    }
}

/**********************************************************************************************************************/

export class Mailbox {
    /* Send messages via a one-way communication channel and (optionally) wait for responses on another channel of the same type.
       Here, "requests" are messages that are followed by a response, while "notifications" are fire-and-forget messages (no response).
       The details of the channel are implemented in subclasses by overriding the `_listen()` and `_send()` methods.
     */

    constructor(callback, timeout = null) { //10000) {
        this.callback = callback        // processing function for incoming messages
        this.counter = 0                // no. of requests sent so far
        this.pending = new Map()        // requests sent awaiting a response

        this.timeout = timeout          // timeout for waiting for a response
        this.timestamps = new Map()     // timestamps for pending requests
        this.interval = timeout ? setInterval(() => this._check_timeouts(), timeout) : null
    }

    async send(msg) {
        /* Send `msg` to the peer and wait for the response. */
        return new Promise((resolve, reject) => {
            const id = ++this.counter
            this.pending.set(id, resolve)
            this._send([id, msg])

            if (this.timeout) {           // add timeout for safety
                this.timestamps.set(id, {
                    timestamp: Date.now(),
                    reject: reject
                })
            }
        })
    }

    notify(msg) {
        /* Send a message without waiting for a response (fire-and-forget). */
        this._send([0, msg])
    }

    _check_timeouts() {
        const now = Date.now()
        for (const [id, {timestamp, reject}] of this.timestamps.entries()) {
            if (now - timestamp > this.timeout) {
                this.timestamps.delete(id)
                this.pending.delete(id)
                reject(new Error(`timeout for request ${id}`))
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

    _handle_response([id, response]) {
        id = -id
        if (this.pending.has(id)) {
            this.pending.get(id)(response)      // resolve the promise with the response
            this.pending.delete(id)
            this.timestamps.delete(id)
        }
        else console.warn(`unknown response id: ${id}`)
    }

    async _handle_message([id, msg]) {
        if (id < 0) return this._handle_response([id, msg])     // received a response from the peer

        let response = this.callback(msg)                       // received a message: run the callback
        if (id === 0) return

        // send response to the peer, negative ID indicates this is a response not a message
        if (response instanceof Promise) response = await response
        return this._send([-id, response])
    }

    _listen()       { throw new Error('not implemented') }
    _send(message)  { throw new Error('not implemented') }
}

export class IPC_Mailbox extends Mailbox {
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

    // node as an agent is deployed on itself and runs on master process
    get __node() { return this }

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

    async __start__() {
        let tcp_sender = new TCP_Sender()
        let tcp_receiver = new TCP_Receiver()

        await tcp_sender.start(this.tcp_retry_interval * 1000)
        await tcp_receiver.start(this._tcp_port)

        let agent_locations = this._allocate_agents()
        return {tcp_sender, tcp_receiver, agent_locations}
    }

    async __restart__(state, prev) {
        state.agent_locations = this._allocate_agents()     // re-allocate agents in case their configuration changed
        return state
    }

    async __stop__({tcp_sender, tcp_receiver}) {
        await tcp_receiver.stop()
        await tcp_sender.stop()
    }

    _allocate_agents() {
        /* For each process (master = 0, workers = 1,2,3...), create a list of agent IDs that should be running on this process.
           Notify each sublist to a corresponding process. Return an inverted Map: agent ID -> array of process IDs.
         */
        let N = schemat.kernel.workers.length
        assert(N >= 1)

        let current_worker = 1
        let plan = Array.from({length: N + 1}, () => [])

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
            worker.mailbox.notify(['SYS', 'sys_agents_running', [plan[i]]])
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

    sys_agents_running(agents) { schemat.kernel.set_agents_running(agents) }


    /* RPC calls to other processes or nodes */

    request_rpc(target_id, method, args) {
        /* Send an RPC message to the master process via IPC channel, for it to be sent over the network to another node
           and then to the `target_id` object (agent) where it should invoke its 'remote.<method>'(...args).
           Return a response from the remote target.
         */
        let msg = [target_id, method, JSONx.encode(args)]
        let message = ['RPC', ...msg]       // , schemat.tx

        // check if the target object is deployed here on the current process, then no need to look any further
        // -- this rule is important for loading data blocks during and after bootstrap
        let frame = schemat.get_frame(target_id)
        if (frame) return this.execute_rpc(...msg)

        return this.is_master() ? this.from_worker(message) : schemat.kernel.mailbox.send(message)
    }

    execute_rpc(target_id, method, args) {
        /* Execute an RPC message that's addressed to the agent `target_id` running on this process.
           Error is raised if the agent cannot be found, *no* forwarding. `args` are JSONx-encoded.
         */
        // print("execute_rpc():", [target_id, method, args])

        // locate an agent by its `target_id`, should be running here in this process
        let frame = schemat.get_frame(target_id)
        if (!frame) throw new Error(`agent [${target_id}] not found on this node process`)
        return frame.call_agent(`remote.${method}`, JSONx.decode(args))
    }


    /* IPC: vertical communication between master/worker processes */

    async from_worker([type, ...msg]) {
        /* On master process, handle an IPC message received from a worker process, or directly from itself. */
        assert(this.is_master())
        let node, target

        if (type === 'RPC') {
            // this._print(`from_worker():`, JSON.stringify(msg))
            let [target_id, method, args] = msg
            // print(`from_worker():`, `target_id=${target_id} method=${method} args[0]=${args[0]}`) // JSON.stringify(msg))

            // check if the target object is deployed here on this node, then no need to look any further
            // -- this rule is important for loading data blocks during and after bootstrap
            let locs = this.local.agent_locations.get(target_id)
            if (locs?.length) node = this
            else {
                // load the object and check its __node to locate the destination where it is deployed
                target = await schemat.get_loaded(target_id)
                node = target.__node
            }

            if (!node)
                throw new Error(`missing host node for RPC target ${target.__label}`)
            if (node.is(schemat.node)) {
                // this._print(`from_worker(): redirecting to self`)
                return this.recv_tcp([type, ...msg])     // target agent is deployed on the current node
            }

            await node.load()
            // this._print(`from_worker(): sending to ${node.id} at ${node.tcp_address}`)

            return this.send_tcp(node, [type, ...msg])
        }
        else throw new Error(`unknown worker-to-master message type: ${type}`)
    }

    from_master([type, ...msg]) {
        // this._print(`from_master(${type}):`, JSON.stringify(msg))
        if (type === 'RPC') return this.execute_rpc(...msg)
        if (type === 'SYS') {
            let [method, args] = msg
            return this[method](...args)
        }
    }


    /* TCP: horizontal communication between nodes */

    async send_tcp(node, msg) {
        /* On master process, send a message to another node via TCP. */
        assert(this.is_master())
        if (!node.is_loaded()) await node.load()    // target node's TCP address is needed
        return this.local.tcp_sender.send(msg, node.tcp_address)
    }

    recv_tcp([type, ...msg]) {
        /* On master process, handle a message received via TCP from another node or directly from this node via a shortcut.
           `msg` is a plain object/array whose elements may still need to be JSONx-decoded.
         */
        assert(this.is_master())
        // this._print(`recv_tcp():`, JSON.stringify(msg))

        if (type === 'RPC') {
            let [target_id] = msg

            // find out which process (worker >= 1 or master = 0), has the `target_id` agent deployed
            let locs = this.local.agent_locations.get(target_id)
            if (locs.length > 1) throw new Error(`TCP target agent [${target_id}] is deployed multiple times on ${this.__label}`)

            let process_id = locs[0]
            // print("recv_tcp(): process", process_id)

            if (process_id === undefined) {
                this._print(`agent locations:`, [...this.local.agent_locations.entries()])
                throw new Error(`${this.id}/#${this.worker_id}: agent [${target_id}] not found on this node`)
            }
            if (process_id !== this.worker_id) {
                assert(process_id > 0)
                let worker = schemat.kernel.get_worker(process_id)
                return worker.mailbox.send([type, ...msg])          // forward the message down to a worker process, to its from_master()
            }
            return this.execute_rpc(...msg)                         // process the message here in the master process
        }
        else throw new Error(`unknown node-to-node message type: ${type}`)
    }


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


    async 'remote.install'(name, agent, {start = true, workers = true, master = false} = {}) {
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

    async 'remote.uninstall'(agent) {
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

