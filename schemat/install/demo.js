/*
    Generate demo DBs in ../../demo/XXX folders by copying db-site.* under db.* names and replacing file paths, names etc.
 */

import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from "node:url"
import yaml from 'js-yaml'

import {print} from "../common/utils.js"
import {AdminProcess} from "../server/processes.js";


/**********************************************************************************************************************/

let __filename = fileURLToPath(import.meta.url)
let __dirname  = path.dirname(__filename)

let root_dir = `${__dirname}/../..`
let demo_names = [null, '01_books', '02_blog', '03_chatter']


function _load_data_init() {
    /* Read db-site.yaml and return its plain-text content. Drop unneeded objects. */

    let path = `${root_dir}/schemat/data/db-site.yaml`
    let db = fs.readFileSync(path, 'utf8')
    // let data = yaml.load(db)
    return db
}

// function _delete_object(db, id) {
//     /* In a yaml string `db`, delete the block that starts with:
//          - __id: <id>
//            ...
//         up until the next `- __id:` line.
//         FIXME: this approach is incorrect, because references to the objects still stay in indexes.
//      */
//     let re = new RegExp(`- __id: ${id}(.*?)\n(?=- __id:|$)`, 's')
//     return db.replaceAll(re, '')
// }

/**********************************************************************************************************************/

async function create_demo_01() {
    // load initial `db` from db-site.yaml
    let demo_name = demo_names[1]
    let demo_dir = `${root_dir}/demo/${demo_name}`
    let db = _load_data_init()
    
    // replace file paths and object names in `db`
    db = db.replaceAll('main-site', `Books Demo`)

    db = db.replaceAll('/schemat/data/db-site.', `/demo/${demo_name}/data/db.`)
    db = db.replaceAll('db-site', `db`)

    // save as db.yaml in the demo folder
    fs.writeFileSync(`${demo_dir}/data/db.yaml`, db, 'utf8')
    
    // copy db-site.idx_* files to db.idx_* in the demo folder
    fs.copyFileSync(`${root_dir}/schemat/data/db-site.idx_category_item.jl`, `${demo_dir}/data/db.idx_category_item.jl`)
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

    // start Schemat from the demo folder, so that all modifications are saved in the demo's DB
    let demo_name = demo_names[demo_id]
    await new AdminProcess().start(null, {demo_id, config: `${root_dir}/demo/${demo_name}/config.yaml`})

    // drop unneeded objects
    let ids = [1005, 1006, 5001, 5002, 5003, 5000, 1030, 1031]
    for (let id of ids) await schemat.db.delete(id)

    schemat.is_closing = true
}
