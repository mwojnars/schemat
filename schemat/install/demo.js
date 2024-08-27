/*
    Generate demo DBs in ../../demo/XXX folders by copying db-init.* under db.* names and replacing file paths, names etc.
 */

import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'


let __filename = fileURLToPath(import.meta.url)
let __dirname  = path.dirname(__filename)

let root_dir = `${__dirname}/../..`


function _load_data_init() {
    /* Read db-init.yaml and return its plain-text content. */

    let db_init_path = `${root_dir}/schemat/data/db-init.yaml`
    let db_init_content = fs.readFileSync(db_init_path, 'utf8')
    // let db_init_data = yaml.load(db_init_content)
    return db_init_content
}

export function setup_demo_01() {
    // load initial `db` from db-init.yaml
    let demo_name = '01_books'
    let demo_dir = `${root_dir}/demo/${demo_name}`
    let db = _load_data_init()
    
    // replace file paths and object names in `db`, drop unneeded objects
    db = db.replace('/schemat/data/db-init.', `/demo/${demo_name}/db.`)
    db = db.replace('db-init', `db`)
    db = db.replace('main-site', `Books - Demo Site`)

    // save as db.yaml in the demo folder
    fs.writeFileSync(`${demo_dir}/db.yaml`, db, 'utf8')
    
    // copy db-init.idx_* files to db.idx_* in the demo folder
    fs.copyFileSync(`${root_dir}/schemat/data/db-init.idx_category_item.jl`, `${demo_dir}/db.idx_category_item.jl`)
}
