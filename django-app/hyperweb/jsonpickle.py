"""
Custom implementation of JSON-pickling of objects of arbitrary classes.
"""

import json
from hyperweb.errors import DecodeError


#####################################################################################################################################################
#####
#####  JSONPICKLE
#####

class JsonPickle:
    """
    Custom implementation of JSON-pickling of objects of arbitrary classes.
    To be serializable AND deserializable, a class must provide:
    1) __dict__, or __getstate__() that returns a dict
    2) __init__ can be called without arguments
    3) optionally: __setstate__(); if this is not provided, __dict__ will be assigned directly
       and all its contents assigned during __init__() - if any - will be lost.
       
    By default, JsonPickle leaves non-ASCII characters in their original form (no encoding),
    which is compatible with MySQL: JSON columns use utf8mb4 charset.
    """
    
    # special attribute that stores a class name (with package) in a dict {} object inside JSON dumps
    CLASS_ATTR = "@"
    
    # special attribute that stores a non-dict state of data types normally not handled by JSON: tuple, set, type ...
    STATE_ATTR = "="
    
    def __init__(self):
        from hyperweb.globals import aliases
        self.aliases = aliases

    def dumps(self, obj, **kwargs):
        # kwargs.setdefault('separators', (',', ':'))     # most compact separators (no whitespace)
        kwargs.setdefault('ensure_ascii', False)        # non-ascii chars left as UTF-8
        return json.dumps(obj, default = self._getstate, **kwargs)
    
    def loads(self, dump, **kwargs):
        return json.loads(dump, object_hook = self._decode, **kwargs)
        
        # # recursively convert dicts containing CLASS_ATTR to instances of corresponding classes
        # return self._decode(obj)
    
    def _getstate(self, obj):
        return self.aliases.getstate(obj, self.CLASS_ATTR, self.STATE_ATTR)
        
        
    def _decode(self, value):

        classname = value.pop(self.CLASS_ATTR, None)
        if not classname: return value

        # load class by its full name
        try:
            cls = self.aliases.import_(classname)
        except:
            raise DecodeError(f"failed to load class '{classname}' during decoding")
            # print(f"WARNING in JsonPickle._decode(): failed to load class '{classname}', no decoding")
            # return value
            
        # create an object with `value` as its state
        return self.aliases.setstate(cls, value, state_attr = self.STATE_ATTR)
        

#####################################################################################################################################################
#####
#####  GLOBAL
#####

_default_encoder = JsonPickle()

def dumps(*args, **kwargs): return _default_encoder.dumps(*args, **kwargs)
def loads(*args, **kwargs): return _default_encoder.loads(*args, **kwargs)

#####################################################################################################################################################

if __name__ == "__main__":
    
    class C:
        x = 5.0
        s = {'A','B','C'}
        t = (1,2,3)
        def f(self): return 1
    
    c = C()
    c.d = C()
    c.y = [3,4,'5']
    
    s = dumps([{'a':1, 'łąęńÓŚŹŻ':2, 3:[]}, None, c, C])
    print(s)
    d = loads(s)
    print(d)
    print(d[2].d, d[2].y)
    