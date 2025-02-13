import {KafkaAgent} from "./kafka.js";


export class Logger extends KafkaAgent {
    /* Receives debug messages in its private Kafka topic. Performs post-processing, persistence,
       and periodical clean-up of old messages.
     */
}

