/*
Creating core items from scratch and storing them as initial items in DB.
 */

import {print} from '../utils.js'
import {ServerRegistry} from './s-registry.js'
import {GENERIC, SCHEMA, STRING, TEXT, CODE, ITEM, CATALOG, FILENAME} from '../types.js'
//import {Index} from '../item.js'


/**********************************************************************************************************************
 **
 **  SCHEMA of ROOT
 **
 */

// fields of categories, including the root category
let root_fields = {
    name         : new STRING({info: "human-readable title of the category"}),
    info         : new TEXT(),
    startup_site : new GENERIC(),
    prototype    : new ITEM(null, {info: "Base category from which this one inherits. Multiple prototypes are allowed, the first one overrides settings of subsequent ones."}),
    class_name   : new STRING({default: 'hyperweb.core.Item', info: "Full (dotted) path of a python class. Or the class name that should be imported from `class_code` after its execution."}),
    class_code   : new TEXT(),     // TODO: take class name from `name` not `class_name`; drop class_name; rename class_code to `code`
    endpoints    : new CATALOG(new CODE()),
    handlers     : new CATALOG(new CODE()),
    fields       : new CATALOG(new SCHEMA()),

    //field       : SCHEMA(multiple : True, labels : True)
    //endpoint    : CODE(multiple : True, labels : True)
    //index       : ITEM(Index),

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
}

let root_data = {
    name        : "Category",
    info        : "Category of items that represent categories",
    class_name  : 'hyperweb.core.Category',
    endpoints   : {},
    //handlers  : {"view": render_category},
    fields      : root_fields,
    //field     : multiple(**root_fields),
}


/**********************************************************************************************************************
 **
 **  CATEGORIES & ITEMS
 **
 */

async function create_categories(Category) {
    let cat = {}

    cat.File = await Category.new({
        name    : "File",
        info    : "File with a text content. Accessible through the web filesystem.",
        class_name  : 'hyperweb.core.File',
        fields      : {
            format  : new STRING(),    // ProgrammingLanguage()
            content : new CODE(),      // VARIANT(bin : BYTES(), txt : TEXT()),
        },
    })
    cat.FileLocal = await Category.new({
        name        : "FileLocal",
        info        : "File located on a local disk, identified by its local file path.",
        prototype   : cat.File,
        class_name  : 'hyperweb.core.FileLocal',
        fields      : {
            path    : new STRING(),             // path to a local file on disk
            //format: new STRING(),             // file format: pdf, xlsx, ...
        },
    })
    cat.Folder = await Category.new({
        name        : "Folder",
        info        : "A directory of files, each file has a unique name (path). May contain nested directories.",
        class_name  : 'hyperweb.core.Folder',
        fields      : {files: new CATALOG(new ITEM(), new FILENAME())}     // file & directory names mapped to item IDs
    })
    
    cat.Application = await Category.new({
        name        : "Application",
        info        : "Category of application records. An application groups all spaces & categories available in the system and provides system-level configuration.",
        class_name  : 'hyperweb.core.Application',
        fields      : {name: new STRING()},
        // folder   : FILEPATH(),       // path to a folder in the site's directory where this application was installed;
                                        // if the app needs to store data items in the directory, it's recommended
                                        // to do this inside a .../data subfolder
    })
    cat.AppRoot  = await Category.new({
        name        : "AppRoot",
        info        : "A set of sub-applications, each bound to a different URL prefix.",
        class_name  : 'hyperweb.core.AppRoot',
        prototype   : cat.Application,
        fields      : {name: new STRING(), apps: new CATALOG(new ITEM())},  // TODO: restrict apps to sub-categories of Application_ (?)
    })
    cat.AppAdmin = await Category.new({
        name        : "AppAdmin",
        info        : "Application that serves items on simple URLs of the form /CID:IID, for admin purposes.",
        class_name  : 'hyperweb.core.AppAdmin',
        fields      : {name: new STRING()},
    })
    cat.AppAjax = await Category.new({
        name        : "AppAjax",
        info        : "Internal application to serve AJAX requests, mainly for pulling additional items by client UI.",
        class_name  : 'hyperweb.core.AppAjax',
        fields      : {name: new STRING()},
    })
    cat.AppFiles = await Category.new({
        name        : "AppFiles",
        class_name  : 'hyperweb.core.AppFiles',
        fields      : {name: new STRING(), root_folder: new ITEM(cat.Folder)},    // if root_folder is missing, Site's main folder is used
    })
    cat.AppSpaces = await Category.new({
        name        : "AppSpaces",
        info        : "Application for accessing public data through verbose paths of the form: .../SPACE:IID, where SPACE is a text identifier assigned to a category in `spaces` property.",
        class_name  : 'hyperweb.core.AppSpaces',
        fields      : {name: new STRING(), spaces: new CATALOG(new ITEM(cat.Category))},
    })
    
    cat.Site = await Category.new({
        name        : "Site",
        info        : "Category of site records. A site contains information about applications, servers, startup",
        class_name  : 'hyperweb.core.Site',
        fields      : {
            name        : new STRING(),
            base_url    : new STRING(),             // the base URL at which the `application` is served, /-terminated
            filesystem  : new ITEM(cat.Folder),     // root of the site-global file system
            application : new ITEM(),               // Application hosted on this site, typically an AppRoot with multiple subapplications
        },
    })
    cat.Varia = await Category.new({
        name        : "Varia",
        info        : "Category of items that do not belong to any specific category",
        class_name  : 'hyperweb.core.Item',
        fields      : {name: new STRING(), title: new STRING()},            // multi: true
    })
    
    return cat
}

/**********************************************************************************************************************/

async function create_items(cat, Category) {
    let item = {}
    
    // path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    let path = "/home/marcin/Documents/priv/catalog/src/schemat"
    
    item.dir_system = await cat.Folder.new({
        files: {
            'Site':     cat.Site,
            'File':     cat.File,
            'Folder':   cat.Folder,
        },
    })
    
    item.test_txt = await cat.File.new({content: "This is a test file."})
    item.dir_tmp1 = await cat.Folder.new({files: {'test.txt': item.test_txt}})
    item.dir_tmp2 = await cat.Folder.new({files: {'tmp1': item.dir_tmp1}})
    
    item.filesystem = await cat.Folder.new({
        files: {
            'system':           item.dir_system,
            'tmp':              item.dir_tmp2,
            
            'client.js':        await cat.FileLocal.new({path: `${path}/client.js`}),
            'item.js':          await cat.FileLocal.new({path: `${path}/item.js`}),
            'registry.js':      await cat.FileLocal.new({path: `${path}/registry.js`}),
            'serialize.js':     await cat.FileLocal.new({path: `${path}/serialize.js`}),
            'server.js':        await cat.FileLocal.new({path: `${path}/assets/server.js`}),
            'style.css':        await cat.FileLocal.new({path: `${path}/assets/style.css`}),
            'types.js':         await cat.FileLocal.new({path: `${path}/types.js`}),
            'utils.js':         await cat.FileLocal.new({path: `${path}/utils.js`}),
            // 'react.production.min.js': await cat.FileLocal.new({path: `${path}/react.production.min.js`}),
        },
    })
    
    item.app_admin = await cat.AppAdmin.new({name: "Admin"})
    item.app_ajax  = await cat.AppAjax .new({name: "AJAX"})
    item.app_files = await cat.AppFiles.new({name: "Files"})
    
    item.app_catalog = await cat.AppSpaces.new({
        name        : "Catalog",
        spaces      : {
            'sys.category':     Category,
            'sys.item':         cat.Varia,
            'sys.site':         cat.Site,
            'sys.dir':          cat.Folder,
            'sys.file':         cat.FileLocal,
        },
    })
    item.app_root = await cat.AppRoot.new({
        name        : "Applications",
        apps        : {
            'admin':    item.app_admin,
            'ajax':     item.app_ajax,           // this app must be present under the "ajax" route for proper handling of client-server communication
            'files':    item.app_files,
            '':         item.app_catalog,        // default route
        },
    })
    
    item.catalog_wiki = await cat.Site.new({
        name        : "catalog.wiki",
        base_url    : "http://127.0.0.1:3000",
        filesystem  : item.filesystem,
        application : item.app_root,
    })
    
    item.item_001 = await cat.Varia.new({title: "Ala ma kota Sierściucha i psa Kłapoucha."})
    item.item_002 = await cat.Varia.new({title: "ąłęÓŁŻŹŚ"})
    // item.item_002.add('name', "test_item")  //, "duplicate")
    
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
    await registry.init_classpath()

    // create root category; insert it manually to DB (no staging) because it already has an ID and
    // would get "updated" rather than inserted
    let Category = await registry.create_root(root_data)
    await registry.db.insert(Category)

    // create non-root categories & leaf items; while being create with Category.new(),
    // each item is staged for insertion to DB
    let cats  = await create_categories(Category)
    let items = await create_items(cats, Category)

    // insert all items to DB; the insertion order is important: if item A is referenced by item B,
    // the A must be inserted first so that its ID is available before B gets inserted
    await registry.commit()                             // insert items to DB and assign an ID to each of them
    await registry.set_site(items.catalog_wiki)
}

/**********************************************************************************************************************/

await bootstrap('/home/marcin/Documents/priv/catalog/src/schemat/server/db.yaml')

