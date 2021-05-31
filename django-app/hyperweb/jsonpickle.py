"""
Custom implementation of JSON-pickling of objects of arbitrary classes.
"""

import json
from importlib import import_module

from hyperweb.errors import DecodeError


#####################################################################################################################################################
#####
#####  JSONPICKLE
#####

class JsonPickle:
    """
    Custom implementation of JSON-pickling of objects of arbitrary classes.
    Primitive types are
    
    To be serializable AND deserializable, a class must provide:
    1) __dict__, or __getstate__() that returns a dict
    2) __init__ can be called without arguments
    3) optionally: __setstate__(); if this is not provided, __dict__ will be assigned directly,
       without any further initialization / postprocessing.
       
    TODO: Items occuring inside the data are serialized as references (ID only, no contents),
    and retrieved back from the Registry during deserialization.
    
    By default, JsonPickle leaves non-ASCII characters in their original form (no encoding),
    which is compatible with MySQL: JSON columns use utf8mb4 charset.
    """
    
    # special attribute that stores a class name (with package) in a dict {} object inside JSON dumps
    CLASS_ATTR = "@"
    
    # special attribute that stores a non-dict state of data types normally not handled by JSON: tuple, set, type ...
    STATE_ATTR = "="
    
    
    def dumps(self, obj, **kwargs):
        # kwargs.setdefault('separators', (',', ':'))     # most compact separators (no whitespace)
        kwargs.setdefault('ensure_ascii', False)        # non-ascii chars left as UTF-8
        return json.dumps(obj, default = self._encode, **kwargs)
    
    def loads(self, dump, **kwargs):
        return json.loads(dump, object_hook = self._decode, **kwargs)
        
        # # recursively convert dicts containing CLASS_ATTR to instances of corresponding classes
        # return self._decode(obj)
    
    def _encode(self, obj):
        return self.getstate(obj, self.CLASS_ATTR, self.STATE_ATTR)
        
        
    def _decode(self, value):

        classname = value.pop(self.CLASS_ATTR, None)
        if not classname: return value

        # load class by its full name
        try:
            cls = self.import_(classname)
        except:
            raise DecodeError(f"failed to load class '{classname}' during decoding")
            # print(f"WARNING in JsonPickle._decode(): failed to load class '{classname}', no decoding")
            # return value
            
        # create an object with `value` as its state
        return self.setstate(cls, value, state_attr = self.STATE_ATTR)
        
    ##############
    
    @staticmethod
    def import_(fullname):
        """
        Dynamic import of a python class/function/variable given its full (dotted) package-module name.
        If no module name is present, __main__ is used.
        """
        if '.' not in fullname:
            mod, name = '__main__', fullname
            #raise Exception("Can't import an object without module/package name: %s" % path)
        else:
            mod, name = fullname.rsplit('.', 1)
        # if mod == "builtins":
        #     return getattr(globals()['__builtins__'], name)
        module = import_module(mod) #, fromlist = [mod])
        try:
            return getattr(module, name)
        except:
            raise ImportError(f"cannot import name '{name}' from '{mod}'")
        
    @staticmethod
    def classname(obj = None, cls = None):
        """Fully qualified class name of an object 'obj' or class 'cls'."""
        if cls is None: cls = obj.__class__
        name = cls.__module__ + "." + cls.__name__
        return name
    
    @staticmethod
    def getstate(obj, class_attr = None, state_attr = None):
        """
        Retrieve object's state with __getstate__(), or take it from __dict__.
        Append class name in the resulting dictionary, if needed, and if `class_attr` is provided.
        `obj` shall not be an instance of a standard JSON-serializable type: int/float/list/tuple/dict/NoneType...
        """
        getstate_method = getattr(obj, '__getstate__', None)
    
        # call __getstate__() if present and bound;
        # 'obj' can be a class! then __getstate__ is present but unbound
        if hasattr(getstate_method, '__self__'):
            state = getstate_method()
            if not isinstance(state, dict):
                raise TypeError(f"The result of __getstate__() is not a dict in {obj}")
            # return with_classname(state)
            
        # TODO: when `obj` is a
        
        # otherwise check against other standard types, normally not JSON-serializable
        elif getattr(obj, '__class__', None) in (set, type):
            cls = obj.__class__
            if cls is set:
                state = sorted(obj)         # sorting of values is applied to ensure unique output representation of the set
            elif cls is type:
                state = JsonPickle.classname(cls = obj)
            else:
                assert 0
            
            state = {state_attr: state}
            # return with_classname(state)
    
        # otherwise use __dict__
        else:
            state = getattr(obj, '__dict__', None)
            if state is None:
                raise TypeError(f"__dict__ not present in {obj}")
            # else:
            #     return with_classname(state)
        
        if class_attr is None: return state

        # append class name to `state`
        assert class_attr not in state
        state = state.copy()
        state[class_attr] = JsonPickle.classname(obj)
        return state
        
    @staticmethod
    def setstate(cls, state, state_attr = None):
        """
        Create an object of a given class and set its state using __setstate__(), if present,
        or by assigning directly to __dict__ otherwise.
        """
        
        # handle special classes: set, type
        if cls is type:
            name = state[state_attr]
            return JsonPickle.import_(name)
        if cls is set:
            values = state[state_attr]
            return set(values)
    
        # instantiate and fill out an object of a custom class
        obj = cls()
        _setstate = getattr(obj, '__setstate__', None)
        if _setstate:
            _setstate(state)
        else:
            obj.__dict__ = state
        return obj


#####################################################################################################################################################
#####
#####  GLOBAL
#####

_default_encoder = JsonPickle()

def dumps(*args, **kwargs): return _default_encoder.dumps(*args, **kwargs)
def loads(*args, **kwargs): return _default_encoder.loads(*args, **kwargs)

#####################################################################################################################################################

if __name__ == "__main__":
    
    def dumpload(obj):
        print('object:  ', obj)
        s = dumps(obj)
        print('dump:    ', s)
        d = loads(s)
        print('reloaded:', d)
        return d
    
    class C:
        x = 5.0
        s = {'A','B','C'}
        t = (1,2,3)
        def f(self): return 1
    
    c = C()
    c.d = C()
    c.y = [3,4,'5']
    
    d = dumpload([{'a':1, 'łąęńÓŚŹŻ':2, 3:[]}, None, c, C])
    print(d[2].d, d[2].y)
    print()
    
    dumpload({"@": "xyz", "v": 5})
