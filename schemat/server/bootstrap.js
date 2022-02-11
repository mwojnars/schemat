/*
Creating core items from scratch and storing them as initial items in DB.
 */

import {print} from '../utils.js'
import {ServerRegistry} from './registry-s.js'
import {GENERIC, SCHEMA, BOOLEAN, NUMBER, STRING, TEXT, CODE, ITEM, CATALOG, FILENAME} from '../type.js'
import {Catalog} from '../data.js'
//import {Index} from '../item.js'


/**********************************************************************************************************************
 **
 **  SCHEMA of ROOT
 **
 */

// conversion of a dict to a Catalog
let C = (data) => new Catalog(data)

// fields of categories, including the root category
let root_fields = C({
    name         : new STRING({info: "human-readable title of the category"}),
    info         : new TEXT(),
    startup_site : new GENERIC(),
    base_category: new ITEM({info: "Base category from which this one inherits properties. Multiple bases are allowed, the first one has priority over subsequent ones."}),
    class_name   : new STRING({default: 'schemat.item.Item', info: "Full (dotted) path of a JS class."}),
    class_body   : new CODE({info: "Body of a subclass that will be created for this category. The subclass will inherit from the class of the first `base_category`, or from the top-level Item class."}),
    handlers     : new CATALOG(new CODE(), null, {info: "Methods for server-side handling of web requests."}),
    fields       : new CATALOG(new SCHEMA(), null, {info: "Fields must have unique names."}),

    cache_ttl    : new NUMBER({default: 5.0, info: "Time To Live (TTL). Determines for how long (in seconds) an item of this category is kept in a server-side cache after being loaded from DB, for reuse by subsequent requests. A real number. If zero, the items are evicted immediately after each request."})

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
    class_name  : 'schemat.item.Category',
    cache_ttl   : 60.0,
    fields      : root_fields,
}

/**********************************************************************************************************************
 **
 **  CATEGORIES & ITEMS
 **
 */

async function create_categories(Category) {
    let cat = {
        get Category()  { throw new Error('Category is NOT in `cat` object, use Category variable instead') }   // for debugging
    }

    cat.Database = Category.new({
        name        : "Database",
        info        : "Base category for items that represent an abstract database layer.",
    })
    cat.DatabaseYaml = Category.new({
        name        : "YAML Database",
        info        : "Single-machine database stored in a YAML file.",
        class_name  : 'schemat.item.DatabaseYaml',
        base_category: cat.Database,
        fields      : C({
            filename: new STRING(),
        }),
    })

    cat.File = Category.new({
        name        : "File",
        info        : "File with a text content. Accessible through the web filesystem.",
        class_name  : 'schemat.item.File',
        fields      : C({
            format      : new STRING(),    // ProgrammingLanguage()
            content     : new CODE(),      // VARIANT(bin : BYTES(), txt : TEXT()),
            _is_file    : new BOOLEAN({default: true}),
        }),
        handlers    : C({
            download    : `return this.read()   // full content of this File returned as plain text`,
// `async function() {
//     /* Return full content of this File as plain text. */
//     return this.read()
// }`,
        })
    })
    cat.FileLocal = Category.new({
        name        : "FileLocal",
        info        : "File located on a local disk, identified by its local file path.",
        base_category: cat.File,
        class_name  : 'schemat.item.FileLocal',
        fields      : C({
            path    : new STRING(),             // path to a local file on disk
            //format: new STRING(),             // file format: pdf, xlsx, ...
        }),
    })
    cat.Folder = Category.new({
        name        : "Folder",
        info        : "A directory of files, each file has a unique name (path). May contain nested directories.",
        class_name  : 'schemat.item.Folder',
        fields      : C({
            files       : new CATALOG(new ITEM(), new FILENAME()),     // file & directory names mapped to item IDs
            _is_folder  : new BOOLEAN({default: true}),
        }),
    })
    cat.FolderLocal = Category.new({
        name        : "FolderLocal",
        info        : "File folder located on a local disk, identified by its local file path.\nGives access to all files and folders beneath the path.",
        base_category: cat.Folder,
        class_name  : 'schemat.item.FolderLocal',
        fields      : C({path: new STRING()}),
    })

    cat.Application = Category.new({
        name        : "Application",
        info        : "Category of application records. An application groups all spaces & categories available in the system and provides system-level configuration.",
        class_name  : 'schemat.item.Application',
        fields      : C({name: new STRING()}),
        // folder   : FILEPATH(),       // path to a folder in the site's directory where this application was installed;
                                        // if the app needs to store data items in the directory, it's recommended
                                        // to do this inside a .../data subfolder
    })
    cat.AppRoot  = Category.new({
        name        : "AppRoot",
        info        : "A set of sub-applications, each bound to a different URL prefix.",
        class_name  : 'schemat.item.AppRoot',
        base_category: cat.Application,
        fields      : C({name: new STRING(), apps: new CATALOG(new ITEM())}),  // TODO: restrict apps to sub-categories of Application_ (?)
    })
    cat.AppSystem = Category.new({
        name        : "AppSystem",
        info        : "Application that serves items on simple URLs of the form /CID:IID, for admin purposes.",
        class_name  : 'schemat.item.AppSystem',
        fields      : C({name: new STRING()}),
    })
    cat.AppFiles = Category.new({
        name        : "AppFiles",
        class_name  : 'schemat.item.AppFiles',
        fields      : C({name: new STRING(), root_folder: new ITEM({type: cat.Folder})}),    // if root_folder is missing, Site's main folder is used
    })
    cat.AppSpaces = Category.new({
        name        : "AppSpaces",
        info        : "Application for accessing public data through verbose paths of the form: .../SPACE:IID, where SPACE is a text identifier assigned to a category in `spaces` property.",
        class_name  : 'schemat.item.AppSpaces',
        fields      : C({name: new STRING(), spaces: new CATALOG(new ITEM({type_exact: Category}))}),
    })
    
    cat.Site = Category.new({
        name        : "Site",
        info        : "Category of site records. A site contains information about applications, servers, startup",
        class_name  : 'schemat.item.Site',
        fields      : C({
            name        : new STRING(),
            base_url    : new STRING({info: "Base URL at which the website is served, no trailing '/'"}),
            system_path : new STRING({info: "A URL path that when appended to the `base_url` creates a URL of the system application, AppSystem - used for internal web access to items."}),
            application : new ITEM({info: "Application hosted on this site, typically an AppRoot with multiple subapplications"}),
            filesystem  : new ITEM({type: cat.Folder, info: "Root of the global file system"}),
            database    : new ITEM({type: cat.Database, info: "Global database layer"}),
        }),
    })
    cat.Varia = Category.new({
        name        : "Varia",
        info        : "Category of items that do not belong to any specific category",
        // class_name  : 'schemat.item.Item',
        class_body  :
`
static check() { import('./utils.js').then(mod => console.log("Varia.class_body: imported ", mod)) }
static error() { throw new Error('Varia/class_body/error()') }
`,
//static check() { console.log("Varia/class_body/check() successful") }
        fields      : C({name: new STRING(), title: new STRING()}),
        handlers    : C({}),
    })
    
    return cat
}

/**********************************************************************************************************************/

async function create_items(cat, Category) {
    let item = {}
    
    // path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    let path = "/home/marcin/Documents/priv/catalog/src/schemat"
    
    item.dir_system = cat.Folder.new({
        files: C({
            'Site':     cat.Site,
            'File':     cat.File,
            'Folder':   cat.Folder,
        }),
    })
    
    item.test_txt = cat.File.new({content: "This is a test file."})
    item.dir_tmp1 = cat.Folder.new({files: C({'test.txt': item.test_txt})})
    item.dir_tmp2 = cat.Folder.new({files: C({'tmp1': item.dir_tmp1})})
    
    item.database = cat.DatabaseYaml.new({filename: '/home/marcin/Documents/priv/catalog/src/schemat/server/db.yaml'})
    item.filesystem = cat.FolderLocal.new({path: `${path}`})
    // item.filesystem = cat.Folder.new({
    //     files: C({
    //         'system':           item.dir_system,
    //         'tmp':              item.dir_tmp2,
    //         'assets':           cat.FolderLocal.new({path: `${path}/assets`}),
    //
    //         'client.js':        cat.FileLocal.new({path: `${path}/client.js`}),
    //         'data.js':          cat.FileLocal.new({path: `${path}/data.js`}),
    //         'item.js':          cat.FileLocal.new({path: `${path}/item.js`}),
    //         'registry.js':      cat.FileLocal.new({path: `${path}/registry.js`}),
    //         'serialize.js':     cat.FileLocal.new({path: `${path}/serialize.js`}),
    //         'type.js':         cat.FileLocal.new({path: `${path}/type.js`}),
    //         'utils.js':         cat.FileLocal.new({path: `${path}/utils.js`}),
    //         // 'react.production.min.js': cat.FileLocal.new({path: `${path}/react.production.min.js`}),
    //     }),
    // })
    
    item.app_system = cat.AppSystem.new({name: "System"})
    item.app_files  = cat.AppFiles.new({name: "Files"})
    // item.app_ajax  = cat.AppAjax .new({name: "AJAX"})

    item.app_catalog = cat.AppSpaces.new({
        name        : "Catalog",
        spaces      : C({
            'sys.category':     Category,
            'sys.item':         cat.Varia,
            'sys.site':         cat.Site,
            'sys.dir':          cat.Folder,
            'sys.file':         cat.FileLocal,
        }),
    })
    item.app_root = cat.AppRoot.new({
        name        : "Applications",
        apps        : C({
            '$':        item.app_system,
            'files':    item.app_files,
            // 'ajax':     item.app_ajax,           // this app must be present under the "ajax" route for proper handling of client-server communication
            '':         item.app_catalog,        // default route
        }),
    })
    
    item.catalog_wiki = cat.Site.new({
        name        : "catalog.wiki",
        base_url    : "http://127.0.0.1:3000",
        system_path : "/$",
        application : item.app_root,
        filesystem  : item.filesystem,
        database    : item.database,
    })
    
    item.item_001 = cat.Varia.new({title: "Ala ma kota Sierściucha i psa Kłapoucha."})
    item.item_002 = cat.Varia.new({title: "ąłęÓŁŻŹŚ"})

    // item.item_002.push('name', "test_item")
    // item.item_002.push('name', "duplicate")

    return item
}

/**********************************************************************************************************************
 **
 **  BOOTSTRAP
 **
 */

async function bootstrap(db) {
    /* Create core items and store in DB. All existing items in DB are removed! */
    
    print(`Starting full RESET of DB, core items will be created anew in: ${db}`)
    
    let registry = globalThis.registry = new ServerRegistry(db)
    await registry.initClasspath()

    // create root category; insert it manually to DB (no staging) because it already has an ID and
    // would get "updated" rather than inserted
    let Category = await registry.createRoot(root_data)
    await registry.db.insert(Category)

    // create non-root categories & leaf items; while being create with Category.new(),
    // each item is staged for insertion to DB
    let cats  = await create_categories(Category)
    let items = await create_items(cats, Category)

    // insert all items to DB; the insertion order is important: if item A is referenced by item B,
    // the A must be inserted first so that its ID is available before B gets inserted
    await registry.commit()                             // insert items to DB and assign an ID to each of them
    await registry.setSite(items.catalog_wiki)
}

/**********************************************************************************************************************/

await bootstrap('/home/marcin/Documents/priv/catalog/src/schemat/server/db.yaml')

