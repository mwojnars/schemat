"""
Core system items defined as Python objects.


item.title: text, any language, possibly rich text; multiple variants for different languages;
            no need to ensure uniqueness (!)
item.name: string; human-readable non-unique name; different languages, but NO rich text
directory[item].name: open relation, unique names; no natural "auto-increment"; new names assigned by item creator;
           names must be stored in a TABLE to allow transactional inserts (primary data, not derived);
           derived INDEX maps item IDs back to names (reversed link)
Directory: one-directional mapping name -> item
Namespace: bidirectional mapping name <-> item
"""

from hyperweb.core.categories import *
from hyperweb.core.items import *


#####################################################################################################################################################
#####
#####  CORE ITEMS list
#####

core_items = {name: obj for name, obj in globals().items() if isinstance(obj, Item)}

print('core items:')
for name in core_items.keys(): print(name)
print()

core_items = list(core_items.values())


#####################################################################################################################################################

if __name__ == "__main__":
    
    # for testing purposes only...
    
    import json, yaml
    from hyperweb.registry import Registry

    print()
    flats = []

    registry = Registry()
    registry.seed(core_items)
    
    # serialize items to YAML
    for item in core_items:
        
        raw  = item.dump_json()
        flat = {'id': list(item.id)}
        flat.update(json.loads(raw))
        flats.append(flat)
        # print(yaml.dump(flat))
        
    print()
    print("ITEMS:")
    print()
    print(yaml.dump(flats, default_flow_style = None, sort_keys = False, allow_unicode = True))
    
