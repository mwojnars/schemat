"""
Custom implementation of JSON-pickling of objects of arbitrary classes.
"""

import json
from nifty.util import isbound


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
    
    # name of attribute that stores a class name (with package) inside JSON dumps
    CLASS_ATTR = "@"
    
    aliases     = None      # dict that maps full names of selected classes to their short names for use in JSON strings
    aliases_rev = None      # like `aliases`, but reversed: short name -> full name
    
    def __init__(self, aliases = None):
        
        self.aliases = aliases or {}
        self.aliases_rev = {short: full for full, short in self.aliases.items()}
        if len(self.aliases_rev) < len(self.aliases):
            raise Exception("The dict of aliases contains duplicate values in JsonPickle.__init__():", aliases)
    
    def dumps(self, obj, **kwargs):
        # kwargs.setdefault('separators', (',', ':'))     # most compact separators (no whitespace)
        kwargs.setdefault('ensure_ascii', False)        # non-ascii chars left as UTF-8
        return json.dumps(obj, default = self._getstate, **kwargs)
    
    def loads(self, dump, **kwargs):
        return json.loads(dump, object_hook = self._decode, **kwargs)
        
        # # recursively convert dicts containing CLASS_ATTR to instances of corresponding classes
        # return self._decode(obj)
    
    def _getstate(self, obj):
        """
        Retrieve object's state with __getstate__(), or take it from __dict__.
        Append class name in the resulting dictionary.
        """

        def with_classname(_state):
            cls = obj.__class__
            classname = cls.__module__ + "." + cls.__name__
            classname = self.aliases.get(classname, classname)
            _state = _state.copy()
            _state[JsonPickle.CLASS_ATTR] = classname
            return _state

        getstate = getattr(obj, '__getstate__', None)

        # call __getstate__() if present and bound;
        # 'obj' can be a class! then __getstate__ is present but unbound
        if hasattr(getstate, '__self__'):
            state = getstate()
            if isinstance(state, dict): return with_classname(state)
            raise TypeError(f"The result of __getstate__() is not a dict in {obj}")
            # return {'__state__': state}                         # wrap up a non-dict state in dict

        # otherwise use __dict__
        else:
            state = getattr(obj, '__dict__', None)
            if state is None:
                raise TypeError(f"__dict__ not present in {obj}")
            else:
                return with_classname(state)
        
    def _decode(self, value):

        classname = value.pop(self.CLASS_ATTR, None)
        if not classname: return value

        # load class by its full name
        classname = self.aliases_rev.get(classname, classname)
        try:
            cls = self._import(classname)
        except:
            print(f"WARNING in JsonPickle._decode(): failed to load class '{classname}', no decoding")
            return value
            
        # create an object
        obj = cls()
        setstate = getattr(obj, '__setstate__', None)
        if setstate:
            setstate(value)
        else:
            obj.__dict__ = value
        return obj
        
    # def _decode(self, value):
    #     """
    #     If `value` is a dict with CLASS_ATTR, convert it to an object of a corresponding class.
    #     Apply _decode recursively to nested collections.
    #     """
    #     if isinstance(value, dict):
    #
    #         classname = value.pop(self.CLASS_ATTR, None)
    #
    #         # convert nested collections
    #         value = {key: self._decode(val) for key, val in value.items()}
    #         if not classname: return value
    #
    #         # load class by its name
    #         try:
    #             cls = self._import(classname)
    #         except:
    #             print(f"WARNING in JsonPickle._decode(): failed to load class '{classname}', no decoding")
    #             return value
    #
    #         # create an object
    #         obj = cls()
    #         setstate = getattr(obj, '__setstate__', None)
    #         if setstate:
    #             setstate(value)
    #         else:
    #             obj.__dict__ = value
    #         return obj
    #
    #     elif isinstance(value, list):
    #         return list(map(self._decode, value))
    #     else:
    #         return value
        
    def _import(self, classname):
        """
        Dynamic import of a class given its full (dotted) package-module-class name.
        If no module name is present, __main__ is used.
    
        >>> JsonPickle()._import('nifty.util.Object')
        <class 'nifty.util.Object'>
        """
        if '.' not in classname:
            mod, name = '__main__', classname
            #raise Exception("Can't import an object without module/package name: %s" % path)
        else:
            mod, name = classname.rsplit('.', 1)
        module = __import__(mod, fromlist = [mod])
        return getattr(module, name)
        
        
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
        def f(self): return 1
    
    c = C()
    c.d = C()
    c.y = [3,4,'5']
    
    s = dumps([{'a':1, 'łąęńÓŚŹŻ':2, 3:[]}, None, c])
    print(s)
    d = loads(s)
    print(d)
    print(d[-1].d, d[-1].y)
    