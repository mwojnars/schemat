"""
Core system items defined as Python objects.
"""

import json, yaml
from copy import copy

# from hyperweb.config import ROOT_CID
from hyperweb.item import Item, Category, RootCategory, Site
from hyperweb.registry import Registry
from hyperweb.schema import Schema, Object, String, Class, Dict, Link, Field, Record, RouteSchema


#####################################################################################################################################################

registry = Registry()


###  The dictionaries below represent contents (`data`, id) of particular items

root_schema = Record(
    schema       = Object(Record),
    name         = String(),
    info         = String(),
    itemclass    = Class(),
    templates    = Dict(String(), String()),
)
startup_schema = copy(root_schema)

_RootCategory = RootCategory._raw(registry = registry,
    id          = (0, 0),
    name        = "Category",
    info        = "Category of items that represent categories",
    itemclass   = Category,
    schema      = root_schema,
    templates   = {},
)
_RootCategory.category = _RootCategory

_Site = Category._raw(registry = registry, category = _RootCategory,
    id          = (0, 1),
    name        = "Site",
    info        = "Category of site records. A site contains information about applications, servers, startup",
    itemclass   = Site,
    schema      = Record(name = String(), base_url = String(), app = Link(cid=2),
                         routes = Field(schema = Dict(String(), RouteSchema()),
                                        multi = False,
                                        info = "dictionary of named URL routes, each route specifies a base URL (protocol+domain), fixed URL path prefix, and a target application object")),
)

# _Struct = Item._raw(registry = registry, category = '???',
#     name = 'Struct',
#     schema = Record(name = String(), type = Class(), fields = Dict(String(), Object(Schema))),
# )


#####################################################################################################################################################

items = [
    _RootCategory,
    _Site,
    # _Struct,
]

#####################################################################################################################################################

if __name__ == "__main__":
    
    print()
    # from hyperweb.multidict import MultiDict
    flats = []

    # serialize items to YAML
    for item in items:
        
        # raw  = item.to_json()
        schema = item.category['schema'] if item.id != (0,0) else startup_schema
        raw = schema.to_json(item.data, registry)
        
        flat = {'id': item.id}
        flat.update(json.loads(raw))
        flats.append(flat)
        print(yaml.dump(flat))

        # data = MultiDict(item)
        # flat = schema.encode(data)
        
    print()
    print("all:")
    print(yaml.dump(flats))
    
