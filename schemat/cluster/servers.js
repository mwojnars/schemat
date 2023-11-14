import os from 'os'
import cluster from 'cluster'
import express from 'express'
import bodyParser from 'body-parser'
// import http from 'http'

import {assert, print, sleep} from '../common/utils.js'
import {set_global} from "../common/globals.js";
import {thread_local_variable} from "./local.js";
import {Session} from '../registry.js'
import {Request} from "../item.js";


/**********************************************************************************************************************/

let RES = express.response          // standard Express' prototype of all response objects;
                                    // we're extending it with higher-level methods for handling items

RES.error = function(...args) {
    /* `args` contain a text message and/or a numeric status code. */
    let msg, code = 500
    for (const arg of args) {
        const t = typeof arg
        if (t === 'string') msg = arg
        else if (t === 'number') code = arg
    }
    if (msg) this.status(code).send(msg)
    else this.sendStatus(code)
}


/**********************************************************************************************************************/

export class Server {

}

/**********************************************************************************************************************
 **
 **  WEB SERVER
 **
 */

export class WebServer extends Server {
    /* Edge HTTP server based on express. Can spawn multiple worker processes.
       For sending & receiving multipart data (HTML+JSON) in http response, see:
       - https://stackoverflow.com/a/50883981/1202674
       - https://stackoverflow.com/a/47067787/1202674
     */

    constructor(node, {host, port, workers}) {
        super()
        this.host = host
        this.port = port
        this.workers = workers          // no. of worker processes to spawn

        set_global({session: thread_local_variable()})
    }

    async handle(req, res) {
        if (!['GET','POST'].includes(req.method)) { res.sendStatus(405); return }
        print(`Server.handle() worker ${process.pid}:`, req.path)

        // let session = new Session(req, res)
        await session.start()

        try {
            let result = registry.site.routeWeb(session)
            if (result instanceof Promise) result = await result
            if (typeof result === 'string') res.send(result)
        }
        catch (ex) {
            print(ex)
            try { res.sendStatus(ex.code || 500) } catch(e){}
        }

        // TODO: this check is placed here temporarily only to ensure that dynamic imports work fine; drop this in the future
        let {check} = await registry.site.importModule("/site/widgets.js")
        check()

        // await sleep(200)                 // for testing
        // session.printCounts()
        await session.stop()
    }

    async serve_express() {
        const app = express()

        // for official middleware see: https://expressjs.com/en/resources/middleware.html
        // for receiving files:
        //  - multer:      https://www.npmjs.com/package/multer and https://expressjs.com/en/5x/api.html#req.body
        //  - fileupload:  https://www.npmjs.com/package/express-fileupload & https://stackoverflow.com/a/50243907/1202674 (newer one, possibly easier)

        // // set CORS headers in all responses to allow cross-origin requests
        // app.use((req, res, next) => {
        //     res.header('Access-Control-Allow-Origin', '*')      // or the specific origin of your client app
        //     res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
        //     next()
        // })

        // app.use(express.json())                                 // for parsing application/json to req.body object
        app.use(express.urlencoded({extended: false}))          // for parsing application/x-www-form-urlencoded
        app.use(bodyParser.text({type: '*/*', limit: '10MB'}))  // for setting req.body string from plain-text body (if not json MIME-type)

        app.all('*', (req, res) => session.run_with(new Session(req, res), () => this.handle(req, res)))
        // app.all('*', (req, res) => this.handle(req, res))

        // web.get('*', async (req, res) => {
        //     res.send(`URL path: ${req.path}`)
        //     res.send('Hello World!')
        // })

        return app.listen(this.port, this.host, () => print(`worker ${process.pid} listening at http://${this.host}:${this.port}`))
    }

    async start() {
        /* Docs for node.js cluster: https://nodejs.org/api/cluster.html */
        if (this.workers && this.workers > 1 && cluster.isMaster) {
            print(`primary ${process.pid} is starting ${this.workers} workers...`)
            for (let i = 0; i < this.workers; i++) cluster.fork()
            cluster.on('exit', (worker) => print(`Worker ${worker.process.pid} terminated`))
            return
        }
        return this.serve_express()
    }
}


/**********************************************************************************************************************
 **
 **  HTTP SERVER
 **
 */

// function serve_http() {
//     // const http = require('http');
//
//     // limiting the no. of concurrent connections:
//     //   http.globalAgent.maxTotalSockets = XXX
//
//     const server = http.createServer((req, res) => {
//         res.statusCode = 200;
//         res.setHeader('Content-Type', 'text/plain');
//         res.end('Hello World');
//     });
//
//     server.listen(PORT, HOSTNAME, () => {
//         console.log(`Server running at http://${HOSTNAME}:${PORT}/`);
//     });
// }

// async function serve_express() {
//     const app = express()
//     const server = new Server()
//     await server.boot()
//
//     // for official middleware see: https://expressjs.com/en/resources/middleware.html
//     // for receiving files:
//     //  - multer:      https://www.npmjs.com/package/multer and https://expressjs.com/en/5x/api.html#req.body
//     //  - fileupload:  https://www.npmjs.com/package/express-fileupload & https://stackoverflow.com/a/50243907/1202674 (newer one, possibly easier)
//
//     app.use(express.json())                                 // for parsing application/json
//     app.use(express.urlencoded({extended: false}))          // for parsing application/x-www-form-urlencoded
//
//     app.all('*', (req, res) => server.handle(req, res))
//     // web.get('*', async (req, res) => {
//     //     res.send(`URL path: ${req.path}`)
//     //     res.send('Hello World!')
//     // })
//
//     app.listen(PORT, HOSTNAME, () => print(`worker ${process.pid} listening at http://${HOSTNAME}:${PORT}`))
// }
//
// async function serve_cluster(workers) {
//     /* Docs for node.js cluster: https://nodejs.org/api/cluster.html */
//     if (workers && workers > 1 && cluster.isMaster) {
//         print(`primary ${process.pid} is starting ${workers} workers...`)
//         for (let i = 0; i < workers; i++) cluster.fork()
//         cluster.on('exit', (worker) => print(`Worker ${worker.process.pid} terminated`))
//         return
//     }
//     await serve_express()
// }


/**********************************************************************************************************************
 **
 **  DATA SERVER
 **
 */

export class DataServer extends Server {

    constructor(node, opts = {}) {
        super()
    }

    async start() {}
}

