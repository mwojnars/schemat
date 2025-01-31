import {assert, print, tryimport} from "../common/utils.js"
import {WebObject} from "../core/object.js"
import {mJsonx, mJsonxArray} from "../web/messages.js";
import {Service} from "../web/services.js";

let {Kafka} = await tryimport('kafkajs') || {}
let {exec} = await tryimport('child_process') || {}     // node:child_process
let {promisify} = await tryimport('util') || {}         // node:util
let {readFile, writeFile, mkdir, rm} = await tryimport('fs/promises') || {}
let exec_promise = exec && promisify(exec)


/**********************************************************************************************************************/

export class KafkaService extends Service {

    _is_local(target) {
        assert(target.is_loaded())
        assert(target.__node, 'not an agent or not deployed anywhere')
        return target.__node.id === schemat.node.id
        // return target.__node$.some(node => node.id === schemat.node.id)
    }

    async _submit(target, message) {
        if (this.endpoint_type !== 'KAFKA') throw new Error(`KafkaService can only be exposed at KAFKA endpoint, not ${this.endpoint}`)
        if (message && typeof message !== 'string') message = JSON.stringify(message)

        // send `message` to the target's topic
        let topic = target.__kafka_topic
        return schemat.node.kafka_send({topic, messages: [{value: message}]})   // send via a shared Kafka producer

        // let producer = schemat.node.kafka_producer      // shared producer, already connected
        // return producer.send({topic, messages: [{value: message}]})

        // const topic = target.__kafka_topic
        // const producer = target._kafka.producer()
        // await producer.connect()
        // await producer.send({topic, messages: [{value: message}]})   // or sendBatch() to write multiple messages to different topics
        // await producer.disconnect()
    }
}

export class JsonKAFKA extends KafkaService {
    static input  = mJsonxArray
    static output = mJsonx
}


/**********************************************************************************************************************/

export class Agent extends WebObject {
    /* A web object that can be installed on a particular node(s) in the cluster to run a perpetual operation there (a microservice).
       Typically, the agent runs a web server, or an intra-cluster microservice of any kind, with a perpetual event loop.
       The agent is allowed to use local resources of the host node: files, sockets, etc.; with some of them (typically files)
       being allocated/deallocated in __install__/__uninstall__(), while some others (e.g., sockets) in __start__/__stop__().
    */

    // __node / __node$ -- the host node(s) where this agent is installed/running
    // __num_workers    -- 0/1/N, the number of concurrent workers per node that should execute this agent's loop at the same time; 0 = "all available"
    // __state          -- the state object returned by __start__(), to be passed to __stop__() when the microservice is to be terminated

    quick_restart

    async __install__(node) {}      // ideally, this method should be idempotent in case of failure and subsequent re-launch
    async __uninstall__(node) {}

    async __start__()     {}        // the returned state object is kept in this.__state and then passed to __stop__()
    async __stop__(state) {}

    async __restart__(state, prev) {
        /* In many cases, refreshing an agent in the worker process does NOT require full stop+start, which might have undesired side effects
           (temporary unavailability of the microservice). For this reason, __restart__() is called upon agent refresh - it can be customized
           in subclasses, and the default implementation either does nothing (if quick_restart=true), or performs the full stop+start cycle.
         */
        if (this.quick_restart) return state
        await prev.__stop__(state)
        return this.__start__()
    }
}


export class KafkaAgent extends Agent {
    /* An agent whose event loop processes messages from a Kafka topic. The topic is named after this agent's ID. */

    get __kafka_client() { return `agent-${this.id}` }
    get __kafka_topic()  { return `topic-${this.id}` }


    async __start__(start_consumer = true) {
        /* Start the agent. Return an object of the form {kafka, consumer, consumer_running},
           where `consumer_running` is a Promise returned by consumer.run().
         */
        assert(Kafka)
        let kafka = new Kafka({clientId: this.__kafka_client, brokers: [`localhost:9092`]})
        if (!start_consumer) return {kafka}

        const consumer = kafka.consumer({groupId: `group-${this.id}`, autoCommit: true})
        await consumer.connect()
        await consumer.subscribe({topic: this.__kafka_topic, fromBeginning: true})
        
        let consumer_running = consumer.run({
            eachMessage: async ({topic, partition, message}) => {
                print(`${topic}[${partition}]: ${message.value}`)

                // // if autoCommit=false, manually commit the message offset
                // await consumer.commitOffsets([{topic, partition, offset: (BigInt(message.offset) + 1n).toString()}])
            }
        })
        return {kafka, consumer, consumer_running}
    }

    async __stop__({consumer, consumer_running}) {
        await consumer?.disconnect()
        await consumer_running
    }
}

/**********************************************************************************************************************/

// export class Driver extends WebObject {}

export class KafkaBroker extends Agent {
    async __install__(node) {
        /* Assumption: Kafka must be already installed in /opt/kafka folder. */

        // node.site_root    -- root directory of the entire Schemat installation; working directory for every install/uninstall/start/stop
        // node.app_root     -- root directory of the application (can be a subfolder in site_root)

        let id = node.id
        let kafka_root = `./local/kafka`  //node.kafka_root
        let kafka_path = `${kafka_root}/node-${id}`
        let props_path = `./schemat/server/kafka.properties`

        let host = node.kafka_host || node.host || 'localhost'
        let broker_port = node.kafka_port || 9092
        let controller_port = node.kafka_controller_port || 9093

        // create directory structure
        await rm(kafka_path, {recursive: true, force: true})  // ensure the folder is empty
        await mkdir(kafka_path, {recursive: true})

        // let overrides = [
        //     `--override node.id=${id}`,
        //     `--override log.dirs="${kafka_path}"`,
        //     `--override listeners=PLAINTEXT://${host}:${broker_port},CONTROLLER://${host}:${controller_port}`,
        //     `--override advertised.listeners=PLAINTEXT://${host}:${broker_port},CONTROLLER://${host}:${controller_port}`,
        //     `--override controller.quorum.voters=${id}@${host}:${controller_port}`,
        // ].join(' ')

        // read and modify kafka.properties
        let properties = await readFile(props_path, 'utf8')
        properties = properties.replace(/node\.id=.*/, `node.id=${id}`)
        properties = properties.replace(/log\.dirs=.*/, `log.dirs=${kafka_path}`)
        properties = properties.replace(/listeners=.*/, `listeners=PLAINTEXT://${host}:${broker_port},CONTROLLER://${host}:${controller_port}`)
        properties = properties.replace(/advertised\.listeners=.*/, `advertised.listeners=PLAINTEXT://${host}:${broker_port},CONTROLLER://${host}:${controller_port}`)
        properties = properties.replace(/controller\.quorum\.voters=.*/, `controller.quorum.voters=${id}@${host}:${controller_port}`)

        // save the modified properties file
        let modified_props_path = `${kafka_path}/kafka.properties`
        await writeFile(modified_props_path, properties)

        // create local storage in ./local/kafka with a fixed cluster id ("CLUSTER"), but unique node.id:
        let command = `/opt/kafka/bin/kafka-storage.sh format -t CLUSTER -c ${modified_props_path}`
        print('KafkaBroker.__install__():', command)

        let {stdout, stderr} = await exec_promise(command, {cwd: node.site_root})

        print(`Kafka storage formatted: ${stdout}`)
        if (stderr) print(`Kafka storage format stderr: ${stderr}`)
    }

    async __uninstall__(node) {
        /* Revert the installation of the Kafka broker. It is assumed that the broker is already stopped, so the data directory can be safely removed. */
        let kafka_root = `./local/kafka`  //node.kafka_root
        let kafka_path = `${kafka_root}/node-${node.id}`
        await rm(kafka_path, {recursive: true, force: true})
        print(`KafkaBroker.__uninstall__() removed: ${kafka_path}`)
    }

    async __start__() {
        // start Kafka broker
        // /opt/kafka/bin/kafka-server-start.sh ${props_path} ${overrides}
    }
    async __stop__() {
        // /opt/kafka/bin/kafka-server-stop.sh
    }
}