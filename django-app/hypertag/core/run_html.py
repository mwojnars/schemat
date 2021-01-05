import re
from six import reraise, string_types, text_type
from six.moves import builtins
from nifty.text import html_escape

from hypertag.core.dom import Sequence, get_indent, del_indent
from hypertag.core.runtime import Runtime
from hypertag.core.tag import ExternalTag, MarkupTag
from hypertag.core.grammar import TAGS, VARS


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
- dedent full=False   -- remove leading indentation of a block, either at the top level only (full=False), or at all nested levels (full=True)
- unique strip=True   -- render body to text and remove duplicate lines (or blocks?)
- unique_lines
- unique_blocks
- css                 -- marks its content as a CSS script that shall be moved to a <style> section of the document
- js                  -- JavaScript code to be put into a <script> section
- error               -- inserts a standard error message in a place of occurrence; root document node might collect all <error> nodes and produce a combined (hidden) error message
"""

class DedentTag(ExternalTag):
    text = True
    def expand(self, text, nested = True, _re_indent = re.compile(r'(?m)^\s+')):
        if nested: return _re_indent.sub('', text)
        return del_indent(text, get_indent(text))
        
class JavascriptTag(ExternalTag):
    """Typically, a `javascript` tag should be used with verbatim (!...) contents inside."""
    text = True

    _block = del_indent("""
        <script type="text/javascript">
        <!--
        %s
        -->
        </script>
    """.strip())
    
    def expand(self, js_code):
        return self._block % js_code
        

def _unique():
    pass

BUILTIN_TAGS = {
    'dedent':       DedentTag,
    'javascript':   JavascriptTag,
}

# instantiate tag classes
for name, tag in BUILTIN_TAGS.items():
    if isinstance(tag, type):
        BUILTIN_TAGS[name] = tag()
        

########################################################################################################################################################
#####
#####  HTML runtime
#####


class HypertagHTML(Runtime):
    
    language = 'HTML'
    escape   = staticmethod(html_escape)
    
    PATH_HTML = 'HTML'
    standard_modules = Runtime.standard_modules.copy()
    standard_modules[PATH_HTML] = TAGS(BUILTIN_HTML)

    DEFAULT = {}
    DEFAULT.update(Runtime.DEFAULT)
    DEFAULT.update(TAGS(BUILTIN_TAGS))
    DEFAULT.update(TAGS(BUILTIN_HTML))
    