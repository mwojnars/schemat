import cluster from 'node:cluster'

import {assert, print, timeout, sleep} from '../common/utils.js'
import {ServerTimeoutError} from "../common/errors.js";
import {thread_local_variable} from "./thread.js";
import {Request} from "../web/request.js";


/**********************************************************************************************************************/

// let RES = express.response          // standard Express' prototype of all response objects;
//                                     // we're extending it with higher-level methods for handling items
//
// RES.error = function(...args) {
//     /* `args` contain a text message and/or a numeric status code. */
//     let msg, code = 500
//     for (let arg of args) {
//         let t = typeof arg
//         if (t === 'string') msg = arg
//         else if (t === 'number') code = arg
//     }
//     if (msg) this.status(code).send(msg)
//     else this.sendStatus(code)
// }


/**********************************************************************************************************************/

export class Server {

    worker      // cluster.Worker instance that executes this server's process (only present in the main process)
    worker_id   // numeric ID (1, 2, 3, ...) of this server's worker process (present in both the main process and worker processes)

    async start() { assert(false) }
    async stop()  {}
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

    REQUEST_TIMEOUT = 60                // [sec] 60 seconds

    constructor({host, port, workers}) {
        super()
        this.host = host
        this.port = port
        this.workers = workers          // no. of worker processes to spawn
    }

    async start(id) {
        /* Docs for node.js cluster: https://nodejs.org/api/cluster.html */

        this.worker_id = id
        return this.serve_express()

        // print('start() test:', obj instanceof Set)

        // let {ServerSchemat} = await import('/$/local/schemat/core/schemat_srv.js')
        // await schemat._reset_class(ServerSchemat)

        // schemat.registry.objects.clear()
        // await schemat._init_site()

        // if (this.workers && this.workers > 1 && cluster.isPrimary) {
        //     print(`primary ${process.pid} is starting ${this.workers} workers...`)
        //     for (let i = 0; i < this.workers; i++) cluster.fork()
        //     cluster.on('exit', (worker) => {
        //         print(`worker ${worker.process.pid} exited`)
        //         cluster.fork()      // restart the process
        //     })
        // }
        // else return this.serve_express()
    }

    async handle(req, res) {
        if (!['GET','POST'].includes(req.method)) return res.sendStatus(405)    // 405 Method Not Allowed
        // print(`handle() worker ${process.pid} started: ${req.path}`)
        // await session.start()

        // // redirection of HTTP to HTTPS
        // httpServer.on('request', (req, res) => {
        //     let httpsUrl = `https://${req.headers.host.replace(HTTP_PORT, HTTPS_PORT)}${req.url}`
        //     res.writeHead(301, { Location: httpsUrl })
        //     res.end()
        // })

        try {
            // await sleep(3000)
            let deadline = timeout(this.REQUEST_TIMEOUT * 1000, new ServerTimeoutError())
            let request = new Request({req, res})
            let handler = schemat.site.route(request)
            let result = await Promise.race([handler, deadline])    // the request is abandoned if it takes longer than REQUEST_TIMEOUT to process
            if (typeof result === 'string') res.send(result)
        }
        catch (ex) {
            print(ex)
            if (!res.headersSent)
                if (ex.code === 'ENOENT')                           // file not found error
                    res.status(404).send('File not found')
                else
                    res.status(ex.code || 500).send(ex.message || 'Internal Server Error')
            else
                res.end()               // if headers were sent already, we need to end the response

            // TODO: send cancellation signal (StopRequest interrupt) to the Schemat to terminate all pending load-object operations and stop the remaining computation (esp. on timeout)
        }

        // // TODO: a temporary check to make sure that dynamic imports work fine; drop this in the future
        // let {check} = await schemat.site.import_module("/site/widgets.js")
        // check()

        // await schemat.after_request()
        // print(`handle() worker ${process.pid} finished: ${req.path}`)

        // await sleep(200)                 // for testing
        // session.printCounts()
        // await session.stop()
    }

    async serve_express() {
        let express = (await import('express')).default
        let bodyParser = (await import('body-parser')).default

        let app = express()

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

        app.all('*', (req, res) => this.handle(req, res))

        // web.get('*', async (req, res) => {
        //     res.send(`URL path: ${req.path}`)
        //     res.send('Hello World!')
        // })

        this._http_server = app.listen(this.port, this.host, () => print(`worker ${process.pid} listening at http://${this.host}:${this.port}`))
    }

    stop() {
        this._http_server?.close(() => print('WebServer closed'))
    }
}


/**********************************************************************************************************************
 **
 **  HTTP SERVER
 **
 */

// function serve_http() {
//     // let http = require('http');
//
//     // limiting the no. of concurrent connections:
//     //   http.globalAgent.maxTotalSockets = XXX
//
//     let server = http.createServer((req, res) => {
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
//     let app = express()
//     let server = new Server()
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

