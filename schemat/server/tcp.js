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
        let socket = net.createConnection({host, port}, () => {
            socket.setNoDelay(false)            // up to 40ms delay (Nagle's algorithm, output buffer)
            let retry_timer = setInterval(() => {
                for (let [id, entry] of pending) {
                    entry.retries++
                    socket.write(entry.message)
                }
            }, this.retry_interval)
            state.retry_timer = retry_timer     // add timer to state for cleanup
        })

        let ack_parser = new ChunkParser(msg => {
            try {
                let {id} = JSON.parse(msg)
                pending.delete(id)
            } catch (e) { console.error('Invalid ACK:', msg) }
        })

        socket.on('data', data => ack_parser.feed(data.toString()))
        socket.on('close', () => {
            clearInterval(state.retry_timer)
            socket.removeAllListeners()
            socket = null
        })

        let state = {
            host, port, socket, pending,
            next_msg_id: 1,
            send: (payload) => {
                let msg_id = state.next_msg_id++
                let message = JSON.stringify({id: msg_id, payload}) + '\n'
                pending.set(msg_id, {message, retries: 0})
                socket.write(message)
                return msg_id
            }
        }
        return state
    }
}

/**********************************************************************************************************************/

export class TCP_Receiver extends Agent {
    /* Receive messages from other nodes in the cluster, send replies and acknowledgements. */
    processed_offset = 0
    msg_parser = new ChunkParser(msg => this._process_message(msg))

    async __start__({port}) {
        this.server = net.createServer(socket => {
            socket.on('data', data => this.msg_parser.feed(data.toString()))
            socket.on('error', () => socket.destroy())
        })
        this.server.listen(port)
        return {port}
    }

    _process_message(msg) {
        try {
            let {id, payload} = JSON.parse(msg)
            if (id > this.processed_offset) {
                this._handle_payload(payload)
                this.processed_offset = id
            }
            this._send_ack(id)
        } catch (e) { console.error('Invalid message:', e) }
    }

    _send_ack(id) {
        this.server?.clients.forEach(client => 
            client.write(JSON.stringify({id}) + '\n')
        )
    }

    _handle_payload(payload) {
        // override this method to handle received payloads
        console.log('Received payload:', payload)
    }
}


/**********************************************************************************************************************/

