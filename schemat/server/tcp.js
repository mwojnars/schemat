import net from 'net';
import { assert } from '../common/utils.js';
import {Agent} from "./agent.js";
import { JSONx } from '../common/jsonx.js';


/**********************************************************************************************************************/

class ChunkParser {
    // Generic chunk reassembly handler using newline delimiter
    constructor(callback) {
        this.buffer = ''
        this.callback = callback
    }

    feed(data) {
        this.buffer += data
        let messages = this.buffer.split('\n')
        this.buffer = messages.pop()
        messages.forEach(msg => msg && this.callback(msg))
    }
}

/**********************************************************************************************************************/

export class TCP_Sender extends Agent {
    /* Send messages to other nodes in the cluster via persistent connections. Generate unique identifiers
       for WRITE messages, process acknowledgements and resend un-acknowledged messages. */

    // properties:
    // retry_interval = 2000

    async __start__({host, port}) {
        let pending = new Map()                 // Map<id, {message, retries}>
        let retry_timer = null
        let next_msg_id = 1

        let socket = net.createConnection({host, port}, () => {
            socket.setNoDelay(false)            // up to 40ms delay (Nagle's algorithm, output buffer)
            retry_timer = setInterval(() => {
                for (let [id, entry] of pending) {
                    entry.retries++
                    socket.write(entry.message)
                }
            }, this.retry_interval)
        })

        let ack_parser = new ChunkParser(msg => {
            try {
                let {id, result} = JSONx.parse(msg)
                pending.delete(id)
                this._process_result(result)
            } catch (e) { console.error('Invalid ACK:', msg) }
        })

        socket.on('data', data => ack_parser.feed(data.toString()))
        socket.on('close', () => {
            clearInterval(retry_timer)
            socket.removeAllListeners()
            socket = null
        })

        function send(msg) {
            let id = next_msg_id++
            let json = JSONx.stringify({id, msg}) + '\n'
            pending.set(id, {message: json, retries: 0})
            socket.write(json)
            return id
        }

        return {socket, send}
    }
    
    async __stop__({socket}) {
        socket?.end()
    }

    _process_result(result) {
        console.log('Received result:', result)
    }
}

/**********************************************************************************************************************/

export class TCP_Receiver extends Agent {
    /* Receive messages from other nodes in the cluster, send replies and acknowledgements. */

    // properties:
    // tcp_port = 5850

    async __start__() {
        
        let server = net.createServer(socket => {
            // per-connection state
            let processed_offset = 0
            let msg_parser = new ChunkParser(json => {
                try {
                    let {id, msg} = JSONx.parse(json)
                    let result
                    if (id > processed_offset) {
                        processed_offset = id
                        result = this._process_request(msg)
                    }
                    this._respond(socket, id, result)
                } catch (e) { console.error('Invalid message:', e) }
            })

            socket.on('data', data => msg_parser.feed(data.toString()))
            socket.on('error', () => socket.destroy())
        })

        server.listen(this.tcp_port)
        return {server}
    }

    _respond(socket, id, result) {
        let resp = {id, result}
        socket.write(JSONx.stringify(resp) + '\n') 
    }

    _process_request(message) {
        console.log('Received message:', message) 
    }

    async __stop__({server}) {
        server?.close()
    }
}


/**********************************************************************************************************************/

