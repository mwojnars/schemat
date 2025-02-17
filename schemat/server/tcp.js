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
        const messages = this.buffer.split('\n')
        this.buffer = messages.pop()
        messages.forEach(msg => msg && this.callback(msg))
    }
}

/**********************************************************************************************************************/

export class TCP_Sender extends Agent {
    /* Send messages to other nodes in the cluster via persistent connections. Generate unique identifiers
       for WRITE messages, process acknowledgements and resend un-acknowledged messages. */
    next_msg_id = 1
    pending = new Map()     // Map<id, {message, attempts}>
    socket = null
    retry_interval = 2000
    ack_parser = new ChunkParser(msg => this._handle_ack(msg))

    async __start__({host, port}) {
        this.socket = net.createConnection({host, port}, () => {
            this.socket.setNoDelay(true)
            this.retry_timer = setInterval(() => this._resend_pending(), this.retry_interval)
        })

        this.socket.on('data', data => this.ack_parser.feed(data.toString()))
        this.socket.on('close', () => this._handle_disconnect())
        return {host, port}
    }

    async send(payload) {
        const msg_id = this.next_msg_id++
        const message = JSON.stringify({id: msg_id, payload}) + '\n'
        this.pending.set(msg_id, {message, attempts: 0})
        this.socket.write(message)
        return msg_id
    }

    _resend_pending() {
        for (const [id, entry] of this.pending) {
            entry.attempts++
            this.socket.write(entry.message)
        }
    }

    _handle_ack(ack) {
        try {
            const {id} = JSON.parse(ack)
            this.pending.delete(id)
        } catch (e) { console.error('Invalid ACK:', ack) }
    }

    _handle_disconnect() {
        clearInterval(this.retry_timer)
        this.socket.removeAllListeners()
        this.socket = null
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
            const {id, payload} = JSON.parse(msg)
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

