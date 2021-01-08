from nifty.text import html_escape

from hypertag.core.runtime import Runtime, _read_module
import hypertag.HTML


########################################################################################################################################################
#####
#####  HTML runtime
#####


class HypertagHTML(Runtime):
    
    language = 'HTML'
    escape   = staticmethod(html_escape)
    
    DEFAULT = Runtime.DEFAULT.copy()
    DEFAULT.update(_read_module(hypertag.HTML))
    