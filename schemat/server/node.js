import {assert, print, timeout, sleep} from '../common/utils.js'
import {JSONx} from "../common/jsonx.js";
import {Agent} from "./agent.js";
import {JsonKAFKA} from "./kafka.js";


/**********************************************************************************************************************/

export class Node extends Agent {
    /* Node of a Schemat cluster. Technically, each node is a local (master) process launched independently
       on a particular machine, together with its child (worker) processes, if any. Nodes communicate with each other
       using Kafka, and in this way they form a distributed compute & storage cluster.

       The node, as an Agent, must NOT have any __install__() or __uninstall__() method, because these methods will never
       be launched: the node is assumed to be installed on itself without any installation procedure and without
       being included in `agents_installed`. The node is added implicitly to the list of currently
       running agents in Process._get_agents_running().
     */

    data_directory
    agents_installed
    agents_running
    master_agents_running
    refresh_interval
    http_host
    http_port
    https_port
    tcp_host
    tcp_port

    // get __kafka_topic() { return `topic-${this.id}` }   // for KafkaService._submit()
    // get kafka_client() { return this.__state?.kafka }
    // get kafka_client() { return this.schemat.agents.get('kafka_client').__state.kafka }
    // get kafka_producer() { return this.__state.producer }
    //
    // kafka_send(topic, message) {
    //     let kafka = schemat.process.states.get('kafka_master')
    //     if (!kafka) throw new Error(`kafka_worker is not running`)
    //     if (!kafka.producer) throw new Error(`missing producer in kafka_worker`)
    //     return kafka.producer.send({topic, messages: [message]})        // or sendBatch() to write multiple messages to different topics
    //     // return this.__state.kafka_worker.producer.send({topic, messages: [{value: message}]})    // or sendBatch() to write multiple messages to different topics
    // }

    // node as an agent is deployed on itself and runs on master process
    get __node() { return this }

    get worker_id() { return schemat.process.worker_id }
    is_master()     { return schemat.process.is_master() }

    get tcp_address() {
        if (!this.tcp_host || !this.tcp_port) throw new Error(`tcp_host and tcp_port must be set`)
        return `${this.tcp_host}:${this.tcp_port}` 
    }


    /* outgoing message processing */

    send_rpc(target_id, method, ...args) {
        /* Send an RPC message to the master process via IPC channel, for it to be sent over the network to another node
           and then to the `target_id` object (agent) where it should invoke its 'remote.<method>'(...args). Wait for the returned result.
         */
        let msg = ['RPC', target_id, method, JSONx.encode(args)]       // , schemat.tx
        return this.is_master() ? this.from_worker(msg) : process.send(msg)
    }

    async from_worker([type, ...msg]) {
        /* On master process, handle an IPC message received from a worker process. */
        assert(this.is_master())

        if (type === 'RPC') {
            // print("from_worker():", msg)

            // locate the cluster node where the target object is deployed
            let [target_id] = msg
            let target = await schemat.get_loaded(target_id)
            let node = target.__node

            if (!node) throw new Error(`missing host node for RPC target [${target_id}]`)
            if (node.is(schemat.node)) return this.handle_tcp([type, ...msg])       // target agent is deployed on the current node

            return this.send_tcp(node, [type, ...msg])
        }
        else throw new Error(`unknown worker-to-master message type: ${type}`)
    }

    async send_tcp(node, msg) {
        /* On master process, send a message to another node via TCP. */
        assert(this.is_master())
        if (!node.is_loaded()) await node.load()    // target node's TCP address is needed

        let tcp_msg = msg
        return schemat.agents.tcp.send(tcp_msg, node.tcp_address)
    }

    /* incoming message processing */

    handle_tcp([type, ...msg]) {
        /* On master process, handle a message received via TCP from another node or directly from this node via a shortcut.
           `msg` is a plain object/array whose elements may still need to be JSONx-decoded.
         */
        assert(this.is_master())
        if (type === 'RPC') {
            let [target_id] = msg

            // find out which process (worker >= 1 or master = 0), has the `target_id` agent deployed
            let process_id = this.agent_locations.get(target_id)
            // print("handle_tcp(): process", process_id)

            if (process_id === undefined) throw new Error(`agent [${target_id}] not found on this node`)
            if (process_id !== this.worker_id) {
                assert(process_id > 0)
                let worker = schemat.process.workers[process_id - 1]    // workers 1,2,3... stored under indices 0,1,2...
                return worker.send([type, ...msg])      // forward the message down to a worker process, to its from_master()
            }
            return this.handle_rpc(msg)                 // process the message here in the master process
        }
        else throw new Error(`unknown node-to-node message type: ${type}`)
    }

    from_master([type, ...msg]) {
        assert(type === 'RPC')
        // print(`#${this.worker_id} from_master():`, [type, ...msg])
        return this.handle_rpc(msg)
    }

    handle_rpc([target_id, method, args]) {
        /* On master process, handle an incoming RPC message from another node that's addressed to the agent `target_id` running on this node.
           (??) In a rare case, the agent may have moved to another node in the meantime and the message has to be forwarded.
           `args` are JSONx-encoded.
         */
        // print("handle_rpc():", [target_id, method, args])

        // locate an agent by its `target_id`, should be running here in this process
        let state = schemat.process.agents.values().find(state => state.agent.id === target_id)
        if (!state) throw new Error(`agent [${target_id}] not found on this node process`)

        let {agent, context} = state
        let func = agent.__self[`remote.${method}`]
        if (!func) throw new Error(`agent [${target_id}] has no RPC endpoint "${method}"`)

        args = JSONx.decode(args)

        return state.track_call(func.call(agent, context, ...args))
    }

    get agent_locations() {
        /* Map of running agent IDs to process IDs: 0 for master, >=1 for workers. */
        let agents = new Map()
        agents.set(this.id, 0)          // the current node runs as an agent on master

        for (let name of this.master_agents_running) {
            let agent = this.agents_installed.get(name)
            agents.set(agent.id, 0)
        }
        for (let name of this.agents_running) {
            let agent = this.agents_installed.get(name)
            agents.set(agent.id, 1)
        }
        return agents
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
        /* Check that the `agent` is installed and not yet on the list of agents_running and/or master_agents_running,
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


    'KAFKA.install'() {
        /* Call agent.__install__() on this node and add the agent to `agents_installed`. If start=true, the agent
           is also added to `agents_running` and is started on the next iteration of the host process's life loop.
         */
        // process.chdir(this.local_root || schemat.site.local_root)
        return new JsonKAFKA({
            server: async (name, agent, {start = true, workers = true, master = false} = {}) => {
                await agent.load()
                await agent.__install__(this)       // can modify the local environment of the host node

                let node = this.get_mutable()
                node.edit.add_installed(name, agent)

                if (start) node.edit.add_running(agent, {workers, master})
                await node.save()
            }
        })
    }

    'KAFKA.uninstall'() {
        return new JsonKAFKA({
            server: async (agent) => {
                await agent.load()
                
                let node = this.get_mutable()
                node.edit.delete_running(agent)             // let workers know that the agent should be stopped
                await node.save()
                await sleep(this.refresh_interval * 2 + node.__ttl)     // TODO: wait for actual confirmation(s) that the agent is stopped on all processes

                node.edit.delete_installed(agent)           // mark the agent as uninstalled
                await node.save()
                
                await agent.__uninstall__(this)             // clean up any node-specific resources
            }
        })
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

