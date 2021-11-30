// Run:
// $ node server.js

import http from 'http'
import express from 'express'

import {assert, print} from './utils.js'
import {ServerRegistry} from './server/s-registry.js'


/**********************************************************************************************************************/

const DB_YAML   = '/home/marcin/Documents/priv/catalog/src/schemat/server/db.yaml'
const HOSTNAME  = '127.0.0.1'
const PORT      =  3000


/**********************************************************************************************************************
 **
 **  APP SERVER
 **
 */

class Server {
    /* Sending & receiving multi-part data (HTML+JSON) in http response:
       - https://stackoverflow.com/a/50883981/1202674
       - https://stackoverflow.com/a/47067787/1202674
     */

    registry = new ServerRegistry(DB_YAML)

    constructor() {
        globalThis.registry = this.registry
    }
    async boot() {
        await registry.init_classpath()
        await registry.boot()
    }

    async handle(req, res) {
        /*
        During request processing, some additional non-standard attributes are assigned in `request`
        to carry Hyperweb-specific information for downstream processing functions:

        x request.endpoint = item's endpoint/view that should be executed
        TODO remove/rename:
        - request.item  = target item that's responsible for actual handling of this request
        - request.app   = leaf Application object this request is addressed to
        - request.state = app-specific temporary data that's written during routing (handle()) and can be used for
                          response generation when a specific app's method is called, most typically url_path()
        */
        print('Server.handle() start')
        this.start_request(req)
        let site = await this.registry.site
        await site.execute(req, res)
        // this.registry.commit()           // auto-commit is here, not in after_request(), to catch and display any possible DB failures
        this.stop_request()
    }

    start_request(req) {
        assert(!this.registry.current_request, 'trying to start a new request when another one is still open')
        this.registry.current_request = req
        req.state = null
    }
    stop_request() {
        assert(this.registry.current_request, 'trying to stop a request when none was started')
        // this.registry.commit()
        // this.registry.cache.evict()
        this.registry.current_request = null
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
    const web = express()
    const server = new Server()
    await server.boot()

    web.get('*', (req, res) => server.handle(req, res))
    // web.get('*', async (req, res) => {
    //     res.send(`URL path: ${req.path}`)
    //     res.send('Hello World!')
    // })

    web.listen(PORT, HOSTNAME, () => {
        console.log(`Example app listening at http://${HOSTNAME}:${PORT}`)
    });
}

/**********************************************************************************************************************/

await serve_express()
