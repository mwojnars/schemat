"""
Custom Python types for storing elementary values of item properties.
"""


#####################################################################################################################################################
#####
#####  Python types
#####

class text(str):
    """
    Localized rich text. Stores information about the language of the string, as well as its rich-text
    encoding: markup language, wiki language etc. Both can be missing (None), in such case the `text`
    instance is equivalent to a plain string <str>.
    """

class catalog(dict):
    """
    Base class for any special-purpose dict class that provides custom functionality
    and assumes that keys are strings.
    Subclasses can be used as `type` inside Catalog schema.
    """

class struct(catalog):
    """
    A <catalog> that allows attribute-like access to items: data.X is equivalent to data['X'],
    in reads and assignments alike.
    """
    
    def __getattr__(self, field):
        return self[field]
    
    def __setattr__(self, field, value):
        self[field] = value

def item_schema(catalog):
    """
    Schema of items in a category: a dictionary of field names and their individual schemas.
    Provides methods for schema-aware encoding and decoding of items,
    with every field value encoded through its dedicated field-specific schema.
    """

# # rules for detecting disallowed attribute names in category schema definitions
# STOP_ATTR = {
#     'special':      (lambda attr: attr[0] == '_'),
#     'reserved':     (lambda attr: attr in 'load insert update save'),
#     'multidict':    (lambda attr: attr.endswith(MULTI_SUFFIX)),
# }

# re_codename = re.compile(r'^[a-zA-Z][a-zA-Z0-9_-]*$')         # valid codename of a space or category

