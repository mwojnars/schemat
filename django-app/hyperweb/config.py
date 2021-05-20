"""
Global configuration.
"""

#####################################################################################################################################################
#####
#####  SYSTEM-LEVEL CONFIGURATION
#####

ROOT_CID = 0        # CID of items representing categories
SITE_ID  = (1,1)    # (CID,IID) of the site to be loaded upon startup

# suffix appended to attribute names of items to retrieve a list of all values
# of a given attribute from item.data rather than the 1st value only
MULTI_SUFFIX = '_list'


# ALIASES = [
#     # special names are mapped from "package.module.name" to "$name" during serialization
#     ('hyperweb.data.',   '$', ['Data']),
#     ('hyperweb.schema.', '$', ['Record', 'Schema']),
#     ('hyperweb.types.',  '$', ['Object', 'Class', 'String', 'Dict', 'Link']),
#     ('hyperweb.core.',   '$', ['Item', 'Category', 'Site', 'Application', 'Space']),
#     ('builtins.',        '!', ['type', 'set', 'str'])
# ]
