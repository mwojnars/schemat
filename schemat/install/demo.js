/*
    Generate demo DB files in ../../demo/XXX by copying 01_cluster.* ring and replacing file paths, names etc.
    The other ring, 02_app, is left *untouched*, so any app-specific data is preserved (!).
 */

import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from "node:url"
import yaml from 'js-yaml'

import {print} from "../common/utils.js"
// import {AdminProcess} from "../server/admin.js";


/**********************************************************************************************************************/

let __filename = fileURLToPath(import.meta.url)
let __dirname  = path.dirname(__filename)

let root_dir = `${__dirname}/../..`
let demo_names = [null, '01_books', '02_blog', '03_chatter']


function _load_data_init() {
    /* Read 01_cluster.data.yaml and return its plain-text content. Drop unneeded objects. */

    let path = `${root_dir}/schemat/data/01_cluster.data.yaml`
    let db = fs.readFileSync(path, 'utf8')
    // let data = yaml.load(db)
    return db
}

// function _delete_object(db, id) {
//     /* In a yaml string `db`, delete the block that starts with:
//          - id: <id>
//            ...
//         up until the next `- id:` line.
//         FIXME: this approach is incorrect, because references to the objects still stay in indexes.
//      */
//     let re = new RegExp(`- id: ${id}(.*?)\n(?=- id:|$)`, 's')
//     return db.replaceAll(re, '')
// }

/**********************************************************************************************************************/

async function create_demo_01() {
    // load initial `db` from 01_cluster.data.yaml
    let demo_name = demo_names[1]
    let demo_dir = `${root_dir}/demo/${demo_name}`
    let db = _load_data_init()
    
    // replace file paths, object names and port numbers in `db`
    db = db.replaceAll('main-app', `Bookstore (demo app)`)
    db = db.replaceAll('name: home', `name: home\n  view_endpoint: demo/01_books/home/home.js:homepage`)

    db = db.replaceAll('/schemat/data/01', `/demo/${demo_name}/_data/01`)       // 01_cluster.*
    db = db.replaceAll('/schemat/data/02', `/demo/${demo_name}/_data/02`)       // 02_app.*
    db = db.replaceAll('/app', `/demo/${demo_name}`)

    db = db.replaceAll('tcp_port: 5828', `tcp_port: 5820`)
    db = db.replaceAll('tcp_port: 5829', `tcp_port: 5821`)

    // add 02_app.index block [1030] to agents of node [1024] to allow single-node execution of the application (node [1036] not used)
    db = db.replaceAll('  agents:', `  agents:\n    - {worker: 1, agent: {"@": 1030}}`)

    // insert AuthorCategory and BookCategory references in [app.global]; insert URL routes
    db = db.replaceAll(`global:`, `global:\n    AuthorCategory:\n      "@": 2002\n    BookCategory:\n      "@": 2001`)
    db = db.replaceAll(`entries:\n    ""`, `entries:\n    authors:\n      "@": 2002\n    books:\n      "@": 2001\n    book:\n      "@": 2015\n    ""`)

    // save as 01_cluster.data.yaml in the demo folder
    fs.writeFileSync(`${demo_dir}/_data/01_cluster.data.yaml`, db, 'utf8')
    
    // copy the index file
    fs.copyFileSync(`${root_dir}/schemat/data/01_cluster.index.jl`, `${demo_dir}/_data/01_cluster.index.jl`)
}

async function create_demo(demo_id) {
    print('Creating demo', demo_id)
    switch (demo_id) {
        case 1: return create_demo_01()
        default: throw new Error(`unknown demo ID: ${demo_id}`)
    }
}


/**********************************************************************************************************************/

// Main execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {

    let demo_id = Number(process.argv[2])
    if (isNaN(demo_id)) throw new Error('Please provide a valid demo ID')

    // copy initial files to demo folder
    await create_demo(demo_id)

    // // start Schemat from the demo folder, so that all modifications are saved in the demo's DB
    // let demo_name = demo_names[demo_id]
    // await new AdminProcess().start(null, {demo_id, config: `${root_dir}/demo/${demo_name}/config.yaml`})
    //
    // // drop unneeded objects
    // let ids = [2001, 2002, 2003, 2004, 2005, 2006]    // 1005, 1006  ??
    // for (let id of ids) await schemat.db.delete(id)
    //
    // schemat.set_closing()
}
