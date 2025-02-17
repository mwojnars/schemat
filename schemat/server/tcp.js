import {assert, tryimport} from '../common/utils.js';
import {JSONx} from '../common/jsonx.js';
import {Agent} from "./agent.js";

let {net} = await tryimport('net') || {}         // node:net


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
    retry_interval

    async __start__({host, port}) {
        let sockets = new Map()         // Map<"host:port", net.Socket>
        let pending = new Map()         // Map<id, {message, retries, socket}>
        let message_id = 1

        let retry_timer = setInterval(() => {
            for (let [id, entry] of pending) {
                entry.retries++
                entry.socket.write(entry.message)
            }
        }, this.retry_interval)

        const _create_connection = (host, port) => {
            let key = `${host}:${port}`
            let socket = net.createConnection({host, port})
            socket.setNoDelay(false)

            let ack_parser = new ChunkParser(msg => {
                try {
                    let {id, result} = JSONx.parse(msg)
                    pending.delete(id)
                    this._process_result(result)
                } catch (e) { console.error('Invalid ACK:', msg) }
            })

            socket.on('data', data => ack_parser.feed(data.toString()))
            socket.on('close', () => {
                socket.removeAllListeners()
                sockets.delete(key)
            })

            return socket
        }

        function send(msg, host, port) {
            let key = `${host}:${port}`
            let socket = sockets.get(key)
            if (!socket) {
                socket = _create_connection(host, port)
                sockets.set(key, socket)
            }

            let id = message_id++
            let json = JSONx.stringify({id, msg}) + '\n'

            pending.set(id, {message: json, retries: 0, socket})
            socket.write(json)
            return id
        }

        return {sockets, send, retry_timer}
    }
    
    async __stop__({sockets, retry_timer}) {
        clearInterval(retry_timer)
        for (let socket of sockets.values()) socket.end()
    }

    _process_result(result) {
        console.log('Received result:', result)
    }
}

/**********************************************************************************************************************/

export class TCP_Receiver extends Agent {
    /* Receive messages from other nodes in the cluster, send replies and acknowledgements. */

    // properties:
    tcp_port

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

        server.listen(this.tcp_port || schemat.node.tcp_port)
        return {server}
    }

    async __stop__({server}) {
        server?.close()
    }

    _respond(socket, id, result) {
        let resp = {id}
        if (result !== undefined) resp.result = result
        socket.write(JSONx.stringify(resp) + '\n') 
    }

    _process_request(message) {
        console.log('Received message:', message) 
    }
}


/**********************************************************************************************************************/

