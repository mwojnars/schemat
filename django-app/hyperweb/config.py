"""
Global configuration.
"""

#####################################################################################################################################################
#####
#####  SYSTEM-LEVEL CONFIGURATION
#####

# predefined CID of items that represent categories
ROOT_CID = 0

# suffix appended to attribute names of items to retrieve a list of all values
# of a given attribute from item.__data__ rather than the 1st value only
MULTI_SUFFIX = '_list'

# rules for detecting disallowed attribute names in category definitions
STOP_ATTR = {
    'special':      (lambda name: name[0] == '_'),
    'reserved':     (lambda name: name in 'load insert update save'),
    'multidict':    (lambda name: name.endswith(MULTI_SUFFIX)),
}


CLASS_ALIASES = {
    "hyperweb.data.Data": "Data",
}

ALIASES = [
    # special names are mapped from "package.module.name" to "$name" during serialization
    ('hyperweb.data.',   '$', ['Data']),
    ('hyperweb.schema.', '$', ['Schema']),
    ('hyperweb.fields.', '$', ['Object', 'Class', 'String', 'Dict', 'Link']),
    ('hyperweb.core.',   '$', ['Item', 'Category', 'Site', 'Application', 'Space']),
    ('builtins.',        '!', ['type', 'set', 'str'])
]
