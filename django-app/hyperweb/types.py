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
    Base class for any special-purpose dict that provides custom functionality.
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

