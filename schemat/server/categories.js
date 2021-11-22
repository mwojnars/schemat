/*
Core system categories defined as Python objects.

Every object created through Category_(...) call is automatically inserted to the registry's
staging area and will be inserted to DB upon registry.commit() - see boot.py.
*/

import {STRING, CODE, ITEM, CATALOG, FILENAME} from '../types.js'


/**********************************************************************************************************************
 **
 **  CATEGORIES. The underscore _ is appended in names to differentiate them from names of classes
 **
 */

// root Category_ is newly created here (not loaded), so it must be inserted to DB;
// all other items/categories are staged for commit automatically
export let Category_ = registry.create_root(false)

export let File_ = await Category_.new({
    name    : "File",
    info    : "File with a text content. Accessible through the web filesystem.",
    class_name  : 'hyperweb.core.File',
    fields      : {
        format  : new STRING(),    // ProgrammingLanguage()
        content : new CODE(),      // VARIANT(bin : BYTES(), txt : TEXT()),
    },
})
export let FileLocal_ = await Category_.new({
    name        : "FileLocal",
    info        : "File located on a local disk, identified by its local file path.",
    prototype   : File_,
    class_name  : 'hyperweb.core.FileLocal',
    fields      : {
        path    : new STRING(),             // path to a local file on disk
        //format: new STRING(),             // file format: pdf, xlsx, ...
    },
})

export let Folder_ = await Category_.new({
    name        : "Folder",
    info        : "A directory of files, each file has a unique name (path). May contain nested directories.",
    class_name  : 'hyperweb.core.Folder',
    fields      : {files: new CATALOG({keys: new FILENAME(), values: new ITEM()})}     // file & directory names mapped to item IDs
})

/**********************************************************************************************************************/

export let Application_ = await Category_.new({
    name        : "Application",
    info        : "Category of application records. An application groups all spaces & categories available in the system and provides system-level configuration.",
    class_name  : 'hyperweb.core.Application',
    fields      : {name: new STRING()},
    // folder   : FILEPATH(),       // path to a folder in the site's directory where this application was installed;
                                    // if the app needs to store data items in the directory, it's recommended
                                    // to do this inside a .../data subfolder
})
export let AppRoot_  = await Category_.new({
    name        : "AppRoot",
    info        : "A set of sub-applications, each bound to a different URL prefix.",
    class_name  : 'hyperweb.core.AppRoot',
    prototype   : Application_,     // TODO: add support for category inheritance (prototypes)
    fields      : {name: new STRING(), apps: new CATALOG(new ITEM())},  // TODO: restrict apps to sub-categories of Application_ (?)
})

export let AppAdmin_ = await Category_.new({
    name        : "AppAdmin",
    info        : "Application that serves items on simple URLs of the form /CID:IID, for admin purposes.",
    class_name  : 'hyperweb.core.AppAdmin',
    fields      : {name: new STRING()},
})
export let AppAjax_ = await Category_.new({
    name        : "AppAjax",
    info        : "Internal application to serve AJAX requests, mainly for pulling additional items by client UI.",
    class_name  : 'hyperweb.core.AppAjax',
    fields      : {name: new STRING()},
})
export let AppFiles_ = await Category_.new({
    name        : "AppFiles",
    class_name  : 'hyperweb.core.AppFiles',
    fields      : {name: new STRING(), root_folder: new ITEM(Folder_)},    // if root_folder is missing, Site's main folder is used
})
export let AppSpaces_ = await Category_.new({
    name        : "AppSpaces",
    info        : "Application for accessing public data through verbose paths of the form: .../SPACE:IID, where SPACE is a text identifier assigned to a category in `spaces` property.",
    class_name  : 'hyperweb.core.AppSpaces',
    fields      : {name: new STRING(), spaces: new CATALOG(new ITEM(Category_))},
})

export let Site_ = await Category_.new({
    name        : "Site",
    info        : "Category of site records. A site contains information about applications, servers, startup",
    class_name  : 'hyperweb.core.Site',
    fields      : {
        name        : new STRING(),
        base_url    : new STRING(),             // the base URL at which the `application` is served, /-terminated
        filesystem  : new ITEM(Folder_),        // root of the site-global file system
        application : new ITEM(),               // Application hosted on this site, typically an AppRoot with multiple subapplications
    },
})

export let Varia_ = await Category_.new({
    name        : "Varia",
    info        : "Category of items that do not belong to any specific category",
    class_name  : 'hyperweb.core.Item',
    fields      : {name: new STRING(), title: new STRING()},            // multi: true
})

