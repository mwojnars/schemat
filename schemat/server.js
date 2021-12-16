// Run:
// $ node server.js

// import http from 'http'
import express from 'express'

import {assert, print, sleep} from './utils.js'
import {JSONx} from './serialize.js'
import {ServerRegistry} from './server/registry-s.js'


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

class Session {
    /* Collection of objects that are global to a single request processing, and an evolving state of the latter. */

    request
    response
    registry

    get req()       { return this.request  }
    get res()       { return this.response }
    get channels()  { return [this.request, this.response] }

    get targetApp()     { return this.request.app  }
    get targetItem()    { return this.request.item }

    ipath               // like request.path, but with trailing @endpoint removed; typically identifies an item ("item path")
    endpoint            // item's endpoint/view that should be executed; empty string '' if no endpoint
    endpointDefault     // default endpoint that should be used instead of "view" if `endpoint` is missing;
                        // configured by an application that handles the request

    // site?
    // app             // leaf Application object this request is addressed to
    // item            // target item that's responsible for actual handling of this request
    // state           // app-specific temporary data that's written during routing (handle()) and can be used for
    //                 // response generation when a specific app's method is called, most typically url_path()

    constructor(request, response, registry) {
        this.request  = request
        this.response = response
        this.registry = registry
    }

    // get an ultimate endpoint, with falling back to a default when necessary
    getEndpoint()           { return this.request.endpoint || this.request.endpointDefault || 'view' }

    redirect(...args)       { this.response.redirect(...args) }
    send(...args)           { this.response.send(...args) }
    sendFile(...args)       { this.response.sendFile(...args) }
    sendStatus(...args)     { this.response.sendStatus(...args) }

    bootItems() {
        /* List of state-encoded items to be sent over to a client to bootstrap client-side item cache. */
        let item  = this.targetItem
        let items = [item, item.category, this.registry.root, this.targetApp]
        items = [...new Set(items)].filter(Boolean)                 // remove duplicates and nulls
        return items.map(i => i.encodeSelf())
    }
    bootData() {
        /* Request and configuration data to be embedded in HTML response; .request is state-encoded. */
        let {item, app, state} = this.request
        let request  = {item, app, state}
        let ajax_url = this.registry.site.ajaxURL()
        return {'ajax_url': ajax_url, 'request': JSONx.encode(request)}
    }
}


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
        await registry.initClasspath()
        await registry.boot()
    }

    async handle(req, res) {
        /*
        During request processing, some additional non-standard attributes are assigned in `request`
        to carry specific information for downstream processing functions:
        - request.ipath    = like request.path, but with trailing @endpoint removed; usually identifies an item ("item path")
        - request.endpoint = item's endpoint/view that should be executed; empty string '' if no endpoint
        - request.endpointDefault = default endpoint that should be used instead of "view" if `endpoint` is missing;
                                    configured by an application that handles the request
        TODO remove/rename:
        - request.item  = target item that's responsible for actual handling of this request
        - request.app   = leaf Application object this request is addressed to
        - request.state = app-specific temporary data that's written during routing (handle()) and can be used for
                          response generation when a specific app's method is called, most typically url_path()
        */
        if (!['GET','POST'].includes(req.method)) { res.sendStatus(405); return }

        // print('Server.handle() start')

        // // req.query.PARAM is a string if there's one occurrence of PARAM in a query string,
        // // or an array [val1, val2, ...] if PARAM occurs multiple times
        // print('request query: ', req.query)
        // print('request body:  ', req.body)

        this.start_request(req)
        let session = new Session(req, res, this.registry)
        let site = this.registry.site
        await site.execute(session)
        // this.registry.commit()           // auto-commit is here, not in after_request(), to catch and display any possible DB failures

        // await sleep(100)       // for testing
        this.stop_request()
    }

    start_request(req) {
        assert(!this.registry.current_request, 'trying to start a new request when another one is still open')
        this.registry.current_request = req
        req.state = {}
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
