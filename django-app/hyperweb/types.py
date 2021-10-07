"""
Custom data structures for use as values of item properties.
"""


#####################################################################################################################################################
#####
#####  CATALOG & STRUCT
#####

class catalog(dict):
    """
    Base class for any special-purpose dictionary that provides custom functionality
    and assumes that keys are strings. Subclasses can be used as `type` inside CATALOG schema.
    """

struct = catalog        # for now, `struct` is just an alias for `catalog`; this can change in the future

# class struct(dict):
#     """Similar to a catalog, but may only contain keys from a fixed predefined set."""
#
# class rich_catalog(list):
#     """A mapping of (string) keys to values that additionally allows repeated keys."""



#####################################################################################################################################################
#####
#####  RICH TEXT
#####

# class text(str):
#     """
#     Localized rich text. Stores information about the language of the string, as well as its rich-text
#     encoding: markup language, wiki language etc. Both can be missing (None), in such case the `text`
#     instance is equivalent to a plain string <str>.
#     """
#     markup   = None         # markup language of the text: plaintext, html, ...
#     language = None         # human language of the text: pl, en, de, ...
#
#     def __new__(cls, *args, **kwargs):
#         markup = kwargs.pop('markup', None)
#         language = kwargs.pop('language', None)
#
#         s = str.__new__(cls, *args, **kwargs)
#
#         if markup: s.markup = markup
#         if language: s.language = language
#         return s
#
#     # def __init__(self, *args, markup = None, language = None):
#     #     # str.__init__(self)      # t
#     #     if markup: self.markup = markup
#     #     if language: self.language = language
#
# class html(text):
#     markup = "html"
#
# class code(text):
#     """"""
#
#     def highlight(self):
#         """Returns HTML of the code after syntax highlighting."""
#
#
# class hypertag:
#     """Thin wrapper around a Hypertag script. Allows its translation and rendering through a preconfigured runtime."""
#
#     runtime = HyperHTML()           # standard default class-global Hypertag runtime
#
#     def __init__(self, script, runtime = None):
#         self.script = script
#         if runtime: self.runtime = runtime
#
#     def translate(self, *args, **context):
#         return self.runtime.translate(self.script, *args, **context)
#
#     def render(self, *args, **context):
#         return self.runtime.render(self.script, *args, **context)


