"""
Utilities for JSON-pickling and serialization of objects of arbitrary classes.

TODO: the functions below could be implemented as methods of Registry to allow customization in the future.

"""

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
#####  ENCODE & DECODE of arbitrary objects to/from JSON-compatible types
#####

class JSON:
    """"""
    
    ITEM_FLAG  = None   # special value of CLASS_ATTR that denotes a reference to an Item
    CLASS_ATTR = "@"    # special attribute appended to object state to store a class name (with package) of the object being encoded
    STATE_ATTR = "="    # special attribute to store a non-dict state of data types not handled by JSON: tuple, set, type ...
    PRIMITIVES = (bool, int, float, str, type(None))        # objects of these types are returned unchanged during encoding
    
    @staticmethod
    def encode(obj, type_ = None):
        """
        Return a `state` that carries all the information needed for reconstruction of `obj` with decode(),
        yet it contains only JSON-compatible values and collections (possibly nested).
        """
        t = type(obj)
        
        # retrieve object's state while checking against standard python types that need special handling
        if t in JSON.PRIMITIVES:    return obj
        if t is list:               return JSON.encode_list(obj)        # return a list, but first encode recursively all its elements
        if t is dict:
            obj = JSON.encode_dict(obj)
            return {JSON.STATE_ATTR: obj, JSON.CLASS_ATTR: classname(obj)} if JSON.CLASS_ATTR in obj else obj
            # an "escape" wrapper must be added around a dict that contains the reserved key "@"

        from .item import Item
        if issubclass(t, Item):
            if None in obj.id: raise EncodeError(f'non-serializable Item instance with missing or incomplete ID: {obj.id}')
            id = list(obj.id)
            if t is type_: return id
            return {JSON.STATE_ATTR: id, JSON.CLASS_ATTR: JSON.ITEM_FLAG}
        
        if isinstance(obj, type):
            state = classname(cls = obj)
        elif t in (set, tuple):
            state = JSON.encode_list(obj)                       # warning: ordering of elements of a set in `state` is undefined and may differ between calls
        else:
            state = getstate(obj)
            state = JSON.encode_dict(state)                     # recursively encode all non-standard objects inside `state`
            assert isinstance(state, dict)                      # TODO: allow non-dict state from getstate()

            if JSON.CLASS_ATTR in state:
                raise EncodeError(f'non-serializable object state, a reserved character "{JSON.CLASS_ATTR}" occurs as a key in the state dictionary')
            
        # if the exact class is known upfront, let's output compact state without adding "@" for class designation
        if t is type_: return state
        
        # wrap up in a dict and append class designator
        if not isinstance(state, dict):
            state = {JSON.STATE_ATTR: state}
        state[JSON.CLASS_ATTR] = classname(obj)
        
        return state
    
    @staticmethod
    def decode(state, type_ = None, _name_dict = classname(cls = dict)):
        """Reverse operation to encode(): takes an encoded JSON-serializable `state` and converts back to an object."""

        t = type(state)
        
        # decoding of a standard python dict when a wrapper was added
        if t is dict and state.get(JSON.CLASS_ATTR, None) == _name_dict:
            if JSON.STATE_ATTR in state:
                state = state[JSON.STATE_ATTR]          # `state` is a wrapper around an actual dict, created to "escape" the special "@" character
            return JSON.decode_dict(state)
        
        # determine the expected type `class_` of the output object
        if type_:
            if t is dict and JSON.CLASS_ATTR in state and JSON.STATE_ATTR not in state:
                raise DecodeError(f'ambiguous object state during decoding, the special key "{JSON.CLASS_ATTR}" is not needed but present: {state}')
            class_ = type_

        elif t is not dict:
            class_ = t              # an object of a standard python type must have been encoded (non-unique type, but not a dict either)

        elif JSON.CLASS_ATTR not in state:
            class_ = dict
            # raise DecodeError(f'corrupted object state during decoding, missing "{JSON.CLASS_ATTR}" key with object type designator: {state}')
        else:
            fullname = state.pop(JSON.CLASS_ATTR)
            if JSON.STATE_ATTR in state:
                state_attr = state.pop(JSON.STATE_ATTR)
                if state: raise DecodeError(f'invalid serialized state, expected only {JSON.CLASS_ATTR} and {JSON.STATE_ATTR} special keys but got others: {state}')
                state = state_attr

            if fullname == JSON.ITEM_FLAG:                  # decoding a reference to an Item?
                from .boot import get_registry
                return get_registry().get_item(state)       # ...get it from the Registry
            class_ = import_(fullname)
            
        # instantiate the output object; special handling for standard python types and Item
        if class_ in JSON.PRIMITIVES:
            return state
        if class_ is list:
            return JSON.decode_list(state)
        if class_ is dict:
            return JSON.decode_dict(state)
        if class_ in (set, tuple):
            values = state
            return class_(values)
        if isinstance(class_, type):
            from .item import Item
            if issubclass(class_, Item):
                from .boot import get_registry
                return get_registry().get_item(state)       # get the referenced item from the Registry
            if issubclass(class_, type):
                typename = state
                return import_(typename)

        # default object decoding via setstate()
        state = JSON.decode_dict(state)
        return setstate(class_, state)
        
        
    @staticmethod
    def encode_list(values):
        """Encode recursively all non-primitive objects inside a list."""
        return [JSON.encode(v) for v in values]
        
    @staticmethod
    def decode_list(state):
        """Decode recursively all non-primitive objects inside a list."""
        return [JSON.decode(v) for v in state]
        
    @staticmethod
    def encode_dict(state):
        """Encode recursively all non-primitive objects inside `state` dictionary."""
        for key in state:
            if type(key) is not str: raise EncodeError(f'non-serializable object state, contains a non-string key: {key}')
            # TODO: if there are any non-string keys in `state`, the entire dict must be converted to a list representation
            
        return {k: JSON.encode(v) for k, v in state.items()}

    @staticmethod
    def decode_dict(state):
        """Decode recursively all non-primitive objects inside `state` dictionary."""
        return {k: JSON.decode(v) for k, v in state.items()}

    