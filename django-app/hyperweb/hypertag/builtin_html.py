from six import reraise, string_types, text_type
from six.moves import builtins
from xml.sax.saxutils import quoteattr

from hyperweb.hypertag.document import Sequence
from hyperweb.hypertag.errors import VoidTagEx
from hyperweb.hypertag.tag import ExternalTag


########################################################################################################################################################
#####
#####  STANDARD MARKUP TAG
#####

class MarkupTag(ExternalTag):
    """
    A hypertag whose expand() outputs the body unchanged, surrounded by <name>...</name> strings, with proper handling
    of void tags <name /> and HTML/XHTML format differences for boolean attributes.
    This class is used for all built-in (X)HTML tags. It can also be used to define custom markup tags in an application.
    """
    
    name = None         # tag name
    void = False        # if True, __body__ is expected to be empty and the returned element is self-closing
    mode = 'HTML'       # (X)HMTL compatibility mode: either 'HTML' or 'XHTML'
    
    def __init__(self, name, void = False, mode = 'HTML'):
        self.name = name
        self.void = void
        self.mode = mode
    
    def expand(self, __body__, **attrs):
        
        name = self.name
        
        # render attributes
        attrs = filter(None, map(self._render_attr, attrs.items()))
        tag = ' '.join([name] + list(attrs))
        
        # render output
        if self.void:
            if __body__: raise VoidTagEx(f"body must be empty for a void tag <{name}>")
            return f"<{tag} />"
        else:
            assert isinstance(__body__, Sequence)
            body = __body__.render()

            # if the block contains a headline, the closing tag is placed on the same line as __body__
            nl = '\n' if body[:1] == '\n' else ''
            return f"<{tag}>" + body + nl + f"</{name}>"

    def _render_attr(self, name_value):
        
        name, value = name_value
        if value is True:               # name=True   -- converted to:  name (HTML)  or  name="name" (XHTML)
            if self.mode == 'HTML':
                return name
            else:
                return f'{name}="{name}"'
        if value is False:              # name=False  -- removed from attr list
            return None
        
        value = str(value)
        if '"' not in value:
            value = f'"{value}"'
        elif "'" not in value:
            value = f"'{value}'"
        else:
            value = quoteattr(value)    # escaping of <,>,&," chars is performed ONLY when the value contains a quote "
        
        return f'{name}={value}'
        

########################################################################################################################################################
#####
#####  BUILTIN (X)HTML tags
#####

BUILTIN_HTML  = {}
BUILTIN_XHTML = {}

_HTML_TAGS_VOID    = "area base br col embed hr img input link meta param source track wbr".split()
_HTML_TAGS_NONVOID = "a abbr acronym address applet article aside audio b basefont bdi bdo big blockquote body " \
                     "button canvas caption center cite code colgroup data datalist dd del details dfn dialog dir " \
                     "div dl dt em fieldset figcaption figure font footer form frame frameset h1 h2 h3 h4 h5 h6 " \
                     "head header html i iframe ins kbd label legend li main map mark meter nav noframes noscript " \
                     "object ol optgroup option output p picture pre progress q rp rt ruby s samp script section " \
                     "select small span strike strong style sub summary sup svg table tbody td template textarea " \
                     "tfoot th thead time title tr tt u ul var video".split()

def _create_tag_triple(name_, void_):
    lname, uname = name_.lower(), name_.upper()
    BUILTIN_XHTML[lname] = MarkupTag(lname, void_, 'XHTML')
    BUILTIN_HTML[lname]  = MarkupTag(lname, void_, 'HTML')
    BUILTIN_HTML[uname]  = MarkupTag(uname, void_, 'HTML')

def _create_all_tags():
    # HTML tags
    for tag in _HTML_TAGS_NONVOID:
        _create_tag_triple(tag, False)
    for tag in _HTML_TAGS_VOID:
        _create_tag_triple(tag, True)
    
    
###  append all (X)HTML tags to BUILTIN_HTML and BUILTIN_XHTML

_create_all_tags()

########################################################################################################################################################
#####
#####  BUILT-IN functional hypertags
#####

"""
TODO
- dedent all=False    -- remove leading indentation of a block, either at the top level only (all=False), or at all nested levels (all=True)
- unique strip=True   -- render body to text and remove duplicate lines (or blocks?)
- unique_lines
- unique_blocks
- css                 -- marks its content as a CSS script that shall be moved to a <style> section of the document
- js                  -- JavaScript code to be put into a <script> section
- error               -- inserts a standard error message in a place of occurrence; root document node might collect all <error> nodes and produce a combined (hidden) error message
"""

########################################################################################################################################################
#####
#####  BUILTIN variables
#####

BUILTIN_VARS = {
    
    'python':       builtins,       # Python built-ins accessible through python.* even if a given symbol has different meaning in HyML
    
    'str':          text_type,      # $str(var) -- string representation of an object, always in Unicode
    'len':          len,            # $len(s)
    'range':        range,
    'set':          set,
    'dict':         dict,
    'list':         list,
    
    'enumerate':    enumerate,
}

