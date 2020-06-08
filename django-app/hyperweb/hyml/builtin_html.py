from six import reraise, string_types, text_type
from six.moves import builtins

from hyperweb.hyml.errors import BodyDisallowed


########################################################################################################################################################

class Hypertag:
    """
    A tag (hypertag) behaves like a function with a few extensions:
    - it accepts unnamed body in "__body__" argument, which contains a markup value; some tags may expect body to be empty
    - it may accept any number of named sections passed in "__NAME__" arguments; they contain markup values
    - it may accept any number of plain (non-markup) arguments
    - it should always return an unnamed markup value; additionally, it may return a dict of named markup values (sections) ??
    """
    __hypertag__ = True
    
    def expand(self, __body__, *args, **kwargs):
        """
        Subclasses should assume zero-level indentation for the output string
        (proper indentation will be added by caller).
        __body__ can be an inline string (no leading \n) or an outlined block
        (contains leading \n and may contain multiple lines with relative indentation included).
        No trailing \n should be added to the returned output.
        """
        raise NotImplementedError


class HTMLTag(Hypertag):
    
    name = None         # tag name
    void = False        # if True, __body__ is expected to be empty and the returned element is self-closing
    
    def expand(self, __body__, *args, **kwargs):
        
        name = self.name
        # __body__ = __body__.render()
        
        if self.void:
            if __body__: raise BodyDisallowed(f"body must be empty for a void HTML tag <{name}>")
            return f"<{name} />"
        else:
            return f"<{name}>{__body__}</{name}>"


########################################################################################################################################################

BUILTIN_HTML = {
    
    # tags are added dynamically, below
    
    # objects
    'python':       builtins,       # Python built-ins accessible through python.* even if a given symbol has different meaning in HyML
    
    'str':          text_type,      # $str(var) -- string representation of an object, always in Unicode
    'len':          len,            # $len(s)
    'range':        range,

}

_HTML_TAGS_VOID    = "area base br col embed hr img input link meta param source track wbr".split()
_HTML_TAGS_NONVOID = "a abbr acronym address applet article aside audio b basefont bdi bdo big blockquote body " \
                     "button canvas caption center cite code colgroup data datalist dd del details dfn dialog dir " \
                     "div dl dt em fieldset figcaption figure font footer form frame frameset h1 h2 h3 h4 h5 h6 " \
                     "head header html i iframe ins kbd label legend li main map mark meter nav noframes noscript " \
                     "object ol optgroup option output p picture pre progress q rp rt ruby s samp script section " \
                     "select small span strike strong style sub summary sup svg table tbody td template textarea " \
                     "tfoot th thead time title tr tt u ul var video".split()

def _create_tag(name_, void_):
    class _html_tag(HTMLTag):
        name = name_
        void = void_
    BUILTIN_HTML[name_] = _html_tag()

def _create_all_tags():
    for tag in _HTML_TAGS_NONVOID:
        _create_tag(tag.lower(), False)
        _create_tag(tag.upper(), False)
    for tag in _HTML_TAGS_VOID:
        _create_tag(tag.lower(), True)
        _create_tag(tag.upper(), True)
    
    
###  append all HTML tags to BUILTIN_HTML

_create_all_tags()
