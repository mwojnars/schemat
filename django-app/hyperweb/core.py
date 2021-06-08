"""
Core system items defined as Python objects.
"""

import json, yaml
from collections import defaultdict

from hyperweb.config import ROOT_CID
from hyperweb.item import Item, Category, RootCategory, Site, Application, Space, Route
from hyperweb.registry import Registry
from hyperweb.schema import Schema, Object, String, Boolean, Class, Dict, Link, Field, Record, Struct, \
    RecordSchema, RouteSchema


#####################################################################################################################################################
#####
#####  ELEMENTS of items
#####

# default template that displays a generic item page if a category-specific template is missing
page_item = """
    context $view
    $item = view._item
    $cat  = item.category

    style !
        body { font: 20px/30px 'Quattrocento Sans', "Helvetica Neue", Helvetica, Arial, sans-serif; }
        h1 { font-size: 26px; line-height: 34px }
        .catlink { font-size: 14px; margin-top: -20px }

    % print_headline
        p .catlink
            a href=$view.url(cat) | {cat['name']? or cat}
            | ($item.cid,$item.iid)

    html
        $name = item['name']? or str(item)
        head
            title | {name}
        body
            h1  | {name}
            print_headline
            h2  | Attributes
            ul
                for attr, value in item.data.items()
                    li
                        b | {attr}:
                        . | {str(value)}
"""

# template that displays a category page
page_category = """
    context $view
    $cat = view._item

    html
        $name = cat['name']? or str(cat)
        head
            title | {name ' -' }? category #{cat.iid}
        body
            h1
                try
                    i | $name
                    . | -
                | category #{cat.iid}
            h2  | Attributes
            ul
                for attr, value in cat.data.items()
                    li
                        b | {attr}:
                        . | {str(value)}
            h2  | Items
            table
                for item in cat.registry.load_items(cat)
                    tr
                        td / #{item.iid} &nbsp;
                        td : a href=$view.url(item)
                            | {item['name']? or item}
"""

root_schema = Record(
    schema       = RecordSchema(),  #Object(Record),
    name         = Field(schema = String(), info = "human-readable title of the category"),
    info         = String(),
    itemclass    = Field(schema = Class(), default = Item),
    templates    = Field(schema = Dict(String(), String()), default = {"": page_item}),
)


#####################################################################################################################################################
#####
#####  CATEGORIES
#####

_RootCategory = RootCategory._raw(
    name        = "Category",
    info        = "Category of items that represent categories",
    itemclass   = Category,
    schema      = root_schema,
    templates   = {"": page_category},
)
_RootCategory.category = _RootCategory

_Space = Category._raw(category = _RootCategory,
    name        = "Space",
    info        = "Category of items that represent item spaces.",
    itemclass   = Space,
    schema      = Record(name = String(), categories = Dict(String(), Link(_RootCategory))),
)

_Application = Category._raw(category = _RootCategory,
    name        = "Application",
    info        = "Category of application records. An application groups all spaces & categories available in the system and provides system-level configuration.",
    itemclass   = Application,
    schema      = Record(name = String(), spaces = Dict(String(), Link(_Space))),
)

_Site = Category._raw(category = _RootCategory,
    name        = "Site",
    info        = "Category of site records. A site contains information about applications, servers, startup",
    itemclass   = Site,
    schema      = Record(name = String(), base_url = String(), app = Link(_Application),
                         routes = Field(schema = Dict(String(), RouteSchema()),
                                        multi = False,
                                        info = "dictionary of named URL routes, each route specifies a base URL (protocol+domain), fixed URL path prefix, and a target application object")),
)

_Item = Category._raw(category = _RootCategory,
    name        = "Item",
    info        = "Category of items that do not belong to any specific category",
    itemclass   = Item,
    schema      = Record(name = Field(schema = String(), multi = True), title = String()),
)

#####################################################################################################################################################
#####
#####  ITEMS
#####

meta_space = Item._raw(category = _Space,
    name        = "Meta",
    categories  = {'category': _RootCategory, 'item': _Item}
)

sys_space = Item._raw(category = _Space,
    name        = "System",
    categories  = {'space': _Space, 'app': _Application, 'site': _Site}
)

Catalog_wiki = Item._raw(category = _Application,
    name        = "Catalog.wiki",
    spaces      = {'meta': meta_space, 'sys': sys_space},
)

catalog_wiki = Item._raw(category = _Site,
    name        = "catalog.wiki",
    routes      = {'default': Route(base = "http://localhost:8001", path = "/", app = Catalog_wiki)}
    #base_url    = "http://localhost:8001",
    #app         = Catalog_wiki,
)

# _Struct = Item._raw(category = '???',
#     name = 'Struct',
#     schema = Record(name = String(), type = Class(), fields = Dict(String(), Object(Schema))),
# )

#####################################################################################################################################################

item_001 = Item._raw(category = _Item,
    title       = "Ala ma kota Sierściucha i psa Kłapoucha.",
)
item_002 = Item._raw(category = _Item,
    title       = "ąłęÓŁŻŹŚ",
)
item_002.add('name', "test_item", "duplicate")


#####################################################################################################################################################

items = [
    _RootCategory,
    _Space,
    _Application,
    _Site,
    _Item,
    meta_space,
    sys_space,
    Catalog_wiki,
    catalog_wiki,
    # _Struct,
    
    item_001,
    item_002,
]

# def seed_items(items):
#     """
#     Assign IDs to a list of raw `items`: CID is taken from each item's category, while IID is assigned
#     consecutive numbers within a category. The root category must be the first item on the list.
#     """
#     next_iid = defaultdict(lambda: 1)           # all IIDs start from 1, except for root category
#
#     for i, item in enumerate(items):
#         if i == 0:
#             assert isinstance(item, RootCategory), "root category must be the first item on the list"
#             assert ROOT_CID < 1
#             item.cid = item.iid = ROOT_CID
#         else:
#             item.cid = cid = item.category.iid
#             item.iid = next_iid[cid]
#             next_iid[cid] += 1
#         
#     return items


#####################################################################################################################################################

if __name__ == "__main__":
    
    print()
    flats = []

    registry = Registry()

    # seed_items(items)
    registry.seed(items)
    
    # serialize items to YAML
    for item in items:
        
        raw  = item.to_json()
        flat = {'id': list(item.id)}
        flat.update(json.loads(raw))
        flats.append(flat)
        # print(yaml.dump(flat))
        
    print()
    print("ITEMS:")
    print()
    print(yaml.dump(flats, default_flow_style = None, sort_keys = False, allow_unicode = True))
    
