import {assert, print, timeout, sleep, utc} from '../common/utils.js'
import {ServerTimeoutError} from "../common/errors.js";
import {WebRequest} from "../web/request.js";
import {WebObject} from "../core/object.js"
// import {thread_local_variable} from "./thread.js";


/**********************************************************************************************************************/

export class AgentState {   // AgentData, AgentVariables, Registers
    /* Internal variables and memory of a running agent. Created in agent.__start__() and __restart__(), and passed
       to all agent methods: control methods (__stop__() etc.), as well as user methods ($agent.*()).
       Some of these variables are created by kernel: __role, __options, __frame.
     */

    __role          // name of the agent's role, e.g. "$leader"; starts with '$', empty/undefined means a generic role ($agent)
    __options       // startup options provided by the creator of this agent
    __exclusive     // a flag that can be set in __start__() to inform the kernel that all calls to agent methods should be executed in a mutually exclusive lock (no concurrency)
    __frame         // Frame of the current run, assigned by kernel

    // subclasses can add custom fields here:
    // ...
    // alternatively, custom fields are copy-pasted into a vanilla AgentState whenever
    // a plain custom object {...} is returned from __start__()

    async lock() {
        /* Set per-call exclusive mode and wait until all calls to this agent are completed.
           Can be used inside $agent.*() methods to prevent concurrent calls:
                await state.lock()
                ...
                state.unlock()

           Note that lock() must NOT be preceded by any asynchronous instruction (await);
           ideally, it should be the first instruction in the function body.
           lock() must NOT be used in recursive RPC methods, as this will cause a deadlock.
         */
        await this.__frame.lock()
    }

    unlock() { this.__frame.unlock() }
}


export class Agent extends WebObject {
    /* A web object that can be installed on a particular node(s) in the cluster to run a perpetual operation there (a microservice).
       Typically, the agent runs a web server, or an intra-cluster microservice of any kind, with a perpetual event loop.
       The agent is allowed to use local resources of the host node: files, sockets, etc.; with some of them (typically files)
       being allocated/deallocated in __install__/__uninstall__(), while some others (e.g., sockets) in __start__/__stop__().
    */

    __ctx           // Database that provides context of execution for this agent's __start__/__stop__ methods ("user mode"),
                    // and a fallback context for $agent.*() methods if no request-specific RPC context was given;
                    // if missing, kernel's context (cluster) is used ("kernel mode")

    num_workers     // number of concurrent workers per node that should execute this agent's microservice at the same time; -1 = "all available"
    hard_restart
    file_tag        // string to be included in names of files and directories

    get file_path() { throw new Error(`file_path not implemented for agent ${this}`) }


    async __install__(node) {}  // ideally, this method should be idempotent in case of failure and subsequent re-launch
    async __uninstall__(node) {}

    async __start__({role, node, options} = {}) {
        /* Start the microservice implemented by this agent. Return an "execution state" which will be accessible
           to external calls addressed to the running agent (RPC calls or direct function calls)
           and will be passed to __stop__() upon microservice termination. Typically, the state object contains
           handlers to all the resources that were opened during __start__() and must be released in __stop__().
           The execution state, if present, should be a plain JS object. If the microservice allows local direct
           function calls to the microservice, these functions should be top-level elements of the returned state
           (state.fun()) - all calls to these functions will be automatically protected and monitored, so that
           the microservice termination awaits the graceful completion of such calls; same for RPC (obj.$agent.X()) calls.
         */
    }
    async __stop__(state) {
        /* Release any local resources that were acquired during __start__() and are passed here in the `state` of execution. */
    }

    async __restart__(state, prev) {
        /* In many cases, refreshing an agent in the worker process does NOT require full stop+start, which might have undesired side effects
           (temporary unavailability of the microservice). For this reason, __restart__() is called upon agent refresh - it can be customized
           in subclasses, and the default implementation either does nothing (default), or performs the full stop+start cycle (if hard_restart=true).
         */
        if (!this.hard_restart) return state
        await prev.__stop__(state)
        return this.__start__()
    }

    async __pause__(state) {}       // any custom operations that must be done on state to actually pause the agent
    async __resume__(state) {}      // reverse of __pause__()

    // __export__()     -- prepare the agent for migration/replication to another node; return a dump to be passed to __import__()
    // __import__()     -- after __install__(), import agent's state from another node using the dump generated by __export__()


    /***  Triggers  ***/

    async '$agent.ping'(state, msg) {
        /* Default RPC endpoint for testing intra-cluster communication. */
        let response = `[${utc()}]  PING: agent [${this.id}], ${msg}`
        print(response)
        return response
    }

    async '$agent.pause'(state) {
        /* Pause the execution of this agent: execution of new requests is suspended, scheduled events should be
           rescheduled for a later date, until __resume__() is called. Particularly useful for debugging.
         */
        state.__frame.paused = true
        await this.__pause__(state)
    }

    async '$agent.resume'(state) {
        await this.__resume__(state)
        state.__frame.paused = false
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
        // await schemat._init_app()

        let express = (await import('express')).default
        let bodyParser = (await import('body-parser')).default

        let xapp = express()

        // for official middleware see: https://expressjs.com/en/resources/middleware.html
        // for receiving files:
        //  - multer:      https://www.npmjs.com/package/multer and https://expressjs.com/en/5x/api.html#req.body
        //  - fileupload:  https://www.npmjs.com/package/express-fileupload & https://stackoverflow.com/a/50243907/1202674 (newer one, possibly easier)

        // // set CORS headers in all responses to allow cross-origin requests
        // xapp.use((req, res, next) => {
        //     res.header('Access-Control-Allow-Origin', '*')      // or the specific origin of your client app
        //     res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
        //     next()
        // })

        // xapp.use(express.json())                                 // for parsing application/json to req.body object
        xapp.use(express.urlencoded({extended: false}))             // for parsing application/x-www-form-urlencoded
        xapp.use(bodyParser.text({type: '*/*', limit: '10MB'}))     // for setting req.body string from plain-text body (if not json MIME-type)

        xapp.all('*', schemat.with_context((req, res) => this._handle(req, res)))

        let host = schemat.config.host || this.host || schemat.node.http_host
        let port = schemat.config.port || this.port || schemat.node.http_port

        let server = xapp.listen(port, host, schemat.with_context(() => this._print(`listening at http://${host}:${port}`)))
        return {server}
    }

    async __stop__({server}) {
        if (server) await new Promise(resolve => server.close(resolve))
        this._print(`WebServer closed`)
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
            let handler = schemat.app.route(request)

            if (this.request_timeout) {
                let deadline = timeout(this.request_timeout * 1000, new ServerTimeoutError())
                handler = Promise.race([handler, deadline])         // the request is abandoned if it takes too long to process
            }
            let result = await handler
            if (typeof result === 'string') res.send(result)
        }
        catch (ex) {
            this._print(ex)
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
        // let {check} = await schemat.app.import_module("/app/widgets.js")
        // check()

        // await schemat.after_request()
        // print(`handle() worker ${process.pid} finished: ${req.path}`)

        // await sleep(0.2)                 // for testing
        // session.printCounts()
        // await session.stop()
    }
}
