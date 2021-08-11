"""
Custom Python types for storing elementary values of item properties.
"""

from hypertag import HyperHTML


#####################################################################################################################################################
#####
#####  RICH TEXT
#####

class text(str):
    """
    Localized rich text. Stores information about the language of the string, as well as its rich-text
    encoding: markup language, wiki language etc. Both can be missing (None), in such case the `text`
    instance is equivalent to a plain string <str>.
    """
    markup   = None         # markup language of the text: plaintext, html, ...
    language = None         # human language of the text: pl, en, de, ...
    
    def __new__(cls, *args, **kwargs):
        markup = kwargs.pop('markup', None)
        language = kwargs.pop('language', None)

        s = str.__new__(cls, *args, **kwargs)

        if markup: s.markup = markup
        if language: s.language = language
        return s

    # def __init__(self, *args, markup = None, language = None):
    #     # str.__init__(self)      # t
    #     if markup: self.markup = markup
    #     if language: self.language = language
    
class html(text):
    markup = "html"

class code(text):
    """"""
    
    def highlight(self):
        """Returns HTML of the code after syntax highlighting."""
    

class hypertag:
    """Thin wrapper around a Hypertag script. Allows its translation and rendering through a preconfigured runtime."""
    
    runtime = HyperHTML()           # standard default class-global Hypertag runtime

    def __init__(self, script, runtime = None):
        self.script = script
        if runtime: self.runtime = runtime

    def translate(self, *args, **context):
        return self.runtime.translate(self.script, *args, **context)

    def render(self, *args, **context):
        return self.runtime.render(self.script, *args, **context)


#####################################################################################################################################################
#####
#####  CATALOG & STRUCT
#####

class catalog(dict):
    """
    Base class for any special-purpose dictionary that provides custom functionality
    and assumes that keys are strings.
    Subclasses can be used as `type` inside CATALOG schema.
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


# # rules for detecting disallowed attribute names in category schema definitions
# STOP_ATTR = {
#     'special':      (lambda attr: attr[0] == '_'),
#     'reserved':     (lambda attr: attr in 'load insert update save'),
#     'multidict':    (lambda attr: attr.endswith(MULTI_SUFFIX)),
# }

# re_codename = re.compile(r'^[a-zA-Z][a-zA-Z0-9_-]*$')         # valid codename of a space or category

