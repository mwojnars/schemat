import {assert, print, timeout, sleep} from '../common/utils.js'
import {JSONx} from "../common/jsonx.js";
import {WebObject} from "../core/object.js";
import {JsonKAFKA} from "./kafka.js";


/**********************************************************************************************************************/

export class Node extends WebObject {
    /* Node of a Schemat cluster. Technically, each node is a local (master) process launched independently
       on a particular machine, together with its child (worker) processes, if any. Nodes communicate with each other
       using Kafka, and in this way they form a distributed compute & storage cluster.

       The node, as an Agent, must NOT have any __install__() or __uninstall__() method, because these methods will never
       be launched: the node is assumed to be installed on itself without any installation procedure and without
       being included in `agents_installed`. The node is added implicitly to the list of currently
       running agents in Process._get_agents_running().
     */

    agents_installed
    agents_running
    master_agents_running
    refresh_interval
    tcp_port

    // Node is not strictly an agent, but can be used as a target in KafkaService, hence the overrides below:
    get __node()        { return this }                 // for KafkaService._is_local()

    // get __kafka_topic() { return `topic-${this.id}` }   // for KafkaService._submit()
    // get kafka_client() { return this.__state?.kafka }
    // get kafka_client() { return this.schemat.agents.get('kafka_client').__state.kafka }
    // get kafka_producer() { return this.__state.producer }
    // is_master_process() { return !this.worker_id}
    //
    // kafka_send(topic, message) {
    //     let kafka = schemat.process.states.get('kafka_master')
    //     if (!kafka) throw new Error(`kafka_worker is not running`)
    //     if (!kafka.producer) throw new Error(`missing producer in kafka_worker`)
    //     return kafka.producer.send({topic, messages: [message]})        // or sendBatch() to write multiple messages to different topics
    //     // return this.__state.kafka_worker.producer.send({topic, messages: [{value: message}]})    // or sendBatch() to write multiple messages to different topics
    // }

    send_remote(id, name, ...args) {
        let msg = ['RPC', id, name, JSONx.encode(args)]       // , schemat.tx
        return process.send(msg)
    }

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

