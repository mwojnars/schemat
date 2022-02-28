// Run:
// $ node server.js

import os from 'os'
import cluster from 'cluster'
// import http from 'http'
import express from 'express'

import {assert, print, sleep} from './utils.js'
import {ServerRegistry} from './server/registry-s.js'
import {Session} from './registry.js'
import {Request} from "./item.js";
import {YamlDB, RingsDB} from "./server/db.js";

// import {check} from "/site/widgets.js"
// check()


/**********************************************************************************************************************/

const DB_BOOT   = '/home/marcin/Documents/priv/catalog/src/schemat/server/db-boot.yaml'
const DB_WORK   = '/home/marcin/Documents/priv/catalog/src/schemat/server/db-demo.yaml'
const HOSTNAME  = '127.0.0.1'
const PORT      =  3000
const WORKERS   =  1 //Math.floor(os.cpus().length / 2)


let RES = express.response          // standard Express' prototype of all response objects;
                                    // we're extending it with higher-level methods for handling items

RES.sendItem = function(item) {
    /* Send JSON response with a single item: its data (encoded) and metadata. */
    // print('sendItem():', item.id)
    this.json(item.encodeSelf())
}
RES.sendItems = function(items) {
    /* Send JSON response with an array of items. `items` should be an array or a synchronous iterator. */
    if (!(items instanceof Array)) items = Array.from(items)
    let states = items.map(item => item.encodeSelf())
    this.json(states)
}


/**********************************************************************************************************************
 **
 **  APP SERVER
 **
 */

export class Server {
    /* For sending & receiving multi-part data (HTML+JSON) in http response, see:
       - https://stackoverflow.com/a/50883981/1202674
       - https://stackoverflow.com/a/47067787/1202674
     */

    constructor() {
        // this.db = new YamlDB(DB_BOOT)
        this.db = new RingsDB(
            new YamlDB(DB_BOOT, {writable: false}),
            new YamlDB(DB_WORK, {start_IID: 100}),
        )
        this.registry = globalThis.registry = new ServerRegistry(this.db)
        print("Server created")
    }

    async boot() {
        await this.db.load()
        await this.registry.boot() //[1,1]
    }

    async handle(req, res) {
        if (!['GET','POST'].includes(req.method)) { res.sendStatus(405); return }
        print(`Server.handle() worker ${process.pid}:`, req.path)

        let session = new Session(this.registry, req, res)
        await session.start()

        try {
            let result = this.registry.site.routeWeb(session)
            if (result instanceof Promise) result = await result
            if (typeof result === 'string') res.send(result)
        }
        catch (ex) {
            print(ex)
            if (ex instanceof Request.NotFound)
                try { res.sendStatus(404) } catch(e){}
            else
                try { res.sendStatus(500) } catch(e){}
        }

        // let {check} = await this.registry.site.import("/site/widgets.js")
        // check()

        // this.registry.commit()           // auto-commit is here, not in after_request(), to catch and display any possible DB failures
        // await sleep(200)                 // for testing
        // session.printCounts()
        session.stop()
    }

    async serve_express() {
        const app = express()

        // for official middleware see: https://expressjs.com/en/resources/middleware.html
        // for receiving files:
        //  - multer:      https://www.npmjs.com/package/multer and https://expressjs.com/en/5x/api.html#req.body
        //  - fileupload:  https://www.npmjs.com/package/express-fileupload & https://stackoverflow.com/a/50243907/1202674 (newer one, possibly easier)

        app.use(express.json())                                 // for parsing application/json
        app.use(express.urlencoded({extended: false}))          // for parsing application/x-www-form-urlencoded

        app.all('*', (req, res) => this.handle(req, res))
        // web.get('*', async (req, res) => {
        //     res.send(`URL path: ${req.path}`)
        //     res.send('Hello World!')
        // })

        app.listen(PORT, HOSTNAME, () => print(`worker ${process.pid} listening at http://${HOSTNAME}:${PORT}`))
    }

    async serve_cluster(workers) {
        /* Docs for node.js cluster: https://nodejs.org/api/cluster.html */
        if (workers && workers > 1 && cluster.isMaster) {
            print(`primary ${process.pid} is starting ${workers} workers...`)
            for (let i = 0; i < workers; i++) cluster.fork()
            cluster.on('exit', (worker) => print(`Worker ${worker.process.pid} terminated`))
            return
        }
        await this.serve_express()
    }
}

export const server = new Server()
await server.boot()


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

/**********************************************************************************************************************/

// await serve_express()
await server.serve_cluster(WORKERS)
