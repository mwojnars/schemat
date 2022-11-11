/*
Creating core items from scratch and storing them as initial items in DB.
 */

import {print, assert, dedentCommon as dedent} from '../utils.js'
import {ROOT_CID, SITE_CID} from '../item.js'
import {ServerRegistry} from './registry-s.js'
import {GENERIC, SCHEMA, BOOLEAN, NUMBER, STRING, TEXT, CODE, ITEM, CATALOG, PATH} from '../type.js'
import {Catalog, Data} from '../data.js'
import {fileURLToPath} from 'url'
import path from "path";

const __filename = fileURLToPath(import.meta.url)       // or: process.argv[1]
const __dirname  = path.dirname(__filename)


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
    path        : new PATH({unique: true, info: "Canonical path of this item within the SUN, for: display, resolving relative code imports, resolving relative item references (REF type), etc. If `path` is configured, callers can only import this item's code through the `path`, so that the code is always interpreted the same and can be cached after parsing."}),
    info        : new TEXT({info: "Description of the item."}),
    prototype   : new ITEM({info: "An item of the same category that serves as a prototype for this one, that is, provides default values for missing properties of this item. " +
                                  "Multiple prototypes are allowed, the first one has priority over subsequent ones. Prototypes can be defined for regular items, as well as for categories - the latter case represents category inheritance. " +
                                  "Items/categories may inherit individual entries from catalog-valued fields, see Item.getInherited(). In this way, subcategories inherit individual field schemas as defined in base categories."}),
})

// fields inside a category instance, including the root category
let root_fields = C({
    class_path   : new STRING({info: "SUN path to a Javascript file that contains a (base) class for this category. May contain an optional class name appended after colon ':'. If the class name is missing (no colon), default import from the file is used."}),
    class_name   : new STRING({info: "Custom internal name for the Class of this category, for debugging. Also used as an alias when exporting the Class from the category's module."}),
    class_init   : new CODE({info: "Module-level initialization for this category's Javascript class. Typically contains import statements and global variables. Preceeds the Class definition (`class_body`, `views`) in the category's module code."}),
    class_body   : new CODE({info: "Source code of the class (a body without heading) that will be created for this category. The class inherits from the `class_path` class, or the class of the first base category, or the top-level Item."}),
    // pages        : new CATALOG({values: new CODE(), info: "Source code of React class components that render HTML response pages for particular URL endpoints of this category's items. Each entry in `pages` is a name of the endpoint + the body of a class component inheriting from the `Page` base class. NO class header or surrounding braces {...}, they are added automatically. Static attributes/methods are allowed."}),
    pages        : new CATALOG({values: new CODE(), info: "Source code of functions that generate static HTML response for particular access methods of this category's items."}),
    handlers     : new CATALOG({values: new CODE(), info: "Body of Handler subclasses that generate HTML response for particular access methods of this category's items."}),
    views        : new CATALOG({values: new CODE(), info: "Body of React functional components (no function header) to be added dynamically to the category's Class body as VIEW_name(props) methods for rendering item views. Inside the function body, `this` refers the item to be rendered. Alternatively, the code of each view may consist of a method header, view() {...}, and be accompanied by supporting methods: title(), assets() - like in a class body."}),
    // module    : new CODE({info: "Source code of a Javascript module to be created for this category. May contain imports. Should export a Class that defines the class to be used by items of this category. Alternatively, the Class'es body can be defined through the `class_body` and/or `views` properties."}),
    // code_client  : new CODE({info: "Source code appended to the body of this category's class when the category is loaded on a client (exclusively)."}),
    // code_server  : new CODE({info: "Source code appended to the body of this category's class when the category is loaded on a server (exclusively)."}),

    html_assets  : new CODE({info: "HTML code to be inserted in the html/head section of every page that is rendered from a view function of this category."}),

    cache_ttl    : new NUMBER({default: 5.0, info: "Time To Live (TTL). Determines for how long (in seconds) an item of this category is kept in a server-side cache after being loaded from DB, for reuse by subsequent requests. A real number. If zero, the items are evicted immediately after each request."}),
    cached_methods:new STRING({info: "Space- and/or comma-separated list of method names of this category's Class whose calls are to be cached via Item.setCaching(). Only used when a custom subclass is created through the `class_body` or `views` properties."}),
    fields       : new CATALOG({values: new SCHEMA(), info: "Fields must have unique names.", default: default_fields}),

    // _boot_class  : new STRING({info: "Name of a core Javascript class, subclass of Item, to be used for items of this category. If `class_body` is configured, the class is subclassed dynamically to insert the desired code. Should only be used for core Schemat categories."}),

    //custom_class : new BOOLEAN({info: "If true in a category, items of this category are allowed to provide their own `class_body` and `code*` implementations.", default: false}),
    //handlers     : new CATALOG({values: new CODE(), info: "Methods for server-side handling of web requests."}),

    //indexes    : new CATALOG({values: new ITEM(Index)}),

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

let root_data = new Data({
    name        : "Category",
    info        : "Category of items that represent categories",
    class_path  : '/system/local/item.js:Category',
    // _boot_class : 'schemat.item.Category',      //  '/system/item.js/Category'
    cache_ttl   : 60.0,
    fields      : root_fields,  //{...default_fields, ...root_fields},
})

/**********************************************************************************************************************
 **
 **  CATEGORIES & ITEMS
 **
 */

async function create_categories(Category) {

    let cat = {}
    assert(SITE_CID === 1)

    cat.Site = await Category.new(SITE_CID, {
        name        : "Site",
        info        : "Top-level URL routing + global configuration of applications, servers, startup.",
        class_path  : '/system/local/site.js:Site',
        // _boot_class : 'schemat.item.Site',
        // prototype   : cat.Router,
        fields      : C({
            URL             : new STRING({info: "Base URL at which the website is served: protocol + domain + root path (if any); no trailing '/'."}),
            path_internal   : new PATH({info: "URL route of an internal application for default/admin web access to items. The application should handle all items."}),
            routes          : new CATALOG({values: new ITEM(), info: "URL prefixes (as keys) mapped to items that shall perform routing of requests whose URLs start with a given prefix. NO leading/trailing slashes."}),
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
            routes      : new CATALOG({values: new ITEM()}),
        }),
        class_path  : '/system/local/site.js:Router',
        // _boot_class : 'schemat.item.Router',
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

    cat.File = await Category.new(3, {
        name        : "File",
        info        : "File with a text content.",
        class_path  : '/system/local/site.js:File',
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
        prototype   : cat.File,
        class_path  : '/system/local/site.js:FileLocal',
        // _boot_class : 'schemat.item.FileLocal',
        fields      : C({
            path    : new STRING(),             // path to a local file on disk
            //format: new STRING(),             // file format: pdf, xlsx, ...
        }),
    })
    cat.Folder = await Category.new(5, {
        name        : "Folder",
        info        : "A directory of files, each file has a unique name (path). May contain nested directories.",
        class_path  : '/system/local/site.js:Folder',
        // _boot_class : 'schemat.item.Folder',
        fields      : C({
            files       : new CATALOG({values: new ITEM()}),          // file & directory names mapped to item IDs
            _is_folder  : new BOOLEAN({default: true}),
        }),
    })
    cat.FolderLocal = await Category.new(6, {
        name        : "FolderLocal",
        info        : "File folder located on a local disk, identified by its local file path.\nGives access to all files and folders beneath the path.",
        prototype   : cat.Folder,
        class_path  : '/system/local/site.js:FolderLocal',
        // _boot_class : 'schemat.item.FolderLocal',
        fields      : C({path: new STRING()}),
    })

    cat.Application = await Category.new(7, {
        name        : "Application",
        info        : "Category of application records. An application groups all spaces & categories available in the system and provides system-level configuration.",
        class_path  : '/system/local/site.js:Application',
        // fields      : C({findRoute: new CODE(), urlPath: new CODE(), _boot_class: new STRING()}),
        // custom_class: true,
    })
    cat.AppBasic = await Category.new(8, {
        name        : "AppBasic",
        info        : "Application that serves items on simple URLs of the form /CID:IID. Mainly used for system & admin purposes, or as a last-resort default for URL generation.",
        class_path  : '/system/local/site.js:AppBasic',
        fields      : C({
            category    : new ITEM({category: Category, info: "Optional category(ies) of items handled by this application."}),
            drop_cid    : new BOOLEAN({info: "If true, CID is excluded from URL paths. Requires that a single `category` is declared for the application; and implies that only the exact instances (no inheritance) of this category are handled (otherwise, instances of subclasses are handled, too)."}),
        }),
    })
    cat.AppSpaces = await Category.new(9, {
        name        : "AppSpaces",
        info        : "Application for accessing public data through verbose paths of the form: .../SPACE:IID, where SPACE is a text identifier assigned to a category in `spaces` property.",
        class_path  : '/system/local/site.js:AppSpaces',
        fields      : C({spaces: new CATALOG({values: new ITEM({category: Category})})}),
        cached_methods: "spacesRev",
    })

    cat.Schema = await Category.new(10, {
        name        : "Schema",
        info        : "Category of items that represent schema types. Some of the items are wrappers around system types (STRING, INTEGER etc.), while some others implement new schema types by themselves using dynamic code.",
        class_path  : '/system/local/type.js:SchemaPrototype',
        fields      : C({
            class_path  : new STRING(),
            encode      : new CODE({info: "Body of a function with the signature `encode(obj,props={})`. Should return a state that encodes the input object/value, `obj`."}),
            decode      : new CODE(),
            initial     : new GENERIC(),
            properties  : new CATALOG({values: new SCHEMA()}),
        }),
    })

    cat.Database = await Category.new(11, {
        name        : "Database",
        info        : "Base category for items that represent an abstract database layer.",
    })

    // cat.STRING = await Category.new(12, {
    //     name        : "STRING",
    //     prototype   : cat.Schema,
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
    // item.database = await cat.DatabaseYaml.new({filename: '/home/marcin/Documents/priv/catalog/src/schemat/server/db.yaml'})

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

    // let path_local = "/home/marcin/Documents/priv/catalog/src/schemat"
    item.dir_local  = await cat.FolderLocal.new({name: '/local', path: '.'})   //path.dirname(__dirname)

    item.dir_system = await cat.Folder.new({name: "/system",
        files: C({
            'local'         : item.dir_local,
            'Application'   : cat.Application,
            'File'          : cat.File,
            'Folder'        : cat.Folder,
            'Site'          : cat.Site,
        }),
    })

    // item.STRING = await cat.Schema.new({
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
    // let path_local = "/home/marcin/Documents/priv/catalog/src/schemat"
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

export async function bootstrap(registry) {
    /* Create core items and store in DB. All existing items in DB are removed! */
    
    let db = registry.db
    print(`Starting full RESET of DB, core items will be created anew in: ${db.filename}`)

    let Category = await registry.createRoot(root_data)             // create root category
    let cats  = await create_categories(Category)                   // create non-root categories & leaf items
    let items = await create_items(cats, Category)

    // insert to DB and assign IIDs if missing;
    // plain db.insert() is used instead of insertMany() for better control over the order of items
    // in the output file - insertMany() outputs no-IID items first
    for (let item of [Category, ...Object.values(cats), ...Object.values(items)])
        await db.insert(item, {flush: false})
    await db.flush()
}

