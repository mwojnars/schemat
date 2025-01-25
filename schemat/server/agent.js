import {print} from "../common/utils.js"
import {WebObject} from "../core/object.js"


/**********************************************************************************************************************/

export class Agent extends WebObject {
    /* A web object that can be installed on a particular machine(s) in the cluster to run a perpetual operation there (a microservice).
       Typically, the agent runs a web server, or an intra-cluster microservice of any kind, with a perpetual event loop.
       The agent is allowed to use local resources of the host machine: files, sockets, etc.; with some of them (typically files)
       being allocated/deallocated in __install__/__uninstall__(), while some others (e.g., sockets) in __start__/__stop__().
    */

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

export class Driver extends WebObject {
}

export class KafkaBroker extends Driver {
    async __install__() {
        /*
           Assumptions:
           - Kafka is already installed in /opt/kafka
           - local storage and server.properties were created in ./local/kafka, with a fixed cluster id ("CLUSTER"):
             $ /opt/kafka/bin/kafka-storage.sh format -t CLUSTER -c ./local/kafka/server.properties
         */

        let cluster_id = `cluster-${schemat.site.id}`
        let kafka_root = `./local/kafka`
        // schemat.machine.site_root    -- root directory of the entire Schemat installation; working directory for every install/uninstall/start/stop
        // schemat.machine.app_root     -- root directory of the application (can be a subfolder in site_root)

        // /opt/kafka/bin/kafka-storage.sh format -t "${cluster_id}" -c ${kafka_root}/server.properties
        // /opt/kafka/bin/kafka-server-start.sh ${kafka_root}/server.properties
    }
}