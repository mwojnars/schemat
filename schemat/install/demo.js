/*
    Generate demo DBs in ../../demo/XXX folders by copying db-init.* under db.* names and replacing file paths, names etc.
 */

import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from "node:url"

import yaml from 'js-yaml'


/**********************************************************************************************************************/

let __filename = fileURLToPath(import.meta.url)
let __dirname  = path.dirname(__filename)

let root_dir = `${__dirname}/../..`


function _load_data_init() {
    /* Read db-init.yaml and return its plain-text content. Drop unneeded objects. */

    let path = `${root_dir}/schemat/data/db-init.yaml`
    let db = fs.readFileSync(path, 'utf8')
    // let data = yaml.load(db)

    let ids = [1005, 1006, 1016, 1017, 1018, 1029, 1030, 1031]
    for (let id of ids) db = _delete_object(db, id)

    return db
}

function _delete_object(db, id) {
    /* In a yaml string `db`, delete the block that starts with:
         - __id: <id>
           ...
        up until the next `- __id:` line.
     */
    let re = new RegExp(`^- __id: ${id}(.*?)\n(?=- __id:|$)`, 'ms')
    return db.replace(re, '')
}

/**********************************************************************************************************************/

export function create_demo_01() {
    // load initial `db` from db-init.yaml
    let demo_name = '01_books'
    let demo_dir = `${root_dir}/demo/${demo_name}`
    let db = _load_data_init()
    
    // replace file paths and object names in `db`
    db = db.replace('/schemat/data/db-init.', `/demo/${demo_name}/db.`)
    db = db.replace('db-init', `db`)
    db = db.replace('main-site', `Books Demo`)

    // save as db.yaml in the demo folder
    fs.writeFileSync(`${demo_dir}/db.yaml`, db, 'utf8')
    
    // copy db-init.idx_* files to db.idx_* in the demo folder
    fs.copyFileSync(`${root_dir}/schemat/data/db-init.idx_category_item.jl`, `${demo_dir}/db.idx_category_item.jl`)
}
