// Run:
// $ node server.js

// import http from 'http'
import express from 'express'

import {assert, print, sleep} from './utils.js'
import {ServerRegistry} from './server/registry-s.js'
import {Session} from './registry.js'


/**********************************************************************************************************************/

const DB_YAML   = '/home/marcin/Documents/priv/catalog/src/schemat/server/db.yaml'
const HOSTNAME  = '127.0.0.1'
const PORT      =  3000

let RES = express.response          // standard Express' prototype of all response objects;
                                    // we're extending it with higher-level methods for handling items

RES.sendItem = function(item) {
    /* Send JSON response with a single item: its data (encoded) and metadata. */
    print('sendItem():', item.id)
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

class Server {
    /* For sending & receiving multi-part data (HTML+JSON) in http response, see:
       - https://stackoverflow.com/a/50883981/1202674
       - https://stackoverflow.com/a/47067787/1202674
     */

    constructor() {
        this.registry = globalThis.registry = new ServerRegistry(DB_YAML)
    }
    async boot() { return this.registry.boot() }

    async handle(req, res) {
        if (!['GET','POST'].includes(req.method)) { res.sendStatus(405); return }
        // print('Server.handle() start')

        let session = new Session(this.registry, req, res)
        session.start()

        let site = this.registry.site
        await site.execute(session)
        // this.registry.commit()           // auto-commit is here, not in after_request(), to catch and display any possible DB failures
        // await sleep(100)       // for testing
        session.stop()
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

async function serve_express() {
    // const express = require('express')
    const app = express()
    const server = new Server()
    await server.boot()

    // for official middleware see: https://expressjs.com/en/resources/middleware.html
    // for receiving files:
    //  - multer:      https://www.npmjs.com/package/multer and https://expressjs.com/en/5x/api.html#req.body
    //  - fileupload:  https://www.npmjs.com/package/express-fileupload & https://stackoverflow.com/a/50243907/1202674 (newer one, possibly easier)

    app.use(express.json())                                 // for parsing application/json
    app.use(express.urlencoded({extended: false}))          // for parsing application/x-www-form-urlencoded

    app.all('*', (req, res) => server.handle(req, res))
    // web.get('*', async (req, res) => {
    //     res.send(`URL path: ${req.path}`)
    //     res.send('Hello World!')
    // })

    app.listen(PORT, HOSTNAME, () => {
        console.log(`Example app listening at http://${HOSTNAME}:${PORT}`)
    });
}

/**********************************************************************************************************************/

await serve_express()
