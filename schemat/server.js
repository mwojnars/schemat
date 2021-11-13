// Run:
// $ node server.js

import http from 'http'
import express from 'express'
import { readFileSync } from 'fs'

import { assert, print, T } from './utils.js'
import { Database, Registry } from './registry.js'
import yaml from 'js-yaml'


/**********************************************************************************************************************/

const DB_YAML   = '/home/marcin/Documents/priv/catalog/src/django-app/items.yaml'
const HOSTNAME  = '127.0.0.1'
const PORT      =  3000


/**********************************************************************************************************************
 **
 **  APP SERVER
 **
 */

class FileDB extends Database {
    /* Items stored in a file. For use during development only. */

    filename = null
    items    = new Map()        // preloaded flat items, as {key: item_record} pairs; keys are strings "cid:iid";
                                // item records are schema-encoded, but JSON-decoded (!), with fields cid,iid,data
    
    constructor(filename) {
        super()
        this.filename = filename
    }
    
    _key(id) {
        let [cid, iid] = id
        assert(cid !== null && iid !== null)
        return `${cid}:${iid}`
    }
    _get(id)        { return this.items.get(this._key(id)) }
    _set(id, item)  { return this.items.set(this._key(id), item) }

    select(id) {
        let item = this._get(id)
        assert(item.cid === id[0] && item.iid === id[1])
        return item
    }
    *scan_category(cid) {
        for (const item of this.items.values())
            if (cid === item.cid) yield item
    }
}

class YamlDB extends FileDB {
    /* Items stored in a YAML file. For use during development only. */

    max_iid = new Map()         // current maximum IIDs per category, as {cid: maximum_iid}
    
    load() {
        let file = readFileSync(this.filename, 'utf8')
        let db = yaml.load(file)
        this.items.clear()
        this.max_iid.clear()
        
        for (let data of db) {
            let id = T.pop(data, 'id')
            let [cid, iid] = id
            assert(!this.items.has(this._key(id)), `duplicate item ID: ${id}`)
            let curr_max = this.max_iid.get(cid) || 0
            this.max_iid[cid] = Math.max(curr_max, iid)
            this._set(id, {cid, iid, data})
        }
        // print('YamlDB items loaded:')
        // for (const [id, data] of this.items)
        //     print(id, data)
    }
    // insert(item, flush = true):
    //    
    //     if item.cid is null:
    //         item.cid = item.category.iid
    //     cid = item.cid
    //    
    //     if cid == 0 and cid not in this.max_iid:
    //         max_iid = -1   # use =0 if the root category is not getting an IID here
    //     else:
    //         max_iid = this.max_iid.get(cid, 0)
    //        
    //     item.iid = iid = max_iid + 1
    //     this.max_iid[cid] = iid
    //    
    //     assert item.has_data()
    //     assert item.id not in this.items
    //     # print("store:", list(item.data.lists()))
    //    
    //     this.items[item.id] = item.dump_data()
    //
    //     if flush: this.flush()
    //
    // update(item, flush = true):
    //    
    //     assert item.has_data()
    //     assert item.has_id()
    //     this.items[item.id] = item.dump_data()
    //     if flush: this.flush()
    //
    // flush():
    //     """Save the entire database (this.items) to a file."""
    //     flats = []
    //
    //     for id, raw in this.items.items():
    //        
    //         flat = {'id': list(id)}
    //         flat.update(json.loads(raw))
    //         flats.append(flat)
    //        
    //     print(f"YamlDB flushing {len(this.items)} items to {this.filename}...")
    //     out = open(this.filename, 'wt')
    //     yaml.dump(flats, stream = out, default_flow_style = null, sort_keys = False, allow_unicode = true)
}

export class ServerRegistry extends Registry {
    constructor() {
        super()
        this.db = new YamlDB(DB_YAML)
        // this.cache = new ServerCache()
    }
    async boot() {
        this.db.load()
        await super.boot()
    }
}


class Server {
    /* Sending & receiving multi-part data (HTML+JSON) in http response:
       - https://stackoverflow.com/a/50883981/1202674
       - https://stackoverflow.com/a/47067787/1202674
     */

    registry = new ServerRegistry()

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
        - request.item  = target item that's responsible for actual handling of this request

        TODO remove/rename:
        - request.app   = leaf Application object this request is addressed to
        - request.state = app-specific temporary data that's written during routing (handle()) and can be used for
                          response generation when a specific app's method is called, most typically url_path()
        */
        print('Server.handle() start')
        this.start_request(req)
        let site = await this.registry.site
        site.handle(req, res)
        // this.registry.commit()           // auto-commit is here, not in after_request(), to catch and display any possible DB failures
        res.end()
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

    web.get('*', async (req, res) => {
        await server.handle(req, res)
        // res.send(`URL path: ${req.path}`)
        // res.send('Hello World!')
    })

    web.listen(PORT, HOSTNAME, () => {
        console.log(`Example app listening at http://${HOSTNAME}:${PORT}`)
    });
}

await serve_express()
