"""
Core system items defined as Python objects.
"""

import json, yaml

from hyperweb.config import ROOT_CID
from hyperweb.item import Item, Category, RootCategory
from hyperweb.registry import Registry
from hyperweb.schema import Schema, Object, String, Class, Dict, Record

registry = Registry()


#####################################################################################################################################################

###  The dictionaries below represent contents (`data`, id) of particular items

_RootCategory = RootCategory._raw(
    id          = (ROOT_CID, ROOT_CID),
    name        = "Category",
    info        = "Category of items that represent categories",
    itemclass   = Category,
    schema      = Record(),
    templates   = {},
)

_Struct = dict(
    name = 'Struct',
    schema = Record(name = String(), type = Class(), fields = Dict(String(), Object(Schema))),
)


#####################################################################################################################################################

items = [
    _RootCategory,
    _Struct,
]

#####################################################################################################################################################

if __name__ == "__main__":
    
    # from hyperweb.multidict import MultiDict
    
    # serialize items to YAML
    for item in items:
        raw  = item.to_json()
        flat = {'id': item.id}
        flat.update(json.loads(raw))
        
        # data = MultiDict(item)
        # flat = schema.encode(data)
        print(yaml.dump(flat))
    
