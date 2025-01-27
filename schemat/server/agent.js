import {print} from "../common/utils.js"
import {WebObject} from "../core/object.js"


/**********************************************************************************************************************/

export class Agent extends WebObject {
    /* A web object that can be installed on a particular node(s) in the cluster to run a perpetual operation there (a microservice).
       Typically, the agent runs a web server, or an intra-cluster microservice of any kind, with a perpetual event loop.
       The agent is allowed to use local resources of the host node: files, sockets, etc.; with some of them (typically files)
       being allocated/deallocated in __install__/__uninstall__(), while some others (e.g., sockets) in __start__/__stop__().
    */

    // __host / __host$ -- the host node(s) where this agent is installed/running
    // __meta.state     -- the state object returned by __start__(), to be passed to __stop__() when the microservice is to be terminated

    async __start__()     {}    // the returned state object is kept in __meta.state and then passed to __stop__()
    async __stop__(state) {}
}


export class KafkaAgent extends Agent {
    /* An agent whose event loop processes messages from a Kafka topic. The topic is named after this agent's ID. */

    async __init__() {
        await super.__init__()
        let {Kafka} = await import('kafkajs')

        this._kafka = new Kafka({
            clientId: `agent-${this.id}`,
            brokers: [`localhost:9092`]
        })
    }

    async __start__() {
        /* Start the agent. Return an object of the form {consumer, running}, where `running` is a Promise returned by consumer.run(). */
        let consumer = this._kafka.consumer({groupId: `group-${this.id}`, autoCommit: true})

        await consumer.connect()
        await consumer.subscribe({topic: `topic-${this.id}`, fromBeginning: true})
        
        let running = consumer.run({
            eachMessage: async ({topic, partition, message}) => {
                print(`${topic}[${partition}]: ${message.value}`)

                // // if autoCommit=false, manually commit the message offset
                // await consumer.commitOffsets([{topic, partition, offset: (BigInt(message.offset) + 1n).toString()}])
            }
        })
        return {consumer, running}
    }

    async __stop__({consumer, running}) {
        await consumer.disconnect()
        await running
    }
}

/**********************************************************************************************************************/

// export class Driver extends WebObject {}

export class KafkaBroker extends Agent {
    async __install__(node /*machine*/) {
        /*
           Assumption: Kafka must be already installed in /opt/kafka folder.
         */

        // node.site_root    -- root directory of the entire Schemat installation; working directory for every install/uninstall/start/stop
        // node.app_root     -- root directory of the application (can be a subfolder in site_root)

        let {exec} = await import('child_process')

        let id = node.id
        let kafka_root = node.kafka_root
        let kafka_path = `${kafka_root}/node-${id}`
        let props_path = `./schemat/server/kafka.properties`

        let host = node.kafka_host || node.host || 'localhost'
        let broker_port = node.kafka_port || 9092
        let controller_port = node.kafka_controller_port || 9093

        let overrides = [
            `--override node.id=${id}`,
            `--override log.dirs="${kafka_path}"`,
            `--override listeners=PLAINTEXT://${host}:${broker_port},CONTROLLER://${host}:${controller_port}`,
            `--override advertised.listeners=PLAINTEXT://${host}:${broker_port},CONTROLLER://${host}:${controller_port}`,
            `--override controller.quorum.voters=${id}@${host}:${controller_port}`,
        ].join(' ')

        // // create directory structure
        // let fs = await import('fs')
        // await fs.promises.mkdir(kafka_path, {recursive: true})

        // create local storage in ./local/kafka with a fixed cluster id ("CLUSTER"), but unique node.id:
        let command = `/opt/kafka/bin/kafka-storage.sh format -t CLUSTER -c ${props_path} ${overrides}`
        let {stdout, stderr} = await exec(command, {cwd: node.site_root})

        print(`Kafka storage formatted: ${stdout}`)
        if (stderr) print(`Kafka storage format stderr: ${stderr}`)
    }

    async __uninstall__(node) {
        let {exec} = await import('child_process')
        let {rm} = await import('fs/promises')
        
        // get paths
        let kafka_root = node.kafka_root
        let kafka_path = `${kafka_root}/node-${node.id}`
        
        // first remove the broker from the cluster
        let command = `/opt/kafka/bin/kafka-remove-broker.sh`
        let {stdout, stderr} = await exec(command, {cwd: node.site_root})
        
        print(`Kafka broker removed: ${stdout}`)
        if (stderr) print(`Kafka broker removal stderr: ${stderr}`)
        
        // then it's safe to remove the data directory
        await rm(kafka_path, {recursive: true, force: true})
        print(`Removed Kafka data directory: ${kafka_path}`)
    }

    async __start__() {
        // start Kafka broker
        // /opt/kafka/bin/kafka-server-start.sh ${props_path} ${overrides}
    }
    async __stop__() {
        // /opt/kafka/bin/kafka-server-stop.sh
    }
}