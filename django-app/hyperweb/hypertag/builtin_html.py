from six import reraise, string_types, text_type
from six.moves import builtins
from xml.sax.saxutils import quoteattr

from hyperweb.hypertag.document import Sequence
from hyperweb.hypertag.errors import VoidTagEx
from hyperweb.hypertag.tag import ExternalTag


########################################################################################################################################################
#####
#####  HTML TAG
#####

class HTMLTag(ExternalTag):
    
    name = None         # tag name
    void = False        # if True, __body__ is expected to be empty and the returned element is self-closing
    mode = 'HTML'       # (X)HMTL compatibility mode: either 'HTML' or 'XHTML'
    
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
            # if the block contains a headline, the closing tag is placed on the same line as __body__
            assert isinstance(__body__, Sequence)
            body = __body__.render()
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

BUILTIN_HTML = {
    
    # tags are added dynamically, below
    
    # objects
    'python':       builtins,       # Python built-ins accessible through python.* even if a given symbol has different meaning in HyML
    
    'str':          text_type,      # $str(var) -- string representation of an object, always in Unicode
    'len':          len,            # $len(s)
    'range':        range,
    'set':          set,
    'dict':         dict,
    'list':         list,
}

BUILTIN_XHTML = BUILTIN_HTML.copy()


_HTML_TAGS_VOID    = "area base br col embed hr img input link meta param source track wbr".split()
_HTML_TAGS_NONVOID = "a abbr acronym address applet article aside audio b basefont bdi bdo big blockquote body " \
                     "button canvas caption center cite code colgroup data datalist dd del details dfn dialog dir " \
                     "div dl dt em fieldset figcaption figure font footer form frame frameset h1 h2 h3 h4 h5 h6 " \
                     "head header html i iframe ins kbd label legend li main map mark meter nav noframes noscript " \
                     "object ol optgroup option output p picture pre progress q rp rt ruby s samp script section " \
                     "select small span strike strong style sub summary sup svg table tbody td template textarea " \
                     "tfoot th thead time title tr tt u ul var video".split()

def _create_tag(name_, void_, mode_):
    class _html_tag(HTMLTag):
        name = name_
        void = void_
        mode = mode_
    return _html_tag()

def _create_tag_triple(name_, void_):
    lname, uname = name_.lower(), name_.upper()
    BUILTIN_XHTML[lname] = _create_tag(lname, void_, 'XHTML')
    BUILTIN_HTML[lname]  = _create_tag(lname, void_, 'HTML')
    BUILTIN_HTML[uname]  = _create_tag(uname, void_, 'HTML')

def _create_all_tags():
    # HTML tags
    for tag in _HTML_TAGS_NONVOID:
        _create_tag_triple(tag, False)
    for tag in _HTML_TAGS_VOID:
        _create_tag_triple(tag, True)
    
    
###  append all (X)HTML tags to BUILTIN_HTML and BUILTIN_XHTML

_create_all_tags()
