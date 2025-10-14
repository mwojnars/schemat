/**
 * DRAFT...
 * Example load balancer implementation. Receives HTTP(S) requests and distributes them to predefined `nodes` (IP/PORT).
 * The worker node is selected by hashing of incoming IP.
 */

import http from 'http'
import https from 'https'
import fs from 'fs'
import crypto from 'crypto'

class LoadBalancer {
    constructor() {
        // Backend server list
        this.nodes = [
            { host: '192.168.1.101', port: 3000 },
            { host: '192.168.1.102', port: 3000 },
            { host: '192.168.1.103', port: 3000 }
        ]

        this.ssl = {
            key: fs.readFileSync('path/to/your/private-key.pem'),
            cert: fs.readFileSync('path/to/your/certificate.pem')
        }

        this.http_port = 8080
        this.https_port = 8443
    }

    hash(ip) {
        let sum = crypto.createHash('md5').update(ip).digest('hex')
        return parseInt(sum, 16) % this.nodes.length
    }

    handle(req, res) {
        let ip = req.headers['x-forwarded-for'] || 
                 req.socket.remoteAddress || 
                 '0.0.0.0'
        let idx = this.hash(ip)
        let node = this.nodes[idx]

        console.log(`Routing request from ${ip} to ${node.host}:${node.port}`)

        let proxy = http.request({
            host: node.host,
            port: node.port,
            path: req.url,
            method: req.method,
            headers: req.headers,
        }, proxy_res => {
            res.writeHead(proxy_res.statusCode, proxy_res.headers)
            proxy_res.pipe(res)
        })

        proxy.on('error', err => {
            console.error(`Error forwarding request to ${node.host}:${node.port}`, err)
            res.writeHead(502)
            res.end('Bad Gateway')
        })

        req.pipe(proxy)
    }

    start() {
        let http_server = http.createServer((req, res) => this.handle(req, res))
        let https_server = https.createServer(this.ssl, (req, res) => this.handle(req, res))

        http_server.listen(this.http_port, () => {
            console.log(`HTTP load balancer running on port ${this.http_port}`)
        })

        https_server.listen(this.https_port, () => {
            console.log(`HTTPS load balancer running on port ${this.https_port}`)
        })
    }
}

// Create and start the load balancer
let balancer = new LoadBalancer()
balancer.start()