import {assert, print, timeout, delay} from '../common/utils.js'
import {ServerTimeoutError} from "../common/errors.js";
import {Request} from "../web/request.js";
import {WebObject} from "../core/object.js";
import {Agent, KafkaAgent} from "./agent.js";
// import {thread_local_variable} from "./thread.js";


/**********************************************************************************************************************/

export class Process {
    /* Master or worker process that executes message loops of Agents assigned to the current node. */

    constructor(machine, opts) {
        this.machine = machine
        this.opts = opts
    }

    get worker_id() {
        /* Numeric ID (1, 2, 3, ...) of the current worker process; 0 for the master process. */
        return process.env.WORKER_ID || 0
    }

    is_master() { return !this.worker_id}

    // async start() {
    //     /* deployment loop:
    //        - retrieve a list of new agents (stewards) that should be placed in this worker (node+process)
    //        - for each do:  agent.load() + agent.__deploy__() __install__()
    //        - retrieve a list of objects deployed in this worker that should be removed
    //        - for each do:  agent.reload() + agent.__destroy__() __uninstall__()
    //        - maintain a list of objects currently deployed in this worker process
    //        - for each do:  agent.reload() + agent.__run__()
    //
    //        microservice loop:
    //        - agent = agent.refresh()
    //        - await agent.serve() ... agent.start()
    //        - delay(remaining-time-till-epoch)
    //     */
    // }

    async run() {
        /* Run & refresh loop of active agents. */
        let running = []        // list of agents currently running on this process, each of them has __meta.state

        while (true) {
            let beginning = Date.now()
            this.machine = this.machine.refresh()

            running = await this._start_stop(running)

            if (schemat.is_closing)
                if (running.length) continue; else break        // let the currently running agents gently stop

            let remaining = this.machine.refresh_interval * 1000 - (Date.now() - beginning)
            if (remaining > 0) await delay(remaining)
        }

        print(`Server closed (process #${this.worker_id})`)
    }

    async _start_stop(current) {
        /* Singe iteration of the main loop: start/stop agents that should (or should not) be running now. */

        let next = []                               // agents started in this loop iteration, or already running
        let promises = []

        let agents = this.machine.get_agents_running(this.worker_id)     // agents that *should* be running now on this process (possibly need to be started)

        if (schemat.is_closing) agents = []         // enforce a clean shutdown by stopping all agents

        let agent_ids = agents.map(agent => agent.id)
        let current_ids = current.map(agent => agent.id)

        let to_stop = current.filter(agent => !agent_ids.includes(agent.id))
        let to_start = agents.filter(agent => !current_ids.includes(agent.id))
        let to_refresh = current.filter(agent => agent_ids.includes(agent.id))

        // find agents in `current` that are not in `agents` and need to be stopped
        for (let agent of to_stop)
            promises.push(agent.__stop__(agent.__meta.state))

        // find agents in `agents` that are not in `current` and need to be started
        for (let agent of to_start) {
            next.push(agent)
            promises.push(agent.load().then(async agent => agent.__meta.state = await agent.__start__()))
        }

        // find agents in `current` that are still in `agents` and need to be refreshed
        for (let prev of to_refresh) {
            let agent = prev.refresh()
            next.push(agent)
            if (agent === prev) continue
            promises.push(agent.__restart__(prev.__meta.state, prev).then(state => agent.__meta.state = state))

            // TODO: before __start__(), check for changes in external props and invoke setup.* triggers to update the environment & the installation
            //       and call explicitly __stop__ + triggers + __start__() instead of __restart__()
            // promises.push(prev.__stop__(prev.__meta.state).then(async () => agent.__meta.state = await agent.__start__()))
        }

        [this.machine, ...agents].map(obj => obj.refresh())     // schedule a reload of relevant objects in the background, for next iteration

        await Promise.all(promises)
        return next
    }

    // async loop() {
    //     while (true) {
    //         this.machine = this.machine.refresh()
    //
    //         // `oper` is one of: undefined, 'install', 'uninstall', 'dump'
    //         // `migrate` is a callback that sends the dump data to a new host
    //
    //         for (let {prev, agent, oper, migrate} of actions) {
    //             if (schemat.is_closing) return
    //             if (!oper) continue                     // no action if the agent instance hasn't changed
    //
    //             let state = prev?.__meta.state
    //             let external = (agent || prev)._external_props
    //
    //             // cases:
    //             // 1) install new agent (from scratch):     status == pending_install_fresh   >   installed
    //             // 2) install new agent (from migration):   status == pending_install_clone   >   installed
    //             // 3) migrate agent to another machine:     status == pending_migration & destination   >   installed
    //             // 3) uninstall agent:   status == 'pending_uninstall'
    //             // 4)
    //
    //             if (oper === 'uninstall') {
    //                 if (prev.__meta.started) await prev.__stop__(state)
    //                 await prev.__uninstall__()
    //
    //                 // tear down all external properties that represent/reflect the (desired) state (property) of the environment; every modification (edit)
    //                 // on such a property requires a corresponding update in the environment, on every machine where this object is deployed
    //                 for (let prop of external) if (prev[prop] !== undefined) prev._call_setup[prop](prev, prev[prop])
    //             }
    //         }
    //
    //         for (let {prev, agent, oper, migrate} of actions) {
    //             if (schemat.is_closing) return
    //             if (prev === agent) continue            // no action if the agent instance hasn't changed
    //
    //             let state = prev?.__meta.state
    //             let external = (agent || prev)._external_props
    //
    //             if (!agent) {                           // stop old agents...
    //                 await prev.__stop__(state)
    //                 let dump = await prev.__migrate__()
    //                 if (dump !== undefined) await migrate(dump)     // & wait for confirmation?
    //                 // await prev.__uninstall__()
    //
    //                 // tear down all external properties that represent/reflect the (desired) state (property) of the environment; every modification (edit)
    //                 // on such a property requires a corresponding update in the environment, on every machine where this object is deployed
    //                 for (let prop of external) if (prev[prop] !== undefined) prev._call_setup[prop](prev, prev[prop])
    //                 continue
    //             }
    //
    //             if (!prev) {                            // deploy new agents...
    //                 for (let prop of external) if (agent[prop] !== undefined) agent._call_setup[prop](undefined, undefined, agent, agent[prop])
    //                 await agent.__install__()
    //                 agent.__meta.state = await agent.__start__()
    //                 continue
    //             }
    //
    //             // build a list of modifications of external properties
    //             let changes = agent._external_props
    //
    //             // refresh existing agents; invoke setup.* triggers for modified properties...
    //             if (changes.length) {
    //                 await prev.__stop__(state)
    //                 // launch triggers...
    //                 agent.__meta.state = await agent.__start__()
    //             }
    //             else agent.__meta.state = await agent.__restart__(state, prev)
    //
    //         }
    //     }
    // }
}

/**********************************************************************************************************************/

export class Machine extends KafkaAgent {

    agents_installed
    agents_running
    refresh_interval

    get_agents_running(worker_id) {
        /* List of installed agents that should be running now on a given worker (or master process).
           When an agent needs to be stopped, it's first removed from this list.
         */
        return this.agents_running
    }

    'edit.add_agent'(agent) {
        /* Check that the `agent` is not yet on the list of agents_installed and add it at the end. */
        let installed = (this.agents_installed ??= [])
        if (installed.some(a => a.id === agent.id)) throw new Error('Agent already installed')
        installed.push(agent)
    }

    async 'action.install'(agent, run = true) {
        /* Call agent.__install__() on this node and add the agent to `agents_installed`. If run=true, the agent
           is added to `agents_running`, as well, and gets started on the next iteration of this node's life loop.
         */
        // TODO: this action *must* be executed on the physical node represented by `this` !!
        await agent.load()
        await agent.__install__(this)       // modifies the local environment of this node

        this.edit.add_agent(agent)
        // this['agents_installed[-1]'] = agent
        await this.save()
    }
    async 'action.uninstall'(agent) {}
    async 'action.start'(agent) {}
    async 'action.stop'(agent) {}
}

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

        return app.listen(port, host, () => print(`worker ${process.pid} listening at http://${host}:${port}`))
    }

    async __stop__(http_server) {
        if (http_server) await new Promise(resolve => http_server.close(resolve))
        print(`WebServer closed (worker #${process.env.WORKER_ID})`)
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
            // await sleep(3000)
            let request = new Request({req, res})
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

        // await sleep(200)                 // for testing
        // session.printCounts()
        // await session.stop()
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


/**********************************************************************************************************************
 **
 **  DATA SERVER
 **
 */

