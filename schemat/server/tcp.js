import net from 'net';
import { assert } from '../common/utils.js';
import {Agent} from "./agent.js";


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
                let {id} = JSON.parse(msg)
                pending.delete(id)
            } catch (e) { console.error('Invalid ACK:', msg) }
        })

        socket.on('data', data => ack_parser.feed(data.toString()))
        socket.on('close', () => {
            clearInterval(retry_timer)
            socket.removeAllListeners()
            socket = null
        })

        function send(payload) {
            let msg_id = next_msg_id++
            let message = JSON.stringify({id: msg_id, payload}) + '\n'
            pending.set(msg_id, {message, retries: 0})
            socket.write(message)
            return msg_id
        }

        return {socket, send}
    }
    
    async __stop__({socket}) {
        socket?.end()
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
            let msg_parser = new ChunkParser(msg => {
                try {
                    let {id, payload} = JSON.parse(msg)
                    if (id > processed_offset) {
                        this.__consume__(payload)
                        processed_offset = id
                    }
                    this._send_ack(socket, id)
                } catch (e) { console.error('Invalid message:', e) }
            })

            socket.on('data', data => msg_parser.feed(data.toString()))
            socket.on('error', () => socket.destroy())
        })

        server.listen(this.tcp_port)
        return {server}
    }

    _send_ack(socket, id)   { socket.write(JSON.stringify({id}) + '\n') }

    __consume__(message)    { console.log('Received message:', message) }

    async __stop__({server}) {
        server?.close()
    }
}


/**********************************************************************************************************************/

