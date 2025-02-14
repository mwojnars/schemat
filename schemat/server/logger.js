import {assert, print, utc} from '../common/utils.js'
import {JsonKAFKA, KafkaAgent} from "./kafka.js";


export class Logger extends KafkaAgent {
    /* Receives debug messages in its private Kafka topic. Performs post-processing, persistence,
       and periodical cleanup of old messages.
     */

    'KAFKA.log'() {
        return new JsonKAFKA({
            server: async (msg, args = null, level = 'INFO') => {
                if (args) {
                    let list = Object.entries(args).map(([k, v]) => k + `=${JSON.stringify(v)}`).join(', ')
                    if (list) msg = `${msg} | ${list}`
                }
                print(`[${utc()}] ${level.padStart(5)}: ${msg}`)
            }
        })
    }

}

