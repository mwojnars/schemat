"""
Core system items defined as Python objects.
"""

import yaml
from hyperweb.schema import Record


###  The dictionaries below represent contents (`data`, id) of particular items.

_RootCategory = dict(
    name = "Category",
    info = "Category of items that represent categories",
    itemclass = Category,
    
    schema = Record(),
    
    templates = {},
)

_Struct = dict(
    name = 'Struct',
    schema = Record(name = String(), type = Class(), fields = Dict(String(), Class(Schema))),
)


#####################################################################################################################################################

items = [
    _RootCategory,
    _Struct,
]

#####################################################################################################################################################

if __name__ == "__main__":

    # serialize items to YAML file
    yaml.dumps(items)
    
