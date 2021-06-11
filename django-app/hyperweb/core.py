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
    schema       = RecordSchema(),
    name         = Field(schema = String(), info = "human-readable title of the category"),
    info         = String(),
    itemclass    = Field(schema = Class(), default = Item),
    templates    = Field(schema = Dict(String(), String()), default = {"": page_item}),
)


#####################################################################################################################################################
#####
#####  CATEGORIES
#####

_Category = RootCategory(
    name        = "Category",
    info        = "Category of items that represent categories",
    itemclass   = Category,
    schema      = root_schema,
    templates   = {"": page_category},
)
_Category.category = _Category

_Space = _Category(
    name        = "Space",
    info        = "Category of items that represent item spaces.",
    itemclass   = Space,
    schema      = Record(name = String(), categories = Dict(String(), Link(_Category))),
)

_Application = _Category(
    name        = "Application",
    info        = "Category of application records. An application groups all spaces & categories available in the system and provides system-level configuration.",
    itemclass   = Application,
    schema      = Record(name = String(), spaces = Dict(String(), Link(_Space))),
)

_Site = _Category(
    name        = "Site",
    info        = "Category of site records. A site contains information about applications, servers, startup",
    itemclass   = Site,
    schema      = Record(name = String(),
                         routes = Field(schema = Dict(String(), RouteSchema()),
                                        multi = False,
                                        info = "dictionary of named URL routes, each route specifies a base URL (protocol+domain), fixed URL path prefix, and a target application object")),
)

_Varia = _Category(
    name        = "Varia",
    info        = "Category of items that do not belong to any specific category",
    itemclass   = Item,
    schema      = Record(name = Field(schema = String(), multi = True), title = String()),
)

def category(name = None, info = None, itemclass = None, schema = None):
    params = {}
    if name is not None: params['name'] = name
    if info is not None: params['info'] = info
    if itemclass is not None: params['itemclass'] = itemclass
    if schema is not None: params['schema'] = schema
    return _Category(**params)

# _Text = category('Text', 'A piece of plain or rich text for human consumption. May keep information about language and/or markup.',
#                  schema = Text())
_Code = category('Code', 'A piece of source code. May keep information about programming language.',
                 schema = String())

# _PythonClass = _Category(
#     name        = "PythonClass",
#     schema      = Record(methods = Dict(String(), Tuple(ArgsList(), String()))),
# )

# _SchemaType = _Category(
#     name        = "SchemaType",
#     itemclass   = SchemaType,
#     schema      = '???',
# )

# _Struct = _Schema(
#     name = 'Struct',
#     schema = Record(name = String(), type = Class(), fields = Dict(String(), Object(Schema))),
# )

#####################################################################################################################################################
#####
#####  ITEMS
#####

meta_space = _Space(
    name        = "Meta",
    categories  = {'category': _Category, 'item': _Varia}
)

sys_space = _Space(
    name        = "System",
    categories  = {'space': _Space, 'app': _Application, 'site': _Site}
)

Catalog_wiki = _Application(
    name        = "Catalog.wiki",
    spaces      = {'meta': meta_space, 'sys': sys_space},
)

catalog_wiki = _Site(
    name        = "catalog.wiki",
    routes      = {'default': Route(base = "http://localhost:8001", path = "/", app = Catalog_wiki)}
)

pages_common = _Code(code = '')


#####################################################################################################################################################

item_001 = _Varia(title = "Ala ma kota Sierściucha i psa Kłapoucha.")
item_002 = _Varia(title = "ąłęÓŁŻŹŚ")
item_002.add('name', "test_item", "duplicate")


#####################################################################################################################################################

core_items = [
    _Category,
    _Space,
    _Application,
    _Site,
    _Varia,
    meta_space,
    sys_space,
    Catalog_wiki,
    catalog_wiki,
    # _Struct,
    
    item_001,
    item_002,
]


#####################################################################################################################################################

if __name__ == "__main__":
    
    print()
    flats = []

    registry = Registry()
    registry.seed(core_items)
    
    # serialize items to YAML
    for item in core_items:
        
        raw  = item.to_json()
        flat = {'id': list(item.id)}
        flat.update(json.loads(raw))
        flats.append(flat)
        # print(yaml.dump(flat))
        
    print()
    print("ITEMS:")
    print()
    print(yaml.dump(flats, default_flow_style = None, sort_keys = False, allow_unicode = True))
    
