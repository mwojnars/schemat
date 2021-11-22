/*
Core system items defined as objects.
Every item created through category(...) call is automatically inserted to the registry's
staging area and will be inserted to DB upon registry.commit().
*/

//from hyperweb.core.categories import *
import {File_, FileLocal_, Folder_, AppRoot_, AppAdmin_, AppAjax_, AppFiles_, Site_} from './categories.js'


/**********************************************************************************************************************
 **
 **  ITEMS
 **
 */

// _path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
let _path = "/home/marcin/Documents/priv/catalog/src/schemat"

let dir_system = await Folder_.new({
    files: {
        'Site':     Site_,
        'File':     File_,
        'Folder':   Folder_,
    },
})

let test_txt = await File_.new({content: "This is a test file."})
let dir_tmp1 = await Folder_.new({files: {'test.txt': test_txt}})
let dir_tmp2 = await Folder_.new({files: {'tmp1': dir_tmp1}})

let filesystem = await Folder_.new({
    files: {
        'system':           dir_system,
        'tmp':              dir_tmp2,
        
        'client.js':        await FileLocal_.new({path: `${_path}/client.js`}),
        'item.js':          await FileLocal_.new({path: `${_path}/item.js`}),
        'registry.js':      await FileLocal_.new({path: `${_path}/registry.js`}),
        'serialize.js':     await FileLocal_.new({path: `${_path}/serialize.js`}),
        'server.js':        await FileLocal_.new({path: `${_path}/assets/server.js`}),
        'style.css':        await FileLocal_.new({path: `${_path}/assets/style.css`}),
        'types.js':         await FileLocal_.new({path: `${_path}/types.js`}),
        'utils.js':         await FileLocal_.new({path: `${_path}/utils.js`}),
        // 'react.production.min.js': await FileLocal_.new({path: `${_path}/react.production.min.js`}),
    },
})

/**********************************************************************************************************************/

let app_admin = await AppAdmin_.new({name: "Admin"})
let app_ajax  = await AppAjax_ .new({name: "AJAX"})
let app_files = await AppFiles_.new({name: "Files"})

let app_catalog = await AppSpaces_.new({
    name        : "Catalog",
    spaces      : {
        'sys.category':     Category_,
        'sys.item':         Varia_,
        'sys.site':         Site_,
        'sys.dir':          Folder_,
        'sys.file':         FileLocal_,
    },
})
let app_root = await AppRoot_.new({
    name        : "Applications",
    apps        : {
        'admin':    app_admin,
        'ajax':     app_ajax,           // this app must be present under the "ajax" route for proper handling of client-server communication
        'files':    app_files,
        '':         app_catalog,        // default route
    },
})

let catalog_wiki = await Site_.new({
    name        : "catalog.wiki",
    base_url    : "http://127.0.0.1:3000",
    filesystem  : filesystem,
    application : app_root,
})

/**********************************************************************************************************************/

let item_001 = await Varia_.new({title: "Ala ma kota Sierściucha i psa Kłapoucha."})
let item_002 = await Varia_.new({title: "ąłęÓŁŻŹŚ"})
item_002.add('name', "test_item")  //, "duplicate")

