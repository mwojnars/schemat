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
        let {Kafka} = (await import('kafkajs'))

        this._kafka = new Kafka({
            clientId: `agent-${this.id}`,
            brokers: [this.machine.kafka_host]
        })
    }

    async __start__() {
        let consumer = this._kafka.consumer({groupId: `group-${this.id}`})
        await consumer.connect()
        await consumer.subscribe({topic: this.id, fromBeginning: true})
        await consumer.run({
            eachMessage: async ({topic, partition, message}) => {
                print(`${topic}[${partition}]: ${message.value}`)
            }
        })
    }
}
