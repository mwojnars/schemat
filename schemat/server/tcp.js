import {assert, print, sleep_ms} from '../common/utils.js';

let net = await server_import('node:net')


function _json(msg) {
    if (typeof msg === 'string') return msg
    if (msg === undefined) return ''
    return JSON.stringify(msg)
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
                this.callback(this.current_id, msg)
                
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

    async start(retry_interval) {
        this.sockets = new Map()        // Map<address, net.Socket or promise>
        this.pending = new Map()        // Map<id, {message, retries, address, resolve, reject}>
        this.message_id = 0             // last message ID sent

        this.retry_timer = setInterval(() => {
            if (this.pending.size > 1000)
                schemat._print(`WARNING: high number of unresolved TCP requests (${this.pending.size})`)
            for (let [id, entry] of this.pending) {
                entry.retries++
                let socket = this.sockets.get(entry.address)
                assert(socket && !(socket instanceof Promise))
                socket.write(entry.message)
            }
        }, retry_interval).unref()
    }

    async stop() {
        clearInterval(this.retry_timer)
        for (let socket of this.sockets.values())
            (await socket).end()
    }

    async send(msg, address) {
        /* `msg` is a plain object/array whose elements are JSONx-encoded already if needed. */
        let socket = this.sockets.get(address) || await this._connect(address, this._response_parser())
        if (socket instanceof Promise) socket = await socket

        let id = ++this.message_id
        let message = BinaryParser.create_message(id, msg)
        if (this.message_id >= 0xFFFFFFFF) this.message_id = 0      // check for 4-byte overflow

        return new Promise((resolve, reject) => {
            this.pending.set(id, {message, retries: 0, address, resolve, reject})
            socket.write(message)
            // schemat.node._print(`TCP client message  ${id} sent:`, message.slice(9).toString())
        })
    }

    async _connect(address, response_parser) {
        let promise = _tcp_connect(address)
        this.sockets.set(address, promise)
        let socket = await promise

        socket.setNoDelay(false)
        socket.on('data', data => response_parser.feed(data))
        socket.on('close', () => {
            socket.removeAllListeners()
            this.sockets.delete(address)
        })
        this.sockets.set(address, socket)
        return socket
    }

    _response_parser() {
        return new BinaryParser((id, resp) => {
            try {
                // schemat._print(`TCP client response ${id} recv:`, _json(resp))
                let entry = this.pending.get(id)
                if (entry) {
                    entry.resolve(resp)
                    this.pending.delete(id)
                } else schemat._print('WARNING TCP response received for unknown request:', id)
            }
            catch (e) { console.error('Invalid response:', e) }
        })
    }
}

async function _tcp_connect(address, attempts = 5, delay = 1000) {
    /* Connect to a TCP peer and return a socket. Retry in case of ECONNREFUSED error. */
    let [host, port] = address.split(':')
    port = parseInt(port)

    for (let attempt = 1; attempt <= attempts; attempt++) {
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
}

/**********************************************************************************************************************/

export class TCP_Receiver {
    /* Receive messages from other nodes in the cluster, send replies and acknowledgements. */

    async start(port) {
        this.server = net.createServer(socket => {
            // per-connection state
            let processed_offset = 0
            let msg_parser = new BinaryParser(async (id, msg) => {
                try {
                    // schemat.node._print(`TCP server message  ${id} recv:`, _json(msg))
                    let result
                    if (id > processed_offset) {
                        processed_offset = id
                        result = this._handle_message(msg)
                        if (result instanceof Promise) result = await result
                    }
                    socket.write(BinaryParser.create_message(id, result))
                    // schemat.node._print(`TCP server response ${id} sent:`, _json(result))

                } catch (e) { throw e }
                // } catch (e) { console.error('Error while processing TCP message:', e) }
            })

            socket.on('data', schemat.with_context(data => msg_parser.feed(data)))
            socket.on('error', () => socket.destroy())
        })

        this.server.listen(port)
        print(`listening at TCP port`, port)
    }

    async stop() {
        this.server?.close()
    }

    _handle_message(message) {
        try {
            return schemat.node.tcp_recv(message)
        }
        catch (ex) {
            // TODO ...
            throw ex
        }
    }
}
