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

class struct(dict):
    """"""
    
    def __getattr__(self, field):
        return self[field]
    
    def __setattr__(self, field, value):
        self[field] = value
