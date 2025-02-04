import {assert, print, sleep, tryimport} from "../common/utils.js"
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
        return schemat.node.kafka_send(topic, message)
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

    hard_restart

    async __install__(node) {}      // ideally, this method should be idempotent in case of failure and subsequent re-launch
    async __uninstall__(node) {}

    async __start__()     {}        // the returned state object is kept in this.__state and then passed to __stop__()
    async __stop__(state) {}

    async __restart__(state, prev) {
        /* In many cases, refreshing an agent in the worker process does NOT require full stop+start, which might have undesired side effects
           (temporary unavailability of the microservice). For this reason, __restart__() is called upon agent refresh - it can be customized
           in subclasses, and the default implementation either does nothing (default), or performs the full stop+start cycle (if hard_restart=true).
         */
        if (!this.hard_restart) return state
        await prev.__stop__(state)
        return this.__start__()
    }
}


export class KafkaAgent extends Agent {
    /* An agent whose event loop processes messages from a Kafka topic. The topic is named after this agent's ID. */

    get __kafka_client() { return `agent-${this.id}` }
    get __kafka_topic()  { return `topic-${this.id}` }


    async __start__({start_consumer = true, kafka} = {}) {
        /* Start the agent. Return an object of the form {kafka, consumer, consumer_running},
           where `consumer_running` is a Promise returned by consumer.run().
         */
        assert(Kafka)
        kafka ??= new Kafka({clientId: this.__kafka_client, brokers: [`localhost:9092`]})
        if (!start_consumer) return {kafka, start_consumer}

        const consumer = kafka.consumer({groupId: `group-${this.id}`, autoCommit: true})
        
        try { await consumer.connect() } catch (ex) 
        {
            print(`Kafka consumer connection error:`, ex)
            return {kafka, start_consumer}
        }
        await consumer.subscribe({topic: this.__kafka_topic, fromBeginning: true})
        
        let consumer_running = consumer.run({
            eachMessage: async ({topic, partition, message}) => {
                print(`${topic}[${partition}]: ${message.value}`)

                // // if autoCommit=false, manually commit the message offset
                // await consumer.commitOffsets([{topic, partition, offset: (BigInt(message.offset) + 1n).toString()}])
            }
        })
        return {kafka, consumer, consumer_running, start_consumer}
    }

    async __restart__(state) {
        // do a hard restart if connecting to Kafka failed on the previous start
        return (state.start_consumer && !state.consumer) ? this.__start__(state) : state
    }

    async __stop__({consumer, consumer_running}) {
        await consumer?.disconnect()
        await consumer_running
    }
}

/**********************************************************************************************************************/

// export class Driver extends WebObject {}

export class KafkaBroker extends Agent {

    // node.site_root    -- root directory of the entire Schemat installation; working directory for every install/uninstall/start/stop
    // node.app_root     -- root directory of the application (can be a subfolder in site_root)

    get kafka_root() { return schemat.node.kafka_root || `./local/kafka` }
    get kafka_path() { return `${this.kafka_root}/node-${schemat.node.id}` }
    get props_path() { return `${this.kafka_path}/kafka.properties` }

    get settings() {
        let node = schemat.node
        let id = node.id
        let host = node.kafka_host || node.host || 'localhost'
        let broker_port = node.kafka_port || 9092
        let controller_port = node.kafka_controller_port || 9093

        return new Map([
            ['node.id', id],
            ['log.dirs', this.kafka_path],
            ['listeners', `PLAINTEXT://${host}:${broker_port},CONTROLLER://${host}:${controller_port}`],
            ['advertised.listeners', `PLAINTEXT://${host}:${broker_port},CONTROLLER://${host}:${controller_port}`],
            ['controller.quorum.voters', `${id}@${host}:${controller_port}`]
        ])
    }

    async __install__() {
        /* Assumption: Kafka must be already installed in /opt/kafka folder. */

        let props_path_original = `./schemat/server/kafka.properties`

        // create directory structure, ensure the folder is empty
        await rm(this.kafka_path, {recursive: true, force: true})
        await mkdir(this.kafka_path, {recursive: true})

        // read and modify kafka.properties by applying overrides
        let properties = await readFile(props_path_original, 'utf8')

        for (let [key, value] of this.settings)
            properties = properties.replace(new RegExp(`${key.replace('.', '\\.')}=.*`), `${key}=${value}`)

        // save the modified properties file
        await writeFile(this.props_path, properties)

        // create local storage in ./local/kafka with a fixed cluster id ("CLUSTER"), but unique node.id:
        let command = `/opt/kafka/bin/kafka-storage.sh format -t CLUSTER -c ${this.props_path}`
        print('KafkaBroker.__install__():', command)

        let {stdout, stderr} = await exec_promise(command, {cwd: schemat.node.site_root})

        print(`Kafka storage formatted: ${stdout}`)
        if (stderr) print(`Kafka storage format stderr: ${stderr}`)
    }

    async __uninstall__() {
        /* Revert the installation of the Kafka broker. It is assumed that the broker is already stopped, so the data directory can be safely removed. */
        await rm(this.kafka_path, {recursive: true, force: true})
        print(`KafkaBroker.__uninstall__() removed: ${this.kafka_path}`)
    }

    async __start__() {
        // apply overrides using --override option
        let overrides = Array.from(this.settings).map(([key, value]) => `--override ${key}=${value}`).join(' ')
        let command = `/opt/kafka/bin/kafka-server-start.sh ${this.props_path} ${overrides}`
        print('KafkaBroker.__start__():', command)

        let server_running = exec_promise(command, {cwd: schemat.node.site_root})
        return {server_running}
    
        // let process = spawn(command, {cwd: schemat.node.site_root, shell: true})
        // process.stdout.on('data', data => print(`stdout: ${data}`))  // print stdout data
        // process.stderr.on('data', data => print(`stderr: ${data}`))  // print stderr data
        // process.on('close', code => print(`Kafka server process exited with code ${code}`))
        // return {server_running: process}
    }

    async __stop__({server_running}) {
        let command = `/opt/kafka/bin/kafka-server-stop.sh`
        print('KafkaBroker.__stop__():', command)

        let {stdout, stderr} = await exec_promise(command, {cwd: schemat.node.site_root})

        print(`Kafka broker stopped: ${stdout}`)
        if (stderr) print(`Kafka broker stop stderr: ${stderr}`)

        try {
            ({stdout, stderr} = await server_running)  // kafka-server-start.sh terminated here
            print(`Kafka server stopped: ${stdout}`)
            if (stderr) print(`Kafka server stop stderr: ${stderr}`)

            // await new Promise((resolve, reject) => {
            //     server_running.on('close', resolve)
            //     server_running.on('error', reject)
            // })
        } catch (ex) {
            print(`Kafka server termination caught error:`, ex)     // termination error is expected
            print(`stdout:`)
            print(ex.stdout)
            print(`stderr:`)
            print(ex.stderr)
        }
    }
}