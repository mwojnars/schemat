"""
Utilities for JSON-pickling and serialization of objects of arbitrary classes.

TODO: the functions below could be implemented as methods of Registry to allow customization in the future.

"""

import json
from importlib import import_module
from .errors import EncodeError, DecodeError


#####################################################################################################################################################
#####
#####  UTILITIES
#####

def classname(obj = None, cls = None):
    """Fully qualified class name of an object 'obj' or class 'cls'."""
    if cls is None: cls = obj.__class__
    name = cls.__module__ + "." + cls.__name__
    return name

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

def getstate(obj):
    """
    Retrieve object's state with __getstate__() or take it from __dict__.
    `obj` shall not be an instance of a standard type: int/float/list/tuple/dict/NoneType...
    """
    getstate_method = getattr(obj, '__getstate__', None)

    # call __getstate__() if present and bound ('obj' shall be an instance not a class)
    if getstate_method:
        if not hasattr(getstate_method, '__self__'): raise TypeError(f'expected an instance in getstate(), got a class')
        state = getstate_method()
        if not isinstance(state, dict):
            raise TypeError(f"The result of __getstate__() is not a dict in {obj}")
        
    # otherwise use __dict__
    else:
        state = getattr(obj, '__dict__', None)
        if state is None:
            raise TypeError(f"cannot retrieve state of an object of type <{type(obj)}>: {obj}")
    
    return state
    
def setstate(cls, state):
    """
    Create an object of a given class and set its state using __setstate__(), if present,
    or by assigning directly to __dict__ otherwise.
    """
    
    # instantiate and fill out an object of a custom class
    obj = cls()
    _setstate = getattr(obj, '__setstate__', None)
    if _setstate:
        _setstate(state)
    else:
        try:
            obj.__dict__ = dict(state)
        except:
            raise
            # raise TypeError(f"cannot assign state to an object of type <{cls}>, the state: {state}")
        
    return obj


#####################################################################################################################################################
#####
#####  JSON for arbitrary objects
#####

class JSONx:
    """
    Dump & load arbitrary objects to/from JSON strings.
    Encode & decode arbitrary objects to/from JSON-compatible "state" composed of serializable types.
    """
    
    FLAG_ITEM  = "(item)"   # special value of ATTR_CLASS that denotes a reference to an Item
    FLAG_DICT  = "(dict)"   # special value of ATTR_CLASS that denotes a dict wrapper for another dict containing the reserved "@" key
    ATTR_CLASS = "@"        # special attribute appended to object state to store a class name (with package) of the object being encoded
    ATTR_STATE = "="        # special attribute to store a non-dict state of data types not handled by JSON: tuple, set, type ...
    # PRIMITIVES = (bool, int, float, str, type(None))        # objects of these types are left unchanged during encoding
    
    @classmethod
    def dump(self, obj, type_ = None):
        state = JSONx.encode(obj, type_)
        return json.dumps(state, ensure_ascii = False)
    
    @classmethod
    def load(self, dump, type_ = None):
        state = json.loads(dump)
        return JSONx.decode(state, type_)
    
    @classmethod
    def encode(self, obj, type_ = None):
        """
        Return a `state` that carries all the information needed for reconstruction of `obj` with decode(),
        yet it contains only JSON-compatible values and collections (possibly nested).
        Objects of custom classes are converted to dicts that store object's attributes,
        with a special attribute "@" added to hold the class name. Nested objects are encoded recursively.
        """
        t = type(obj)
        
        # retrieve object's state while checking against standard python types that need special handling
        if t in JSONx.PRIMITIVES:    return obj
        if t is list:               return JSONx.encode_list(obj)        # return a list, but first encode recursively all its elements

        if t is dict:
            obj = JSONx.encode_dict(obj)                                 # encode_dict() always returns a dict
            #assert isinstance(obj, dict)
            if JSONx.ATTR_CLASS not in obj: return obj
            return {JSONx.ATTR_STATE: obj, JSONx.ATTR_CLASS: JSONx.FLAG_DICT}      # an "escape" wrapper is added around a dict that contains the reserved key "@"

        from hyperweb.item import Item
        if issubclass(t, Item):
            if None in obj.id: raise EncodeError(f'non-serializable Item instance with missing or incomplete ID: {obj.id}')
            id = list(obj.id)
            if t is type_: return id
            return {JSONx.ATTR_STATE: id, JSONx.ATTR_CLASS: JSONx.FLAG_ITEM}
        
        from hyperweb.boot import registry

        if isinstance(obj, type):
            state = registry.get_path(obj)
            return {JSONx.ATTR_STATE: state, JSONx.ATTR_CLASS: JSONx.FLAG_TYPE}
        elif t in (set, tuple):
            state = JSONx.encode_list(obj)                       # warning: ordering of elements of a set in `state` is undefined and may differ between calls
        else:
            state = getstate(obj)                               # TODO: allow non-dict state from getstate()
            state = JSONx.encode_dict(state)                     # recursively encode all non-standard objects inside `state`
            #assert isinstance(state, dict)
            if JSONx.ATTR_CLASS in state:
                raise EncodeError(f'non-serializable object state, a reserved character "{JSONx.ATTR_CLASS}" occurs as a key in the state dictionary')
            
        # if the exact class is known upfront, let's output compact state without adding "@" for class designation
        if t is type_: return state
        
        # wrap up in a dict and append class designator
        if not isinstance(state, dict):
            state = {JSONx.ATTR_STATE: state}
        state[JSONx.ATTR_CLASS] = registry.get_path(obj.__class__)
        
        return state
    
    @classmethod
    def decode(self, state, type_ = None):
        """Reverse operation to encode(): takes an encoded JSON-serializable `state` and converts back to an object."""

        t = type(state)
        
        # decoding of a wrapped-up dict that contained a pre-existing '@' key
        if t is dict and state.get(JSONx.ATTR_CLASS, None) == JSONx.FLAG_DICT:
            if JSONx.ATTR_STATE in state:
                state = state[JSONx.ATTR_STATE]                      # `state` was a dict-wrapper around an actual dict
            return JSONx.decode_dict(state)

        from hyperweb.boot import registry

        # determine the expected type `class_` of the output object
        if type_:
            if t is dict and JSONx.ATTR_CLASS in state and JSONx.ATTR_STATE not in state:
                raise DecodeError(f'ambiguous object state during decoding, the special key "{JSONx.ATTR_CLASS}" is not needed but present: {state}')
            klass = type_

        elif t is not dict:
            klass = t              # an object of a standard python type must have been encoded (non-unique type, but not a dict either)

        elif JSONx.ATTR_CLASS not in state:
            klass = dict
            # raise DecodeError(f'corrupted object state during decoding, missing "{JSON.ATTR_CLASS}" key with object type designator: {state}')
        else:
            fullname = state.pop(JSONx.ATTR_CLASS)
            if JSONx.ATTR_STATE in state:
                state_attr = state.pop(JSONx.ATTR_STATE)
                if state: raise DecodeError(f'invalid serialized state, expected only {JSONx.ATTR_CLASS} and {JSONx.ATTR_STATE} special keys but got others: {state}')
                state = state_attr

            if fullname == JSONx.FLAG_ITEM:                  # decoding a reference to an Item?
                return registry.get_item(state)             # ...get it from the Registry
            klass = registry.get_class(fullname)
            
        # instantiate the output object; special handling for standard python types and Item
        if klass in JSONx.PRIMITIVES:
            return state
        if klass is list:
            return JSONx.decode_list(state)
        if klass is dict:
            return JSONx.decode_dict(state)
        if klass in (set, tuple):
            values = state
            return klass(values)
        if isinstance(klass, type):
            from .item import Item
            if issubclass(klass, Item):
                return registry.get_item(state)       # get the referenced item from the Registry
            if issubclass(klass, type):
                typename = state
                return registry.get_class(typename)

        # default object decoding via setstate()
        state = JSONx.decode_dict(state)
        return setstate(klass, state)
        
        
    @classmethod
    def encode_list(self, values):
        """Encode recursively all non-primitive objects inside a list."""
        return [JSONx.encode(v) for v in values]
        
    @classmethod
    def decode_list(self, state):
        """Decode recursively all non-primitive objects inside a list."""
        return [JSONx.decode(v) for v in state]
        
    @classmethod
    def encode_dict(self, state):
        """Encode recursively all non-primitive objects inside `state` dictionary."""
        for key in state:
            if type(key) is not str: raise EncodeError(f'non-serializable object state, contains a non-string key: {key}')
            # TODO: if there are any non-string keys in `state`, the entire dict must be converted to a list representation
            
        # return dict((k, JSON.encode(v)) for k, v in state.items())

    @classmethod
    def decode_dict(self, state):
        """Decode recursively all non-primitive objects inside `state` dictionary."""
        # return dict((k, JSON.decode(v)) for k, v in state.items())

    