/*
    Kafka-related classes of web objects.

    Kafka debugging:
    - netstat -tulnp | grep 9092                                        << check if Kafka is listening on port 9092 and get the process PID
    - ./kafka-topics.sh --list --bootstrap-server localhost:9092        << list kafka topics
    - ./kafka-console-producer.sh --bootstrap-server localhost:9092 --topic topic-1024      << send test messages to a topic
 */

import {assert, print, sleep, tryimport} from "../common/utils.js"
import {mJsonx, mJsonxArray} from "../web/messages.js";
import {Service} from "../web/services.js";
import {Agent} from "./agent.js";

let {Kafka, logLevel} = await tryimport('kafkajs') || {}
let {exec, spawn} = await tryimport('child_process') || {}     // node:child_process
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
        // return schemat.get_agent('kafka_client').kafka_send(topic, message)
    }
}

export class JsonKAFKA extends KafkaService {
    static input  = mJsonxArray
    static output = mJsonx
}


/**********************************************************************************************************************/

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
        let broker_port = schemat.config['kafka-port'] || node.kafka_port || 9092
        let controller_port = schemat.config['kafka-controller-port'] || node.kafka_controller_port || 9093

        return new Map([
            ['node.id', id],
            ['log.dirs', this.kafka_path],
            ['listeners', `PLAINTEXT://${host}:${broker_port},CONTROLLER://${host}:${controller_port}`],
            ['advertised.listeners', `PLAINTEXT://${host}:${broker_port},CONTROLLER://${host}:${controller_port}`],
            ['controller.quorum.voters', `${id}@${host}:${controller_port}`]
        ])
    }

    async __install__() {
        /* Create a customized .properties file and format the dedicated Kafka folder for this node's broker.
           Assumption: Kafka must be already installed in /opt/kafka folder.
         */
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

    async __start__(verbose = false) {
        process.env.KAFKAJS_NO_PARTITIONER_WARNING = '1'  // silence partitioner warning

        await this._kill_kafka_server()

        // apply overrides using --override option
        let overrides = Array.from(this.settings).map(([key, value]) => `--override ${key}=${value}`).join(' ')
        let command = `/opt/kafka/bin/kafka-server-start.sh ${this.props_path} ${overrides}`
        print('KafkaBroker.__start__():', command)

        // let server = exec_promise(command, {cwd: schemat.node.site_root})
        // let server = spawn(command, {cwd: schemat.node.site_root, shell: true, stdio: 'ignore'})    // stdio needs to be detached from parent's stdio

        // stdio needs to be detached from parent's stdio; detached=true to create a new process group
        let server = spawn(command, {cwd: schemat.node.site_root, shell: true, stdio: ['ignore', 'pipe', 'pipe'], detached: true})
        if (verbose) {
            server.stdout.on('data', data => console.log(`${data}`))
            server.stderr.on('data', data => console.error(`${data}`))
        }

        server.on('close', code => {
            let msg = `Kafka server process exited with code=${code}`
            if (code && !schemat.is_closing) throw new Error(msg); else print(msg)
        })
        server.unref()      // don't let parent process wait for this child

        print(`started Kafka server: PID=${server.pid}`)
        return {server}
    }

    async _kill_kafka_server() {
        /* Execute `ps` to check if Kafka processes (both shell and java) are running with the same `listeners` setting,
           and if so, kill them. These processes are most likely the remains after unclean shutdown of the previous
           execution of the same KafkaBroker.
         */
        let command = `ps aux | grep -E 'kafka-server-start\\.sh|kafka\\.Kafka' | grep ${this.settings.get('listeners')} | grep -v grep | awk '{print $2}'`
        print('KafkaBroker._kill_kafka_server():', command)

        let {stdout} = await exec_promise(command, {cwd: schemat.node.site_root})
        if (!stdout) return
        
        // stdout will contain PIDs of both processes, one per line (if they exist)
        let pids = stdout.trim().split('\n')
        for (let pid of pids) {
            print(`Killing Kafka process:`, pid)
            try {
                process.kill(-parseInt(pid), 'SIGKILL')     // try killing process group
                process.kill(parseInt(pid), 'SIGKILL')      // also try killing single process
            } catch (ex) {}                                 // ignore errors - process may already be dead
        }
        await sleep(2)
        print(`_kill_kafka_server(): done`)
    }

    async __stop__({server}) {
        if (!server) return
        print(`Killing Kafka server process PID=${server.pid}`)

        try { process.kill(-server.pid, 'SIGKILL') }        // kafka-server-stop.sh does the same: just killing the process by PID
        catch (ex) {
            print(`Failed to kill process ${server.pid}:`, ex)
        }

        try {
            // ({stdout, stderr} = await server)  // kafka-server-start.sh terminated here
            // print(`Kafka server stopped: ${stdout}`)
            // if (stderr) print(`Kafka server stop stderr: ${stderr}`)

            await new Promise((resolve, reject) => {
                server.on('close', resolve)
                server.on('error', reject)
            })
        } catch (ex) {          // termination error is normal and expected
            print(`stdout:`); print(ex.stdout)
            if (ex.stderr) { print(`stderr:`); print(ex.stderr) }
        }
    }
}


/**********************************************************************************************************************/

export class KafkaAgent extends Agent {
    /* An agent that - depending on the settings - creates a shared Kafka client, a permanently-connected Kafka producer,
       and/or a Kafka consumer that forwards all incoming messages to the __consume__() method (implemented in subclasses).
       The consumer only reads from a dedicated topic whose name is derived from this agent's ID.
     */

    // __meta.kafka_log_level   -- controls the current log level of Kafka client

    start_client
    start_consumer
    start_producer

    get __kafka_client() { return `agent-${this.id}` }
    get __kafka_topic()  { return `topic-${this.id}` }
    get __kafka_group()  { return `group-${this.id}` }

    _kafka_logger() {
        return () => ({namespace, level, label, log}) => {
            // print(this._kafka_log_level, {namespace, level, label, log})
            if (level <= this.__meta.kafka_log_level)
                console.error(`[KAFKA] ${label} @${log.clientId}: ${log.message}`)
        }
    }

    async __start__() {
        /* Start the agent. Return an object of the form {kafka, consumer, consumer_running},
           where `consumer_running` is a Promise returned by consumer.run().
         */
        assert(Kafka)
        this.__meta.kafka_log_level = logLevel.NOTHING    // available log levels: NOTHING (0), ERROR (1), WARN (2), INFO (3), DEBUG (4)

        let retry = {initialRetryTime: 1000, retries: 10}
        let port = schemat.config['kafka-port'] || schemat.node.kafka_port || 9092
        let broker = `${schemat.node.kafka_host}:${port}`

        // either use the global node.kafka_client, or create a new one
        let kafka = (!this.start_client && schemat.node.kafka_client) ||
            new Kafka({clientId: this.__kafka_client, brokers: [broker], logCreator: this._kafka_logger(), retry})

        let {consumer, consumer_running} = this.start_consumer ? await this._start_consumer(kafka, retry) : {}
        let {producer} = this.start_producer ? await this._start_producer(kafka, retry) : {}

        return {kafka, consumer, consumer_running, producer}
    }

    async _start_consumer(kafka, retry) {
        const admin = kafka.admin()
        await admin.connect()

        this.__meta.kafka_log_level = logLevel.WARN

        let topics = await admin.listTopics()
        print('Kafka topics:', topics)

        // create the topic if it doesn't exist
        await admin.createTopics({
            topics: [{topic: this.__kafka_topic, numPartitions: 1, replicationFactor: 1}],
            waitForLeaders: true
        })
        await admin.disconnect()

        const consumer = kafka.consumer({groupId: this.__kafka_group, autoCommit: true, retry})
        await consumer.connect()
        await consumer.subscribe({topic: this.__kafka_topic, fromBeginning: true})

        let consumer_running = consumer.run({
            eachMessage: ({topic, partition, message}) => this.__consume__(message, topic, partition)
        })

        return {consumer, consumer_running}
    }

    async _start_producer(kafka, retry) {
        let producer = kafka.producer({retry})
        await producer.connect()
        return {producer}
    }

    async __stop__({consumer, consumer_running, producer}) {
        await producer?.disconnect()
        await consumer?.disconnect()
        await consumer_running
    }

    async __consume__(message, topic, partition) {
        /* Override this method to process incoming messages. */
        print(`${topic}[${partition}]: ${message.value}`)

        // // if autoCommit=false, manually commit the message offset
        // await consumer.commitOffsets([{topic, partition, offset: (BigInt(message.offset) + 1n).toString()}])
    }
}


/**********************************************************************************************************************/

export class KafkaNode extends KafkaAgent {
    /* An agent that provides Kafka client functionality (producer/consumer) on behalf of a Node instance. */

    // Kafka identifiers use node's ID, not this object's
    get __kafka_client() { return `node-${schemat.node.id}-worker-${schemat.worker_id}` }
    get __kafka_topic()  { return `topic-${schemat.node.id}` }
    get __kafka_group()  { return `group-${schemat.node.id}` }

    // async __consume__(message) {
    //     return schemat.node._process_message(message)
    // }
}


