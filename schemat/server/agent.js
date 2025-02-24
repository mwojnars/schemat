import {assert, print, timeout, sleep, utc} from '../common/utils.js'
import {ServerTimeoutError} from "../common/errors.js";
import {WebRequest} from "../web/request.js";
import {WebObject} from "../core/object.js"
// import {thread_local_variable} from "./thread.js";


/**********************************************************************************************************************/

export class Agent extends WebObject {
    /* A web object that can be installed on a particular node(s) in the cluster to run a perpetual operation there (a microservice).
       Typically, the agent runs a web server, or an intra-cluster microservice of any kind, with a perpetual event loop.
       The agent is allowed to use local resources of the host node: files, sockets, etc.; with some of them (typically files)
       being allocated/deallocated in __install__/__uninstall__(), while some others (e.g., sockets) in __start__/__stop__().
    */

    // __node / __node$ -- the host node(s) where this agent is installed/running
    // __num_workers    -- 0/1/N, the number of concurrent workers per node that should execute this agent's loop at the same time; 0 = "all available"

    hard_restart

    async __install__(node) {}  // ideally, this method should be idempotent in case of failure and subsequent re-launch
    async __uninstall__(node) {}

    async __start__()   {}      // may create and return an "execution context" (an object of arbitrary shape) that will be passed to __stop__()
    async __stop__(ctx) {}

    async __restart__(ctx, prev) {
        /* In many cases, refreshing an agent in the worker process does NOT require full stop+start, which might have undesired side effects
           (temporary unavailability of the microservice). For this reason, __restart__() is called upon agent refresh - it can be customized
           in subclasses, and the default implementation either does nothing (default), or performs the full stop+start cycle (if hard_restart=true).
         */
        if (!this.hard_restart) return ctx
        await prev.__stop__(ctx)
        return this.__start__()
    }


    /***  Triggers  ***/

    get remote() {
        /* Triggers of inter-cluster RPC calls: obj.remote.X(...args) call makes the current node send a TCP message that
           invokes obj['remote.X'](...args) on the host node of this object. The object must be an Agent, because only
           agents are deployed on specific nodes in the cluster, execute a perpetual event loop and accept RPC calls.
         */
        let id = this.id
        assert(id)
        return new Proxy({}, {
            get(target, name) {
                if (typeof name === 'string') return (...args) => schemat.node.send_rpc(id, name, ...args)
            }
        })
    }

    'remote.ping'(ctx, msg) {
        /* Default RPC endpoint for testing inter-cluster communication. */
        print(`[${utc()}]  PING: agent [${this.id}], ${msg}`)
    }
}


/**********************************************************************************************************************/

// export class Driver extends WebObject {}


/**********************************************************************************************************************
 **
 **  WEB SERVER
 **
 */

export class WebServer extends Agent {
    /* Edge HTTP server based on express.
       For sending & receiving multipart data (HTML+JSON) in http response, see:
       - https://stackoverflow.com/a/50883981/1202674
       - https://stackoverflow.com/a/47067787/1202674
     */

    request_timeout

    async __start__() {
        // let {ServerSchemat} = await import('/$/local/schemat/core/schemat_srv.js')
        // await schemat._reset_class(ServerSchemat)

        // schemat.registry.objects.clear()
        // await schemat._init_site()

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

        app.all('*', (req, res) => this._handle(req, res))

        let host = schemat.config.host || this.host
        let port = schemat.config.port || this.port

        let server = app.listen(port, host, () => print(`worker ${process.pid} listening at http://${host}:${port}`))
        return {server}
    }

    async __stop__({server}) {
        if (server) await new Promise(resolve => server.close(resolve))
        print(`#${schemat.process.worker_id} WebServer closed`)
    }

    async _handle(req, res) {
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
            // await sleep(3)
            let request = new WebRequest({req, res})
            let handler = schemat.site.route(request)

            if (this.request_timeout) {
                let deadline = timeout(this.request_timeout * 1000, new ServerTimeoutError())
                handler = Promise.race([handler, deadline])         // the request is abandoned if it takes too long to process
            }
            let result = await handler
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

        // await sleep(0.2)                 // for testing
        // session.printCounts()
        // await session.stop()
    }
}


/**********************************************************************************************************************/

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
