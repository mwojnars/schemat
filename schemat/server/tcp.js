import {assert, print, sleep_ms} from '../common/utils.js';
import {JSONx} from "../common/jsonx.js";

let net = await server_import('node:net')


/**********************************************************************************************************************/

function _json(msg) {
    if (typeof msg === 'string') return msg
    if (msg === undefined) return ''
    return JSON.stringify(msg)
}

async function _tcp_connect(address, attempts = 5, delay = 1000) {
    /* Connect to a TCP peer and return a socket. Retry in case of ECONNREFUSED error. */
    let [host, port] = address.split(':')
    port = parseInt(port)

    for (let attempt = 1; attempt <= attempts; attempt++)
        try {
            let conn = net.createConnection({host, port})
            return await new Promise((resolve, reject) => {
                conn.on('connect', () => {
                    conn.removeAllListeners('error')
                    resolve(conn)
                })
                conn.on('error', (err) => {
                    conn.removeAllListeners('connect')
                    reject(err)
                })
            })
        } catch (err) {
            if (err.code === 'ECONNREFUSED' && attempt < attempts) {
                schemat._print(`TCP error ${err.code} when connecting to ${address}, retrying after a delay of ${delay}ms ...`)
                await sleep_ms(delay)
            } else throw err
        }
}

/**********************************************************************************************************************/

class ChunkParser {
    /* Generic message reassembly from chunks based on newline delimiter.
       Handles UTF-8 encoding properly when chunks might split across character boundaries.
     */
    constructor(callback) {
        this.buffer = Buffer.alloc(0)
        this.callback = callback    // can be async, but the returned promise is not awaited
    }

    feed(data) {
        // this.buffer += data.toString()
        // let messages = this.buffer.split('\n')
        // this.buffer = messages.pop()
        // messages.forEach(msg => msg && this.callback(msg))

        // append new data to existing buffer
        this.buffer = Buffer.concat([this.buffer, data])
        
        // find all complete messages (ending with newline), only then UTF-8 decode each of them
        // (if trying to decode full buffer, we might encounter a multi-byte character split across chunks)
        let start = 0
        let pos = 0
        
        while ((pos = this.buffer.indexOf('\n', start)) !== -1) {
            let message = this.buffer.slice(start, pos).toString()      // extract complete message
            if (message) this.callback(message)
            start = pos + 1
        }
        this.buffer = this.buffer.slice(start)      // keep remaining incomplete message in buffer
    }
}

class BinaryParser {
    /* Parser of binary messages in format [msg_id, content_length, json_flag, content_binary]. */
    constructor(callback) {
        this.buffer = Buffer.alloc(0)
        this.callback = callback    // can be async, but the returned promise is not awaited
        this.expected_length = 0    // length of current message being parsed
        this.current_id = 0         // id of current message being parsed
    }

    static create_message(id, msg) {
        /* Create a binary message in format [msg_id, content_length, json_flag, content_binary].
           An undefined `msg` is represented as an empty content string with json_flag set to true ('J').
         */
        let to_json = typeof msg !== 'string'
        let content = (!to_json) ? msg : ((msg === undefined) ? '' : JSON.stringify(msg))
        let binary  = Buffer.from(content)

        if (binary.length > 0xFFFFFFFF) throw new Error(`content length is too large (${binary.length})`)
        if (id > 0xFFFFFFFF) throw new Error(`message id is too large (${id})`)

        let buffer = Buffer.alloc(9 + binary.length)
        let json_flag = to_json ? 'J'.charCodeAt(0) : ' '.charCodeAt(0)

        buffer.writeUInt32BE(id, 0)             // write message id
        buffer.writeUInt32BE(binary.length, 4)  // write content_length
        buffer.writeUInt8(json_flag, 8)         // write json_flag ('J' or space)
        binary.copy(buffer, 9)                  // copy binary content into buffer
        return buffer
    }

    feed(data) {
        /* Append new data to existing buffer. */
        this.buffer = Buffer.concat([this.buffer, data])
        
        while (this.buffer.length >= 9) {  // minimum size for msg_id (4 bytes) + content_length (4 bytes) + json_flag (1 byte)
            if (this.expected_length === 0) {
                // start parsing new message
                this.current_id = this.buffer.readUInt32BE(0)
                this.expected_length = this.buffer.readUInt32BE(4)
            }
            
            // check if we have complete message
            if (this.buffer.length >= 9 + this.expected_length) {
                let is_json = this.buffer.readUInt8(8) === 'J'.charCodeAt(0)
                let binary  = this.buffer.slice(9, 9 + this.expected_length)
                let content = binary.toString()
                let msg     = (!is_json) ? content : (content ? JSON.parse(content) : undefined)

                try { this.callback(this.current_id, msg) }
                catch (ex) {
                    schemat._print_error(`error in BinaryParser while processing incoming message id=${this.current_id} "${content}":`, ex)
                }

                // remove processed message from buffer
                this.buffer = this.buffer.slice(9 + this.expected_length)
                this.expected_length = 0
                this.current_id = 0
            } 
            else break      // incomplete message, wait for more data
        }
    }
}

/**********************************************************************************************************************/

export class TCP_Sender {
    /* Send messages to other nodes in the cluster via persistent connections. Generate unique identifiers
       for WRITE messages, process acknowledgements and resend un-acknowledged messages. */

    OVERFLOW = 0xFFFFFFFF

    async start(retry_interval) {
        this.retry_interval = retry_interval
        this.sockets = new Map()        // Map<address, net.Socket or promise>
        this.pending = new Map()        // Map<id, {message, address, timestamp, retries, resolve, reject}>
        this.message_id = 0             // last message ID sent

        this.retry_timer = setInterval(() => this._resend_pending(), retry_interval).unref()
        this._tcp_handle_response = this._tcp_handle_response.bind(this)
    }

    _resend_pending() {
        if (this.pending.size > 100)
            schemat._print(`WARNING: high number of unresolved TCP requests (${this.pending.size})`)

        let now = Date.now()
        for (let [id, entry] of this.pending) {
            let {timestamp, address, message} = entry
            if (now - timestamp < this.retry_interval) continue     // "break" would do instead, as entries should be ordered by timestamp (?)

            entry.retries++
            schemat._print(`retry no. ${entry.retries} at sending TCP message id=${id} ${message} to ${address}`)

            let socket = this.sockets.get(address)
            assert(socket && !(socket instanceof Promise))
            socket.write(message)
        }
    }

    async stop() {
        clearInterval(this.retry_timer)
        for (let socket of this.sockets.values())
            (await socket).end()
    }

    async send(req, address) {
        /* `msg` is a plain object/array whose elements are JSONx-encoded already if needed. */
        let socket = this.sockets.get(address) || await this._connect(address, new BinaryParser(this._tcp_handle_response))
        if (socket instanceof Promise) socket = await socket

        let id = ++this.message_id
        let message = BinaryParser.create_message(id, req)
        if (this.message_id >= this.OVERFLOW) this.message_id = 0      // check for 4-byte overflow

        return new Promise((resolve, reject) => {
            this.pending.set(id, {message, address, timestamp: Date.now(), retries: 0, resolve, reject})
            socket.write(message)
            // schemat.node._print(`TCP client message  ${id} sent:`, message.slice(9).toString())
        })
    }

    async _connect(address, response_parser) {
        let promise = _tcp_connect(address)
        this.sockets.set(address, promise)
        let socket = await promise

        // send handshake request with this node's ID first; no response expected
        socket.write(BinaryParser.create_message(0, schemat.node.id))

        socket.setNoDelay(false)
        socket.on('data', data => response_parser.feed(data))
        socket.on('close', () => {
            socket.removeAllListeners()
            this.sockets.delete(address)
        })
        this.sockets.set(address, socket)
        return socket
    }

    _tcp_handle_response(id, resp) {
        // schemat._print(`TCP client response ${id} recv:`, _json(resp))
        let {resolve, reject} = this.pending.get(id) || {}
        if (!resolve) return schemat._print(`WARNING TCP response received for processed or unknown request ${id}:`, _json(resp))
        this.pending.delete(id)

        if (resp === undefined) resolve()
        else {
            let [result, error] = resp
            if (error) reject(JSONx.decode(error))
            else resolve(result)
        }
    }
}


/**********************************************************************************************************************/

export class TCP_Receiver {
    /* Receive messages from other nodes in the cluster, send replies and acknowledgements.
       Response format:
       - [id, undefined] on success with result === undefined
       - [id, [result]] on success with result !== undefined
       - [id, [null, error]] on failure
     */

    senders = new Map()         // socket -> node_id
    watermarks = new Map()      // socket -> watermark  ... TODO: use sender's node.id as keys

    async start(port) {
        this.server = net.createServer(socket => this._accept_connection(socket))
        this.server.listen(port)
        schemat._print(`listening at TCP port`, port)
    }

    async stop() {
        this.server?.close()
    }

    _accept_connection(socket) {
        /* Accept new incoming connection. */
        let msg_parser = new BinaryParser((id, req) => this._tcp_handle_request(socket, id, req))
        socket.on('data', schemat.with_context(data => msg_parser.feed(data)))
        socket.on('error', () => socket.destroy())
        socket.on('close', () => this.senders.delete(socket))
     }

    async _tcp_handle_request(socket, id, req) {
        let resp
        try {
            // schemat.node._print(`TCP server message  ${id} recv:`, _json(req))
            if (id === 0) return this._handshake_request(socket, req)       // message ID = 0 is reserved for handshake request

            let sender = this.senders.get(socket)
            if (!sender) throw new Error(`missing handshake before TCP request ${id}: ${_json(req)}`)

            let watermark = this.watermarks.get(sender)

            // TODO: handle watermark's OVERFLOW
            if (id <= watermark) {
                schemat._print(`TCP request ${id} received again, message ${_json(req)}, ignoring`)
                // TODO: ACK should be sent again, but this can only be done when a response object is not expected (fire-and-forget requests, FF),
                //       which means that on sender, the retry mechanism should only apply to FF requests, not to request-response ones
                return
            }

            let result = schemat.node.tcp_recv(req)
            if (result instanceof Promise) result = await result

            if (result !== undefined) result = [result]
            resp = BinaryParser.create_message(id, result)

            // schemat.node._print(`TCP server response ${id} to be sent:`, _json(result))
            this.watermarks.set(sender, id)

        } catch (ex) {
            // console.error('Error while processing TCP message:', e)
            resp = BinaryParser.create_message(id, [null, JSONx.encode(ex)])
        }
        socket.write(resp)
    }

    _handshake_request(socket, req) {
        /* Initial request sent by a new incoming TCP connection. Contains node ID of the sender. */
        let node_id = req
        this.senders.set(socket, node_id)
        this.watermarks.set(node_id, 0)
        schemat._print(`TCP handshake request received from node ${node_id}`)
    }
}
