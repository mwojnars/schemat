import {Catalog, Data} from "../core/data.js"
import {CODE, ITEM, NUMBER, PATH, TYPE, STRING, TEXT, BOOLEAN} from "../types/type.js"
import {CATALOG, DATA_SCHEMA} from "../types/catalog.js"


/**********************************************************************************************************************
 **
 **  Schema of ROOT CATEGORY
 **
 */

// global-default fields shared by all item types
let default_fields = new Catalog({
    __category  : new ITEM({info: "Category of this item. Determines item's behavior and the schema of its attributes. Each category should be an item of the Root Category (IID=0).",
                            inherit: false}),
    // __class     : new CLASS({info: "Javascript class to be assigned to the item after loading to provide custom methods for the item."}),
    __extends   : new ITEM({info: "An item that serves as a prototype for this one, that is, provides default values for missing properties of this item. " +
                                  "Multiple prototypes are allowed, the first one has priority over subsequent ones. Prototypes can be defined for regular items or categories - the latter case represents category inheritance. " +
                                  "Items/categories may inherit individual entries from catalog-valued fields, see Item.getInherited(). In this way, subcategories inherit individual field schemas as defined in base categories.",
                            inherit: false}),
    __container : new ITEM({info: "Parent URL container of this object. The chain of containers leading from Site to the object define the access path of this object, which can be converted to a canonical URL path of the object by removing blank segments."}),

    name        : new STRING({info: "Display name of the item. May contain spaces, punctuation, non-latin characters.", default: ""}),
    info        : new TEXT({info: "Description of the item."}),
    html_title  : new STRING({info: "HTML title to be used for when this item is rendered."}),

    // container_path : new STRING({info: "Access path to the parent Container of this object relative to the site's root, with leading '/'. If the path passes through a blank route (/*ROUTE), the corresponding segment must be included (unlike in URLs)."}),
})

// fields inside a category instance, including the root category
let root_fields = new Catalog({
    class_path   : new STRING({info: "SUN path to a Javascript file that contains a (base) class for this category. May contain an optional class name appended after colon ':'. If the class name is missing (no colon), default import from the file is used."}),
    class_name   : new STRING({info: "Custom internal name for the Class of this category, for debugging. Also used as an alias when exporting the Class from the category's module."}),
    class_init   : new CODE({repeated: true, info: "Module-level initialization for this category's Javascript class. Typically contains import statements and global variables. Preceeds the Class definition (`class_body`, `views`) in the category's module code."}),
    class_body   : new CODE({repeated: true, info: "Source code of the class (a body without heading) that will be created for this category. The class inherits from the `class_path` class, or the class of the first base category, or the top-level Item."}),

    default_endpoints: new CATALOG({values: new STRING(), info: "List of [PROTOCOL, endpoint] pairs that define default endpoint(s) for objects of this category when requested via a URL with no explicit endpoint.",
                                    default: new Catalog(['GET', 'view'], ['GET', 'admin'], ['CALL', 'self']),
                                   }),

    pages        : new CATALOG({values: new CODE(), info: "Source code of functions that generate static HTML response for particular access methods of this category's items."}),
    views        : new CATALOG({values: new CODE(), info: "Body of React functional components (no function header) to be added dynamically to the category's Class body as VIEW_name(props) methods for rendering item views. Inside the function body, `this` refers the item to be rendered. Alternatively, the code of each view may consist of a method header, view() {...}, and be accompanied by supporting methods: title(), assets() - like in a class body."}),
    // html_assets  : new CODE({info: "HTML code to be inserted in the html/head section of every page that is rendered from a view function of this category."}),

    // cache_ttl    : new NUMBER({default: 5.0, info: "Time To Live (TTL). Determines for how long (in seconds) an item of this category is kept in a server-side cache after being loaded from DB, for reuse by subsequent requests. A real number. If zero, the items are evicted immediately after each request."}),
    fields       : new CATALOG({values: new TYPE(), info: "Fields must have unique names.", default: default_fields}),
    data_schema  : new DATA_SCHEMA({info: "The DATA schema for this category's items. A virtual (non-editable) field automatically imputed from the `schema` property."}),

    // _boot_class  : new STRING({info: "Name of a core Javascript class, subclass of Item, to be used for items of this category. If `class_body` is configured, the class is subclassed dynamically to insert the desired code. Should only be used for core Schemat categories."}),
    //custom_class : new BOOLEAN({info: "If true in a category, items of this category are allowed to provide their own `class_body` and `code*` implementations.", default: false}),
    //indexes    : new CATALOG({values: new ITEM(Index)}),

    allow_custom_fields : new BOOLEAN({default: false, info: "If true, it is allowed to use undefined (out-of-schema) fields in items - their schema is GENERIC()"})

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

export let root_data = new Data({
    name        : "Category",
    info        : "Category of items that represent categories",
    // _boot_class : 'schemat.item.Category',      //  '/$/core/item.js/Category'
    // cache_ttl   : 10.0,
    fields      : root_fields,
})

