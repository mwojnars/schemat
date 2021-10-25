from hyperweb.schema import *
from hyperweb.item import Index
from hyperweb.registry import Registry

#####################################################################################################################################################

# template to display a category page
page_category = """
context $item
from base import %page_category
page_category item
"""

# default template to display a generic item page if a category-specific template is missing
page_item = """
context $item
from base import %page_item
page_item $item
# dedent : page_item $item
"""

#####################################################################################################################################################

# fields of categories, including the root category
root_fields = dict(
    name         = STRING(info = "human-readable title of the category"),
    info         = STRING(),
    startup_site = OBJECT(),
    prototype    = ITEM(info = "Base category from which this one inherits. Multiple prototypes are allowed, the first ones override settings of subsequent ones."),
    class_name   = STRING(default = 'hyperweb.core.Item', info = "Full (dotted) path of a python class. Or the class name that should be imported from `class_code` after its execution."),
    class_code   = TEXT(),     # TODO: take class name from `name` not `class_name`; drop class_name; rename class_code to `code`
    endpoints    = CATALOG(CODE(), default = {"view": page_item}),
    fields       = CATALOG(SCHEMA()),
    
    #field       = SCHEMA(multiple = True, labels = True)
    #endpoint    = CODE(multiple = True, labels = True, default = {"view": page_item})
    #index       = ITEM(Index),
    
    #dark_fields = BOOLEAN(default = False, info = "If true, it is allowed to use undefined (out-of-schema) fields in items - their schema is OBJECT()")
    
    #summary_idx = STRING(),    # name of index that should be used for loading core props: name, title, ... of the item
                                # - these props are needed to generate "simple links" to this item on "edit" tabs of other items,
                                # and generate "summary" of this item when referenced in other items' "view" tabs
                                # without loading full item data from the main table (is it worth to keep an index for this??);
                                # this index is used for *outgoing* references only; *incoming* references are loaded
                                # through indexes of corresponding child relations
    
    #ttl_client  = INTEGER(),   # for how long to keep items of this category in cache, client side (in browser's localStorage)
    #ttl_server  = INTEGER(),   # for how long to keep items of this category in cache, server side
    
    #revisions   = BOOLEAN()    # if True, a revision item is created on every update of an item of this category
    #revisions_config = RECORD  # config of revisions: retention period (dflt: infinite), ...
    
    #versioning  = BOOLEAN()    # if True, `version` number is stored in items' metadata and is increased on every update
    #version_by  = STRING()     # name of an item's INTEGER field that should keep version number (if versioning is ON)
    
    #push_item_updates = BOOLEAN(),     # if True, updates to items of this category are broadcasted to all servers in a cluster;
                                        # should only be used for categories with few, rarely-updated items, like the root category
    #live_upgrade_intensity = FLOAT(),  # likelihood (0.0-1.0) that an edge server should write back an upgraded item
                                        # that referred to an outdated revision of its category (esp. schema), instead of
                                        # leaving this upgrade-write for a background process; typically ~0.01
)

root_data = dict(
    name        = "Category",
    info        = "Category of items that represent categories",
    class_name  = 'hyperweb.core.Category',
    endpoints   = {"view": page_category},
    fields      = root_fields,
    #field      = multiple(**root_fields),
)

#####################################################################################################################################################
#####
#####  GLOBAL REGISTRY
#####

registry = Registry()
registry.init_classpath()
