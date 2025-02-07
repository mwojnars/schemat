import {assert, print, timeout, sleep} from '../common/utils.js'
import {JsonKAFKA, KafkaClient} from "./kafka.js";


/**********************************************************************************************************************/

export class Node extends KafkaClient {
    /* Node of a Schemat cluster. Technically, each node is a local (master) process launched independently
       on a particular machine, together with its child (worker) processes, if any. Nodes communicate with each other
       using Kafka, and in this way they form a distributed compute & storage cluster.

       The node, as an Agent, must NOT have any __install__() or __uninstall__() method, because these methods will never
       be launched: the node is assumed to be installed on itself without any installation procedure and without
       being included in the `agents_installed` list. The node is added implicitly to the list of currently
       running agents in Process._get_agents_running().
     */

    agents_installed
    agents_running
    master_agents_running
    refresh_interval

    get worker_id() {
        /* Numeric ID (1, 2, 3, ...) of the current worker process; 0 for the master process. */
        return process.env.WORKER_ID || 0
    }

    get __kafka_client() { return `node-${this.id}-worker-${this.worker_id}` }

    get kafka() { return this.__state.kafka }
    // get kafka() { return this.schemat.agents.get('kafka_client').__state.kafka }
    // get kafka_producer() { return this.__state.producer }

    is_master_process() { return !this.worker_id}

    kafka_send(topic, message) {
        return this.__state.producer.send({topic, messages: [{value: message}]})    // or sendBatch() to write multiple messages to different topics
    }

    async __start__() {
        let start_consumer = this.is_master_process()       // only the master process deploys a node-wise consumer
        let {kafka, ...rest} = await super.__start__(start_consumer)
        let retry = {initialRetryTime: 1000, retries: 10}

        let producer = kafka.producer({retry})     // each node process (master/worker) has a single shared Kafka producer
        await producer.connect()

        // try { await producer.connect() } catch (ex)
        // {
        //     print(`Kafka producer connection error:`, ex)
        //     return {kafka, ...rest, failed: true}
        // }
        return {kafka, producer, ...rest}
    }

    async __stop__({producer, ...rest}) {
        await producer?.disconnect()
        await super.__stop__(rest)
    }


    'edit.add_installed'(agent) {
        /* Check that the `agent` is not yet in the array of agents_installed and add it at the end. Idempotent. */
        if (this.agents_installed.every(a => a.id !== agent.id))
            this.agents_installed.push(agent)
    }

    'edit.delete_installed'(agent) {
        /* Remove the `agent` from the list of agents_installed. Idempotent. */
        this.agents_installed = this.agents_installed.filter(a => a.id !== agent.id)
    }

    'edit.add_running'(agent, {workers = true, master = false}) {
        /* Check that the `agent` is installed and not yet on the list of agents_running and/or master_agents_running,
           then add it to the corresponding array(s). Idempotent.
         */
        if (!this.agents_installed?.some(a => a.id === agent.id)) throw new Error(`agent [${agent.id}] is not installed on node [${this.id}]`)

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
        return new JsonKAFKA({
            server: async (agent, {start = true, workers = true, master = false} = {}) => {
                await agent.load()
                await agent.__install__(this)       // can modify the local environment of the host node

                let node = this.get_mutable()
                node.edit.add_installed(agent)
                // node.edit('agents_installed', []).add(agent)

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

    async 'action.start'(agent) {
        // confirm that `agent` is installed and stopped...

        this.agents_running.push(agent)
        await this.save()
    }
    async 'action.stop'(agent) {}
}

