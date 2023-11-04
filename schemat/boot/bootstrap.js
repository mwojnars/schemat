/*
Creating core items from scratch and storing them as initial items in DB.
 */

import {print, assert} from '../utils.js'
import {SITE_CATEGORY_ID} from '../item.js'
import {GENERIC, TYPE, BOOLEAN, NUMBER, STRING, TEXT, CODE, ITEM, CATALOG, PATH} from '../type.js'
import {Catalog} from "../data.js"

// import {fileURLToPath} from 'url'
// import path from "path"

// const __filename = fileURLToPath(import.meta.url)       // or: process.argv[1]
// const __dirname  = path.dirname(__filename)

// conversion of a dict to a Catalog
export let C = (...data) => new Catalog(...data)


/**********************************************************************************************************************
 **
 **  CATEGORIES & ITEMS
 **
 */

async function create_categories(Category) {

    let cat = {}
    assert(SITE_CATEGORY_ID === 1)

    cat.Site = await Category.new(SITE_CATEGORY_ID, {
        name        : "Site",
        info        : "Top-level URL routing + global configuration of applications, servers, startup.",
        class_path  : '/system/local/std/site.js:Site',
        // _boot_class : 'schemat.item.Site',
        // _extends_   : cat.Router,
        fields      : C({
            URL             : new STRING({info: "Base URL at which the website is served: protocol + domain + root path (if any); no trailing '/'."}),
            path_internal   : new PATH({info: "URL route of an internal application for default/admin web access to items. The application should handle all items."}),
            routes          : new CATALOG({values: new ITEM(), repeated: true, info: "URL prefixes (as keys) mapped to items that shall perform routing of requests whose URLs start with a given prefix. NO leading/trailing slashes."}),
            //path_local    : new PATH({info: "URL route of a FolderLocal that maps to the root folder of the Schemat's local installation."}),
            //route_default: new ITEM({info: "URL route anchored at the site root, i.e., having empty URL prefix. If there are multiple `route_default` entries, they are being tried in the order of listing in the site's configuration, until a route is found that does NOT raise the Request.NotFound."}),
            //router      : new ITEM({info: "Router that performs top-level URL routing to downstream applications and file folders."}),
            //database    : new ITEM({category: cat.Database, info: "Global database layer"}),
        }),
    })

    cat.Router  = await Category.new(2, {
        name        : "Router",
        info        : "A set of sub-applications or sub-folders, each bound to a different URL prefix.",
        fields      : C({
            // empty_path  : new ITEM({info: "An item to handle the request if the URL path is empty."}),
            routes      : new CATALOG({values: new ITEM(), repeated: true}),
        }),
        class_path  : '/system/local/std/site.js:Router',
        // _boot_class : 'schemat.item.Router',
        // code        : dedent(`
        //                 findRoute(request) {
        //                     let step   = request.step()
        //                     let routes = this.prop('routes')
        //                     let route  = routes.get(step)
        //                     if (step && route)  return [route, request.move(step)]
        //                     if (routes.has('')) return [routes.get(''), request]          // default (unnamed) route
        //                 }
        //             `),
    })

    cat.File = await Category.new(3, {
        name        : "File",
        info        : "File with a text content.",
        class_path  : '/system/local/std/files.js:File',
        // _boot_class : 'schemat.item.File',
        cached_methods: "read",
        fields      : C({
            content     : new CODE(),      // VARIANT(bin : BYTES(), txt : TEXT()),
            mimetype    : new STRING({info: "MIME type string (must include '/') to be set as Content-Type when serving file download; or an extension ('js', 'jpg', ...) to be converted to an appropriate type. If missing, response mimetype is inferred from the URL path extension, if present."}),
            format      : new STRING(),    // ProgrammingLanguage()
            _is_file    : new BOOLEAN({default: true}),
        }),
    })
    cat.FileLocal = await Category.new(4, {
        name        : "FileLocal",
        info        : "File located on a local disk, identified by its local file path.",
        _extends_   : cat.File,
        class_path  : '/system/local/std/files.js:FileLocal',
        // _boot_class : 'schemat.item.FileLocal',
        fields      : C({
            local_path : new STRING(),          // path to a local file on disk
            //format: new STRING(),             // file format: pdf, xlsx, ...
        }),
    })
    cat.Folder = await Category.new(5, {
        name        : "Folder",
        info        : "A directory of files, each file has a unique name (path). May contain nested directories.",
        class_path  : '/system/local/std/files.js:Folder',
        // _boot_class : 'schemat.item.Folder',
        fields      : C({
            files       : new CATALOG({values: new ITEM()}),          // file & directory names mapped to item IDs
            _is_folder  : new BOOLEAN({default: true}),
        }),
    })
    cat.FolderLocal = await Category.new(6, {
        name        : "FolderLocal",
        info        : "File folder located on a local disk, identified by its local file path.\nGives access to all files and folders beneath the path.",
        _extends_   : cat.Folder,
        class_path  : '/system/local/std/files.js:FolderLocal',
        // _boot_class : 'schemat.item.FolderLocal',
        fields      : C({local_path: new STRING()}),
    })

    cat.Application = await Category.new(7, {
        name        : "Application",
        info        : "Category of application records. An application groups all spaces & categories available in the system and provides system-level configuration.",
        class_path  : '/system/local/std/apps.js:Application',
        // fields      : C({findRoute: new CODE(), urlPath: new CODE(), _boot_class: new STRING()}),
        // custom_class: true,
    })
    cat.AppBasic = await Category.new(8, {
        name        : "AppBasic",
        info        : "Application that serves items on simple URLs of the form /IID. Mainly used for system & admin purposes, or as a last-resort default for URL generation.",
        class_path  : '/system/local/std/apps.js:AppBasic',
        fields      : C({
            category    : new ITEM({category: Category, info: "Optional category(ies) of items handled by this application."}),
        }),
    })
    cat.AppSpaces = await Category.new(9, {
        name        : "AppSpaces",
        info        : "Application for accessing public data through verbose paths of the form: .../SPACE:IID, where SPACE is a text identifier assigned to a category in `spaces` property.",
        class_path  : '/system/local/std/apps.js:AppSpaces',
        fields      : C({spaces: new CATALOG({values: new ITEM({category: Category})})}),
        cached_methods: "spacesRev",
    })

    cat.Type = await Category.new(10, {
        name        : "Type",
        info        : "Category of items that represent data types. Some of the items are wrappers around system types (STRING, INTEGER etc.), while some others implement new types by themselves using dynamic code.",
        class_path  : '/system/local/type_item.js:TypeItem',
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
    //     _extends_   : cat.Type,
    //     class_path  : '/system/local/type.js:STRING',
    // })

    return cat
}

/**********************************************************************************************************************/

async function create_items(cat, Category) {
    let item = {}

    // item.test_txt = await cat.File.new({content: "This is a test file."})
    // item.dir_tmp1 = await cat.Folder.new({files: C({'test.txt': item.test_txt})})
    // item.dir_tmp2 = await cat.Folder.new({files: C({'tmp1': item.dir_tmp1})})

    // item.app_system = await cat.Application.new({
    //     name: "AppBasic",
    //     info: "Application that serves items on simple URLs of the form /CID:IID. Mainly used for system & admin purposes, or as a last-resort default for URL generation.",
    //
    //     findRoute: dedent(`
    //         let step = request.step(), id
    //         try { id = step.split(':').map(Number) }
    //         catch (ex) { request.throwNotFound() }
    //         request.setDefaultMethod('@full')
    //         return [this.registry.getItem(id), request.move(step), true]
    //     `),
    //     urlPath: dedent(`
    //         console.log('AppBasic.urlPath()')
    //         let [cid, iid] = item.id
    //         return cid + ':' + iid
    //     `),
    // })
    // item.app_spaces = await cat.Application.new({
    //     name        : "AppSpaces",
    //     info        : "Application for accessing public data through verbose paths of the form: .../SPACE:IID, where SPACE is a text identifier assigned to a category in `spaces` property.",
    //     class       : 'schemat.item.AppSpaces',
    //     // fields      : C({spaces: new CATALOG({values: new ITEM({type_exact: Category})})}),
    // })

    item.dir_local  = await cat.FolderLocal.new({name: '/local', local_path: '.'})   //path.dirname(__dirname)

    item.dir_system = await cat.Folder.new({name: "/system",
        files: C({
            'local'         : item.dir_local,
            'Application'   : cat.Application,
            'File'          : cat.File,
            'Folder'        : cat.Folder,
            'Site'          : cat.Site,
        }),
    })

    // item.STRING = await cat.Type.new({
    //     name            : "STRING",
    //     class_path      : "/system/local/type.js:STRING",
    // })

    // item.utils_js   = await cat.File.new({content: `export let print = console.log`})
    // item.widgets_js = await cat.File.new({content: dedent(`
    //         import {print} from '../site/utils.js'
    //         export function check() { print('called /site/widgets.js/check()') }
    //         //let fs = await importLocal('fs')
    //         //print('fs:',fs)
    //     `)
    // })
    //
    // item.dir_demo   = await cat.Folder.new({name: "/demo", })
    // item.dir_apps   = await cat.Folder.new({name: "/apps", files: C({'demo': item.dir_demo})})
    // item.dir_site   = await cat.Folder.new({name: "/site",
    //     files: C({
    //         'utils.js':     item.utils_js,
    //         'widgets.js':   item.widgets_js,
    //     })
    // })
    //
    // // path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    // item.dir_local = await cat.FolderLocal.new({name: '/local', path: `${path_local}`})
    // item.dir_files = await cat.Folder.new({name: "/files",
    //     files: C({
    //         'apps':     item.dir_apps,
    //         'local':    item.dir_local,
    //         'site':     item.dir_site,
    //         'system':   item.dir_system,
    //     })
    // })
    //
    // item.app_system  = await cat.AppBasic.new({name: "/$",})
    // item.app_catalog = await cat.AppSpaces.new({name: "Catalog",
    //     spaces: C({
    //         'sys.category':     Category,
    //         'sys.site':         cat.Site,
    //         'sys.dir':          cat.Folder,
    //         'sys.file':         cat.File,
    //     }),
    // })

    // item.router = await cat.Router.new({name: "Router",
    //     routes: C({
    //         'files':    item.dir_files,
    //         '$':        item.app_system,
    //         '':         item.app_catalog,        // default route
    //     }),
    // })
    
    // item.catalog_wiki = await cat.Site.new({
    //     name        : "catalog_site",
    //     URL         : "http://127.0.0.1:3000",
    //     path_internal : "/$",
    //     router      : item.router,
    //     // database    : item.database,
    // })
    
    // item.item_002.push('name', "test_item")
    // item.item_002.push('name', "duplicate")

    return item
}

/**********************************************************************************************************************
 **
 **  BOOTSTRAP
 **
 */

export async function bootstrap(db) {
    /* Create core items and store in DB. All existing items in DB are removed! */
    
    let Category = registry.root
    let cats  = await create_categories(Category)               // create non-root categories & leaf items
    let items = await create_items(cats, Category)

    // insert to DB and assign item IDs if missing
    for (let item of [Category, ...Object.values(cats), ...Object.values(items)])
        await db.insert(item)

    // await db.insert_many(Category, ...Object.values(cats), ...Object.values(items))
}

