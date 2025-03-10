import {assert, print} from '../common/utils.js';
import {JSONx} from '../common/jsonx.js';

let net = await server_import('node:net')


/**********************************************************************************************************************/

class ChunkParser {
    // Generic chunk reassembly handler using newline delimiter
    constructor(callback) {
        this.buffer = ''
        this.callback = callback    // can be async, but the returned promise is not awaited
    }

    feed(data) {
        this.buffer += data
        let messages = this.buffer.split('\n')
        this.buffer = messages.pop()
        messages.forEach(msg => msg && this.callback(msg))
    }
}

/**********************************************************************************************************************/

export class TCP_Sender {
    /* Send messages to other nodes in the cluster via persistent connections. Generate unique identifiers
       for WRITE messages, process acknowledgements and resend un-acknowledged messages. */

    async start(retry_interval) {
        this.sockets = new Map()         // Map<address, net.Socket>
        this.pending = new Map()         // Map<id, {message, retries, address, resolve, reject}>
        this.message_id = 1

        this.retry_timer = setInterval(() => {
            for (let [id, entry] of this.pending) {
                entry.retries++
                let socket = this.sockets.get(entry.address)
                assert(socket)
                socket.write(entry.message)
            }
        }, retry_interval)
    }

    async stop() {
        clearInterval(this.retry_timer)
        for (let socket of this.sockets.values()) socket.end()
    }

    async send(msg, address) {
        /* `msg` is a plain object/array whose elements have to be JSONx-encoded already if needed. */
        return new Promise((resolve, reject) => {
            let socket = this.sockets.get(address) || this._connect(address)
            let id = this.message_id++
            let json = JSON.stringify({id, msg}) + '\n'

            this.pending.set(id, {message: json, retries: 0, address, resolve, reject})
            socket.write(json)
        })
    }

    _connect(address) {
        let [host, port] = address.split(':')
        port = parseInt(port)
        let socket = net.createConnection({host, port})
        socket.setNoDelay(false)

        let ack_parser = new ChunkParser(msg => {
            try {
                print(`${schemat.node.id} TCP response received:`, msg)
                let {id, result} = JSONx.parse(msg)
                let entry = this.pending.get(id)
                if (entry) {
                    entry.resolve(result)
                    this.pending.delete(id)
                } else console.warn('Response received for unknown request:', id)
            }
            catch (e) { console.error('Invalid ACK:', msg) }
        })

        socket.on('data', data => ack_parser.feed(data.toString()))
        socket.on('close', () => {
            socket.removeAllListeners()
            this.sockets.delete(address)
        })
        this.sockets.set(address, socket)

        return socket
    }
}

/**********************************************************************************************************************/

export class TCP_Receiver {
    /* Receive messages from other nodes in the cluster, send replies and acknowledgements. */

    async start(port) {

        this.server = net.createServer(socket => {
            // per-connection state
            let processed_offset = 0
            let msg_parser = new ChunkParser(async json => {
                try {
                    print(`${schemat.node.id} TCP message received:`, json)
                    let {id, msg} = JSON.parse(json)
                    let result
                    if (id > processed_offset) {
                        processed_offset = id
                        result = this._handle_message(msg)
                        if (result instanceof Promise) result = await result
                    }
                    this._respond(socket, id, result)
                } catch (e) { throw e }
                // } catch (e) { console.error('Error while processing TCP message:', e) }
            })

            socket.on('data', data => msg_parser.feed(data.toString()))
            socket.on('error', () => socket.destroy())
        })

        this.server.listen(port)
        print(`listening at TCP port`, port)
    }

    async stop() {
        this.server?.close()
    }

    _handle_message(message) {
        return schemat.node.recv_tcp(message)
    }

    _respond(socket, id, result) {
        let resp = {id}
        if (result !== undefined) resp.result = result
        socket.write(JSONx.stringify(resp) + '\n')
    }
}


/**********************************************************************************************************************/
// Agent-based classes ...


// export class TCP_Sender extends Agent {
//     /* Send messages to other nodes in the cluster via persistent connections. Generate unique identifiers
//        for WRITE messages, process acknowledgements and resend un-acknowledged messages. */
//
//     // properties:
//     retry_interval
//
//     async __start__() {
//         let sockets = new Map()         // Map<address, net.Socket>
//         let pending = new Map()         // Map<id, {message, retries, address}>
//         let message_id = 1
//
//         let retry_timer = setInterval(() => {
//             for (let [id, entry] of pending) {
//                 entry.retries++
//                 let socket = sockets.get(entry.address)
//                 assert(socket)
//                 socket.write(entry.message)
//             }
//         }, this.retry_interval)
//
//         let _connect = (address) => {
//             let [host, port] = address.split(':')
//             port = parseInt(port)
//             let socket = net.createConnection({host, port})
//             socket.setNoDelay(false)
//
//             let ack_parser = new ChunkParser(msg => {
//                 try {
//                     print('TCP response:', msg)
//                     let {id, result} = JSONx.parse(msg)
//                     pending.delete(id)
//                     this._handle_response(result)
//                     // print('pending:', pending.size)
//                 }
//                 catch (e) { console.error('Invalid ACK:', msg) }
//             })
//
//             socket.on('data', data => ack_parser.feed(data.toString()))
//             socket.on('close', () => {
//                 socket.removeAllListeners()
//                 sockets.delete(address)
//             })
//             sockets.set(address, socket)
//
//             return socket
//         }
//
//         let send = (msg, address) => {
//             /* `msg` is a plain object/array whose elements have to be JSONx-encoded already if needed. */
//             let socket = sockets.get(address) || _connect(address)
//             let id = message_id++
//             let json = JSON.stringify({id, msg}) + '\n'
//
//             pending.set(id, {message: json, retries: 0, address})
//             socket.write(json)
//             return id
//         }
//
//         return {sockets, send, retry_timer}
//     }
//
//     async __stop__({sockets, retry_timer}) {
//         clearInterval(retry_timer)
//         for (let socket of sockets.values()) socket.end()
//     }
//
//     _handle_response(result) {
//         console.log('Received result:', result)
//     }
// }
//
// export class TCP_Receiver extends Agent {
//     /* Receive messages from other nodes in the cluster, send replies and acknowledgements. */
//
//     // properties:
//     tcp_port
//
//     async __start__() {
//
//         let server = net.createServer(socket => {
//             // per-connection state
//             let processed_offset = 0
//             let msg_parser = new ChunkParser(async json => {
//                 try {
//                     print(`TCP message:`, json)
//                     let {id, msg} = JSON.parse(json)
//                     let result
//                     if (id > processed_offset) {
//                         processed_offset = id
//                         result = this._handle_message(msg)
//                         if (result instanceof Promise) result = await result
//                     }
//                     this._respond(socket, id, result)
//                 } catch (e) { console.error('Invalid message:', e) }
//             })
//
//             socket.on('data', data => msg_parser.feed(data.toString()))
//             socket.on('error', () => socket.destroy())
//         })
//
//         let port = schemat.config['tcp-port'] || this.tcp_port || schemat.node.tcp_port
//         print(`listening at TCP port`, port)
//
//         server.listen(port)
//         return {server}
//     }
//
//     async __stop__({server}) {
//         server?.close()
//     }
//
//     _handle_message(message) {
//         return schemat.node.recv_tcp(message)
//     }
//
//     _respond(socket, id, result) {
//         let resp = {id}
//         if (result !== undefined) resp.result = result
//         socket.write(JSONx.stringify(resp) + '\n')
//     }
// }

