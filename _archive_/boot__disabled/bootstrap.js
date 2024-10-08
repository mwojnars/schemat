/*
Creating core items from scratch and storing them as initial items in DB.
 */

import {print, assert} from '../common/utils.js'
import {GENERIC, TYPE, BOOLEAN, NUMBER, STRING, TEXT, CODE, ITEM, PATH} from '../types/type.js'
import {Catalog} from "../core/data.js"
import {CATALOG} from "../types/catalog.js"
import * as urls from "../std/containers.js";
import * as site from "../std/site.js";
import * as files from "../std/files.js";

// import {fileURLToPath} from 'url'
// import path from "path"

// const __filename = fileURLToPath(import.meta.url)       // or: process.argv[1]
// const __dirname  = path.dirname(__filename)

export const SITE_CATEGORY_ID = 1

// conversion of a dict to a Catalog
export let C = (...data) => new Catalog(...data)


/**********************************************************************************************************************
 **
 **  CATEGORIES & ITEMS
 **
 */

async function create_categories(Category) {

    let cat = {}

    cat.Site = await Category.new(SITE_CATEGORY_ID, {
        name        : "Site",
        info        : "Top-level URL routing + global configuration of applications, servers, startup.",
        fields      : C({
            base_url        : new STRING({info: "Base URL at which the website is served: protocol + domain + root path (if any); no trailing '/'."}),
            default_path    : new PATH({info: "URL path of a default container that can be used to access any object via its ID. For internal purposes. Should contain a leading slash and no trailing slash."}),
            entries         : new CATALOG({values: new ITEM(), repeated: true, info: "URL prefixes (as keys) mapped to items that shall perform routing of requests whose URLs start with a given prefix. NO leading/trailing slashes."}),
            //path_local    : new PATH({info: "URL route of a LocalDirectory that maps to the root folder of the Schemat's local installation."}),
            //route_default: new ITEM({info: "URL route anchored at the site root, i.e., having empty URL prefix. If there are multiple `route_default` entries, they are being tried in the order of listing in the site's configuration, until a route is found that does NOT raise the Request.NotFound."}),
            //router      : new ITEM({info: "Router that performs top-level URL routing to downstream applications and file folders."}),
            //database    : new ITEM({category: cat.Database, info: "Global database layer"}),
        }),
    })

    cat.File = await Category.new(3, {
        name        : "File",
        info        : "File with a text content.",
        fields      : C({
            content     : new CODE(),      // VARIANT(bin : BYTES(), txt : TEXT()),
            mimetype    : new STRING({info: "MIME type string (must include '/') to be set as Content-Type when serving file download; or an extension ('js', 'jpg', ...) to be converted to an appropriate type. If missing, response mimetype is inferred from the URL path extension, if present."}),
            format      : new STRING(),    // ProgrammingLanguage()
        }),
    })
    cat.LocalFile = await Category.new(4, {
        name        : "LocalFile",
        info        : "File located on a local disk, identified by its local file path.",
        __extends   : cat.File,
        fields      : C({
            local_path : new STRING(),          // path to a local file on disk
            //format: new STRING(),             // file format: pdf, xlsx, ...
        }),
    })
    cat.Directory = await Category.new(5, {
        name        : "Directory",
        info        : "A directory of files, each file has a unique name (path). May contain nested directories.",
        fields      : C({
            entries     : new CATALOG({values: new ITEM()}),          // file & directory names mapped to item IDs
        }),
    })
    cat.LocalDirectory = await Category.new(6, {
        name        : "LocalDirectory",
        info        : "File folder located on a local disk, identified by its local file path.\nGives access to all files and folders beneath the path.",
        __extends   : cat.Directory,
        fields      : C({local_path: new STRING()}),
    })

    cat.Namespace = await Category.new(7, {
        name        : "Namespace",
        info        : "",
    })
    cat.IID_Namespace = await Category.new(8, {
        name        : "IID_Namespace",
        info        : "Namespace that serves items on simple URLs of the form /IID. Mainly used for system & admin purposes, or as a last-resort default for URL generation.",
        fields      : C({
            category    : new ITEM({category: Category, info: "Optional category(ies) of items handled by this namespace."}),
        }),
    })
    cat.Category_IID_Namespace = await Category.new(9, {
        name        : "Category_IID_Namespace",
        info        : "Namespace for accessing public data through verbose paths of the form: .../SPACE:IID, where SPACE is a text identifier assigned to a category in `spaces` property.",
        fields      : C({spaces: new CATALOG({values: new ITEM({category: Category})})}),
    })

    cat.Type = await Category.new(10, {
        name        : "Type",
        info        : "Category of items that represent data types. Some of the items are wrappers around system types (STRING, INTEGER etc.), while some others implement new types by themselves using dynamic code.",
        class_path  : 'schemat/types/type_item.js:TypeItem',
        fields      : C({
            class_path  : new STRING(),
            encode      : new CODE({info: "Body of a function with the signature `encode(obj,props={})`. Should return a state that encodes the input object/value, `obj`."}),
            decode      : new CODE(),
            initial     : new GENERIC(),
            properties  : new CATALOG({values: new TYPE()}),
        }),
    })

    cat.Ring = await Category.new(11, {
        name        : "Ring",
        info        : "Base category for items that represent data rings (stackable database layers).",
        allow_custom_fields: true,          // temporary
    })

    // cat.STRING = await Category.new(12, {
    //     name        : "STRING",
    //     __extends   : cat.Type,
    //     class_path  : 'schemat/types/type.js:STRING',
    // })

    return cat
}

/**********************************************************************************************************************/

// async function create_items(cat, Category) {
//     let item = {}
//     // item.default_namespace = await cat.ID_Namespace.new(14, {name: "default namespace", info: "All objects accessible by their IDs."})
//     // item.dir_local  = await cat.LocalDirectory.new(12, {name: '/local', local_path: '.'})   //path.dirname(__dirname)
//     //
//     // item.dir_system = await cat.Directory.new(13, {name: "/$",
//     //     entries: C({
//     //         'object'        : item.default_namespace,
//     //         'local'         : item.dir_local,
//     //     }),
//     // })
//     return item
// }

/**********************************************************************************************************************
 **
 **  BOOTSTRAP
 **
 */

export async function bootstrap(db) {
    /* Create core items and store in DB. All existing items in DB are removed! */
    
    let Category = schemat.root_category
    let cats  = await create_categories(Category)               // create non-root categories & leaf items
    // let items = await create_items(cats, Category)

    // insert to DB and assign item IDs if missing
    for (let item of [Category, ...Object.values(cats)])        //...Object.values(items)
        await db.insert(item)

    // await db.insert_many(Category, ...Object.values(cats))
}

