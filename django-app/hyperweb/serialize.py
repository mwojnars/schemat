"""
Utilities for JSON-pickling and serialization of objects of arbitrary classes.

TODO: the functions below could be implemented as methods of Registry to allow customization in the future.

"""

from importlib import import_module


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

