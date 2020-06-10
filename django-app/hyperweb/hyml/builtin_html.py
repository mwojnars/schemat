from six import reraise, string_types, text_type
from six.moves import builtins
from xml.sax.saxutils import quoteattr

from hyperweb.hyml.errors import VoidTag


########################################################################################################################################################
###  SDK

class ExternalTag:
    """
    External tag, i.e., a (hyper)tag defined as a python function.
    Every tag behaves like a function, with a few extensions:
    - it accepts unnamed body in "__body__" argument, which contains a markup value; some tags may expect body to be empty
    - it may accept any number of named sections passed in "__NAME__" arguments; they contain markup values
    - it may accept any number of plain (non-markup) arguments
    - it should always return an unnamed markup value; additionally, it may return a dict of named markup values (sections) ??
    """
    
    def expand(self, __body__, *args, **kwargs):
        """
        Subclasses should NOT append trailing \n nor add extra indentation during tag expansion
        - both things will be added by the caller later on, if desired so by programmer.
        
        :param __body__: rendered main body of tag occurrence, as a string; if a tag is void (doesn't accept body),
                         it may check whether __body__ is empty and raise VoidTag exception if not
        :param __sections__: dict of {section_name: section_body}, can be empty
        :param args, kwargs: tag-specific arguments, listed directly in subclasses and/or using *args/**kwargs notation
        :return: string containing tag output; optionally, it can be accompanied with a dict of (modified) section bodies,
                 as a 2nd element of a pair (output_body, output_sections); if output_sections are NOT explicitly returned,
                 they are assumed to be equal __sections__; also, the __sections__ dict CAN be modified *in place*
                 and returned without copying
        """
        raise NotImplementedError


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
            if __body__: raise VoidTag(f"body must be empty for a void tag <{name}>")
            return f"<{tag} />"
        else:
            return f"<{tag}>" + __body__ + f"</{name}>"

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
