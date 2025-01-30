import {assert, print, timeout, delay} from '../common/utils.js'
import {ServerTimeoutError} from "../common/errors.js";
import {Request} from "../web/request.js";
import {WebObject} from "../core/object.js";
import {Agent, JsonKAFKA, KafkaAgent} from "./agent.js";
// import {thread_local_variable} from "./thread.js";


/**********************************************************************************************************************/

export class Process {
    /* Master or worker process that executes message loops of Agents assigned to the current node. */

    constructor(node, opts) {
        this.node = node        // Machine web object that represents the physical node this process is running on
        this.opts = opts
    }

    get worker_id() {
        /* Numeric ID (1, 2, 3, ...) of the current worker process; 0 for the master process. */
        return process.env.WORKER_ID || 0
    }

    // is_master() { return !this.worker_id}

    async run() {
        /* Run & refresh loop of active agents. */
        schemat.node = this.node

        let running = []        // list of agents currently running on this process, each of them has __state

        while (true) {
            let beginning = Date.now()
            schemat.node = this.node = this.node.refresh()

            running = await this._start_stop(running)

            if (schemat.is_closing)
                if (running.length) continue; else break            // let the currently-running agents gently stop

            [this.node, ...running].map(obj => obj.refresh())       // schedule a reload of relevant objects in the background, for next iteration

            let remaining = this.node.refresh_interval * 1000 - (Date.now() - beginning)
            if (remaining > 0) await delay(remaining)
        }

        print(`Server closed (process #${this.worker_id})`)
    }

    async _start_stop(current) {
        /* In each iteration of the main loop, start/stop agents that should (or should not) be running now. */

        let agents = this._get_agents_running()     // agents that *should* be running now on this process (possibly need to be started)
        if (schemat.is_closing) agents = []         // enforce clean shutdown by stopping all agents

        let agent_ids = agents.map(agent => agent.id)
        let current_ids = current.map(agent => agent.id)

        let to_stop = current.filter(agent => !agent_ids.includes(agent.id))
        let to_start = agents.filter(agent => !current_ids.includes(agent.id))
        let to_refresh = current.filter(agent => agent_ids.includes(agent.id))

        let promises = []
        let next = []                               // agents started in this loop iteration, or already running

        // find agents in `current` that are not in `agents` and need to be stopped
        for (let agent of to_stop)
            promises.push(agent.__stop__(agent.__state))

        // find agents in `agents` that are not in `current` and need to be started
        for (let agent of to_start) {
            next.push(agent)
            promises.push(agent.load().then(async agent => agent.__self.__state = await agent.__start__()))
        }

        // find agents in `current` that are still in `agents` and need to be refreshed
        for (let prev of to_refresh) {
            let agent = prev.refresh()
            next.push(agent)
            if (agent === prev) continue
            promises.push(agent.__restart__(prev.__state, prev).then(state => agent.__self.__state = state))

            // TODO: before __start__(), check for changes in external props and invoke setup.* triggers to update the environment & the installation
            //       and call explicitly __stop__ + triggers + __start__() instead of __restart__()
            // promises.push(prev.__stop__(prev.__state).then(async () => agent.__self.__state = await agent.__start__()))
        }

        await Promise.all(promises)
        return next
    }

    _get_agents_running() {
        /* List of agents that should be running now on this process. When an agent is to be stopped, it should be first removed from this list. */
        return this.node.agents_running || []
    }


    // async loop() {
    //     while (true) {
    //         this.node = this.node.refresh()
    //
    //         // `oper` is one of: undefined, 'install', 'uninstall', 'dump'
    //         // `migrate` is a callback that sends the dump data to a new host
    //
    //         for (let {prev, agent, oper, migrate} of actions) {
    //             if (schemat.is_closing) return
    //             if (!oper) continue                     // no action if the agent instance hasn't changed
    //
    //             let state = prev?.__state
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
    //             let state = prev?.__state
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
    //                 agent.__self.__state = await agent.__start__()
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
    //                 agent.__self.__state = await agent.__start__()
    //             }
    //             else agent.__self.__state = await agent.__restart__(state, prev)
    //
    //         }
    //     }
    // }
}

/**********************************************************************************************************************/

export class Machine extends KafkaAgent {

    agents_installed
    agents_running

    master_agents_installed
    master_agents_running

    refresh_interval

    get worker_id() {
        /* Numeric ID (1, 2, 3, ...) of the current worker process; 0 for the master process. */
        return process.env.WORKER_ID || 0
    }

    get __kafka_client() { return `node-${this.id}-worker-${this.worker_id}` }

    // get kafka() { return this.__state.kafka }
    // get kafka_producer() { return this.__state.producer }


    async __start__() {
        let {Kafka} = await import('kafkajs')
        let kafka = new Kafka({clientId: this.__kafka_client, brokers: [`localhost:9092`]})

        let producer = kafka.producer()
        await producer.connect()
        return {kafka, producer}
    }

    async __stop__({producer}) {
        await producer.disconnect()
    }


    'edit.add_installed'(agent) {
        /* Check that the `agent` is not yet on the list of agents_installed and add it at the end. Idempotent. */
        let installed = (this.agents_installed ??= [])
        if (installed.every(a => a.id !== agent.id)) installed.push(agent)
    }

    'edit.remove_installed'(agent) {
        /* Remove the `agent` from the list of agents_installed. Idempotent. */
        let installed = this.agents_installed || []
        this.agents_installed = installed.filter(a => a.id !== agent.id)
    }

    async 'KAFKA.install'() {
        /* Call agent.__install__() on this node and add the agent to `agents_installed`. If start=true, the agent
           is also added to `agents_running` and is started on the next iteration of the host process's life loop.
         */
        return new JsonKAFKA({
            server: async (agent, start = true) => {
                await agent.load()
                await agent.__install__(this)       // this can modify the local environment of the host node

                this.edit.add_installed(agent)
                await this.save()
            }
        })
    }

    async 'KAFKA.uninstall'(agent) {}

    async 'action.start'(agent) {
        // confirm that `agent` is installed and stopped...

        this.agents_running.push(agent)
        await this.save()
    }
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

