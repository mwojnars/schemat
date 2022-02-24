/*
Creating core items from scratch and storing them as initial items in DB.
 */

import {print, assert, dedentCommon as dedent} from '../utils.js'
import {ROOT_CID, SITE_CID} from '../item.js'
import {ServerRegistry} from './registry-s.js'
import {GENERIC, SCHEMA, BOOLEAN, NUMBER, STRING, TEXT, CODE, ITEM, CATALOG, FILENAME} from '../type.js'
import {Catalog} from '../data.js'
import {YamlDB} from "./db.js";


/**********************************************************************************************************************
 **
 **  SCHEMA of ROOT
 **
 */

// conversion of a dict to a Catalog
let C = (data) => new Catalog(data)

// global-default fields shared by all item types
let default_fields = C({
    name        : new STRING({info: "Display name of the item. May contain spaces, punctuation, non-latin characters."}),
    info        : new TEXT({info: "Internal description of the item."}),
    prototype   : new ITEM({info: "An item of the same category that serves as a prototype for this one, that is, provides default values for missing properties of this item. " +
                                  "Multiple prototypes are allowed, the first one has priority over subsequent ones. Prototypes can be defined for regular items, as well as for categories - the latter case represents category inheritance. " +
                                  "Items/categories may inherit individual entries from catalog-valued fields, see Item.getInherited(). In this way, subcategories inherit individual field schemas as defined in base categories."}),
})

// fields of categories, including the root category
let root_fields = C({
    class        : new STRING({info: "Full (dotted) name of a Javascript class to be used for items of this category. If `code` or `code_*` is configured, the class is subclassed dynamically to insert the desired code."}),
    code         : new CODE({info: "Source code of a subclass (a body without heading) that will be created for this category. The subclass inherits from the `class`, or the class of the first base category, or the top-level Item."}),
    code_client  : new CODE({info: "Source code appended to the body of this category's class when the category is loaded on a client (exclusively)."}),
    code_server  : new CODE({info: "Source code appended to the body of this category's class when the category is loaded on a server (exclusively)."}),

    cache_ttl    : new NUMBER({default: 5.0, info: "Time To Live (TTL). Determines for how long (in seconds) an item of this category is kept in a server-side cache after being loaded from DB, for reuse by subsequent requests. A real number. If zero, the items are evicted immediately after each request."}),
    fields       : new CATALOG(new SCHEMA(), null, {info: "Fields must have unique names.", default: default_fields}),

    //custom_class : new BOOLEAN({info: "If true in a category, items of this category are allowed to provide their own `class` and `code*` implementations.", default: false}),
    //handlers     : new CATALOG(new CODE(), null, {info: "Methods for server-side handling of web requests."}),

    //indexes    : new CATALOG(new ITEM(Index)),

    //custom_fields : BOOLEAN(default : False, info : "If true, it is allowed to use undefined (out-of-schema) fields in items - their schema is GENERIC()")

    //summary_idx : STRING(),    // name of index that should be used for loading core props: name, title, ... of the item
                                // - these props are needed to generate "simple links" to this item on "edit" tabs of other items,
                                // and generate "summary" of this item when referenced in other items' "view" tabs
                                // without loading full item data from the main table (is it worth to keep an index for this??);
                                // this index is used for *outgoing* references only; *incoming* references are loaded
                                // through indexes of corresponding child relations

    //ttl_client  : INTEGER(),   // for how long to keep items of this category in cache, client side (in browser's localStorage)
    //ttl_server  : INTEGER(),   // for how long to keep items of this category in cache, server side

    //immutable   : BOOLEAN()    // if True, items can't be modified after creation; e.g., Revision items, event logs etc.
    //metadata ...               // what metadata to record for items: checksum, version, created, updated ...
    //versioning  : BOOLEAN()    // if True, `version` number is stored in metadata and is increased on every update
    //version_by  : STRING()     // name of an item's INTEGER field that should keep version number (if versioning is ON)

    //revisions   : BOOLEAN()    // if True, a revision item is created on every update of an item of this category
    //revisions_config : RECORD  // config of revisions: retention period (dflt: infinite), ...

    //tombstone                  // if True, item is left with "tombstone" status after delete

    //iid_interlace, iid_gaps    // (freq) how often to leave a gap in IID autoincrement when inserting items

    //push_item_updates : BOOLEAN(),     // if True, updates to items of this category are broadcasted to all servers in a cluster;
                                        // should only be used for categories with few, rarely-updated items, like the root category
    //live_upgrade_intensity : FLOAT(),  // likelihood (0.0-1.0) that an edge server should write back an upgraded item
                                        // that referred to an outdated revision of its category (esp. schema), instead of
                                        // leaving this upgrade-write for a background process; typically ~0.01
})

let root_data = {
    name        : "Category",
    info        : "Category of items that represent categories",
    class       : 'schemat.item.Category',      //  '/system/item.js/Category'
    cache_ttl   : 60.0,
    fields      : root_fields,
}

/**********************************************************************************************************************
 **
 **  CATEGORIES & ITEMS
 **
 */

async function create_categories(Category) {

    let cat = {}
    assert(SITE_CID === 1)

    cat.Site = Category.new(1, {
        name        : "Site",
        info        : "Top-level URL routing + global configuration of applications, servers, startup.",
        class       : 'schemat.item.Site',
        // prototype   : cat.Router,
        fields      : C({
            URL             : new STRING({info: "Base URL at which the website is served: protocol + domain + root path (if any); no trailing '/'."}),
            path_filesystem : new STRING({info: "URL path of the root folder of this site's file system."}),
            path_internal   : new STRING({info: "URL path of an internal application for default/admin web access to items. The application should handle all items."}),
            routes          : new CATALOG(new ITEM()),
            //router      : new ITEM({info: "Router that performs top-level URL routing to downstream applications and file folders."}),
            //database    : new ITEM({type: cat.Database, info: "Global database layer"}),
        }),
    })

    cat.Router  = Category.new(2, {
        name        : "Router",
        info        : "A set of sub-applications or sub-folders, each bound to a different URL prefix.",
        fields      : C({
            // empty_path  : new ITEM({info: "An item to handle the request if the URL path is empty."}),
            routes      : new CATALOG(new ITEM()),
        }),
        class  : 'schemat.item.Router',
        // code        : dedent(`
        //                 findRoute(request) {
        //                     let step   = request.step()
        //                     let routes = this.get('routes')
        //                     let route  = routes.get(step)
        //                     if (step && route)  return [route, request.move(step)]
        //                     if (routes.has('')) return [routes.get(''), request]          // default (unnamed) route
        //                 }
        //             `),
    })
    // cat.Database = Category.new({
    //     name        : "Database",
    //     info        : "Base category for items that represent an abstract database layer.",
    // })
    // cat.DatabaseYaml = Category.new({
    //     name        : "YAML Database",
    //     info        : "Single-machine database stored in a YAML file.",
    //     class       : 'schemat.item.DatabaseYaml',
    //     prototype   : cat.Database,
    //     fields      : C({
    //         filename: new STRING(),
    //     }),
    // })

    cat.File = Category.new({
        name        : "File",
        info        : "File with a text content.",
        class       : 'schemat.item.File',
        fields      : C({
            content     : new CODE(),      // VARIANT(bin : BYTES(), txt : TEXT()),
            mimetype    : new STRING({info: "MIME type string (must include '/') to be set as Content-Type when serving file download; or an extension ('js', 'jpg', ...) to be converted to an appropriate type. If missing, response mimetype is inferred from a URL path extension, if any."}),
            format      : new STRING(),    // ProgrammingLanguage()
            _is_file    : new BOOLEAN({default: true}),
        }),
    })
    cat.FileLocal = Category.new({
        name        : "FileLocal",
        info        : "File located on a local disk, identified by its local file path.",
        prototype   : cat.File,
        class       : 'schemat.item.FileLocal',
        fields      : C({
            path    : new STRING(),             // path to a local file on disk
            //format: new STRING(),             // file format: pdf, xlsx, ...
        }),
    })
    cat.Folder = Category.new({
        name        : "Folder",
        info        : "A directory of files, each file has a unique name (path). May contain nested directories.",
        class       : 'schemat.item.Folder',
        fields      : C({
            files       : new CATALOG(new ITEM(), new FILENAME()),     // file & directory names mapped to item IDs
            _is_folder  : new BOOLEAN({default: true}),
        }),
    })
    cat.FolderLocal = Category.new({
        name        : "FolderLocal",
        info        : "File folder located on a local disk, identified by its local file path.\nGives access to all files and folders beneath the path.",
        prototype   : cat.Folder,
        class       : 'schemat.item.FolderLocal',
        fields      : C({path: new STRING()}),
    })

    cat.Application = Category.new({
        name        : "Application",
        info        : "Category of application records. An application groups all spaces & categories available in the system and provides system-level configuration.",
        class       : 'schemat.item.Application',
        fields      : C({findRoute: new CODE(), urlPath: new CODE(), class: new STRING()}),
        // custom_class: true,
    })
    cat.AppBasic = Category.new({
        name        : "AppBasic",
        info        : "Application that serves items on simple URLs of the form /CID:IID. Mainly used for system & admin purposes, or as a last-resort default for URL generation.",
        class       : 'schemat.item.AppBasic',
        fields      : C({
            category    : new ITEM({type: Category, info: "Optional category(ies) of items handled by this application."}),
            drop_cid    : new BOOLEAN({info: "If true, CID is excluded from URL paths. Requires that a single `category` is declared for the application; and implies that only the exact instances (no inheritance) of this category are handled (otherwise, instances of subclasses are handled, too)."}),
        }),
    })
    cat.AppSpaces = Category.new({
        name        : "AppSpaces",
        info        : "Application for accessing public data through verbose paths of the form: .../SPACE:IID, where SPACE is a text identifier assigned to a category in `spaces` property.",
        class       : 'schemat.item.AppSpaces',
        fields      : C({spaces: new CATALOG(new ITEM({type: Category}))}),
    })

    return cat
}

/**********************************************************************************************************************/

async function create_items(cat, Category) {
    let item = {}
    
    // item.test_txt = cat.File.new({content: "This is a test file."})
    // item.dir_tmp1 = cat.Folder.new({files: C({'test.txt': item.test_txt})})
    // item.dir_tmp2 = cat.Folder.new({files: C({'tmp1': item.dir_tmp1})})
    // item.database = cat.DatabaseYaml.new({filename: '/home/marcin/Documents/priv/catalog/src/schemat/server/db.yaml'})

    // item.app_system = cat.Application.new({
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
    // item.app_spaces = cat.Application.new({
    //     name        : "AppSpaces",
    //     info        : "Application for accessing public data through verbose paths of the form: .../SPACE:IID, where SPACE is a text identifier assigned to a category in `spaces` property.",
    //     class       : 'schemat.item.AppSpaces',
    //     // fields      : C({spaces: new CATALOG(new ITEM({type_exact: Category}))}),
    // })

    item.dir_system = cat.Folder.new({name: "/system",
        files: C({
            'Application'   : cat.Application,
            'File'          : cat.File,
            'Folder'        : cat.Folder,
            'Site'          : cat.Site,
        }),
    })

    // item.utils_js   = cat.File.new({content: `export let print = console.log`})
    // item.widgets_js = cat.File.new({content: dedent(`
    //         import {print} from '../site/utils.js'
    //         export function check() { print('called /site/widgets.js/check()') }
    //         //let fs = await importLocal('fs')
    //         //print('fs:',fs)
    //     `)
    // })
    //
    // item.dir_demo   = cat.Folder.new({name: "/demo", })
    // item.dir_apps   = cat.Folder.new({name: "/apps", files: C({'demo': item.dir_demo})})
    // item.dir_site   = cat.Folder.new({name: "/site",
    //     files: C({
    //         'utils.js':     item.utils_js,
    //         'widgets.js':   item.widgets_js,
    //     })
    // })
    //
    // // path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    // let path_local = "/home/marcin/Documents/priv/catalog/src/schemat"
    // item.dir_local = cat.FolderLocal.new({name: '/local', path: `${path_local}`})
    // item.dir_files = cat.Folder.new({name: "/files",
    //     files: C({
    //         'apps':     item.dir_apps,
    //         'local':    item.dir_local,
    //         'site':     item.dir_site,
    //         'system':   item.dir_system,
    //     })
    // })
    //
    // item.app_system  = cat.AppBasic.new({name: "/$",})
    // item.app_catalog = cat.AppSpaces.new({name: "Catalog",
    //     spaces: C({
    //         'sys.category':     Category,
    //         'sys.site':         cat.Site,
    //         'sys.dir':          cat.Folder,
    //         'sys.file':         cat.File,
    //     }),
    // })

    // item.router = cat.Router.new({name: "Router",
    //     routes: C({
    //         'files':    item.dir_files,
    //         '$':        item.app_system,
    //         '':         item.app_catalog,        // default route
    //     }),
    // })
    
    // item.catalog_wiki = cat.Site.new({
    //     name        : "catalog.wiki",
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

async function bootstrap(dbPath) {
    /* Create core items and store in DB. All existing items in DB are removed! */
    
    print(`Starting full RESET of DB, core items will be created anew in: ${dbPath}`)

    let db = new YamlDB(dbPath)
    let registry = globalThis.registry = new ServerRegistry(db)
    await registry.initClasspath()

    let Category = await registry.createRoot(root_data)             // create root category
    let cats  = await create_categories(Category)                   // create non-root categories & leaf items
    let items = await create_items(cats, Category)

    // insert to DB and assign IIDs if missing
    await registry.db.insert(Category, ...Object.values(cats), ...Object.values(items))

    // // insert all items to DB; the insertion order is important: if item A is referenced by item B,
    // // the A must be inserted first so that its ID is available before B gets inserted
    // await registry.commit()                             // insert items to DB and assign an ID to each of them

    // // make sure the CID/IID numbers of the Site category and the root Category are compatible with global constants
    // assert(Category.cid === ROOT_CID && Category.iid === ROOT_CID)
    // assert(cats.Site.iid === SITE_CID)
}

/**********************************************************************************************************************/

// 'db-boot.yaml' file must be manually renamed to 'db.yaml' after creation (!)
await bootstrap('/home/marcin/Documents/priv/catalog/src/schemat/server/db-boot.yaml')

