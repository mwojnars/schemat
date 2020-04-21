from importlib import import_module

#####################################################################################################################################################
#####
#####  COMMON UTILITIES
#####

def import_(fullname):
    """
    Dynamic import of a python class/function/variable given its full (dotted) package-module name.
    If no module name is present, __main__ is used.
    >>> import_('nifty.util.Object')
    <class 'nifty.util.Object'>
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
    

def classname(obj = None, cls = None, aliases = None):
    """Return (fully qualified) class name of the object 'obj' or class 'cls'."""
    if cls is None: cls = obj.__class__
    name = cls.__module__ + "." + cls.__name__
    if aliases: name = aliases.encode(name)
    return name
    

def getstate(obj, aliases = None, class_attr = None, state_attr = None):
    """
    Retrieve object's state with __getstate__(), or take it from __dict__.
    Append class name in the resulting dictionary, if needed, and if `class_attr` is provided.
    `obj` shall not be an instance of a standard JSON-serializable type: int/float/list/tuple/dict/NoneType...
    """
    def with_classname(_state):
        if class_attr is None: return _state
        assert class_attr not in _state
        name = classname(obj, aliases = aliases)
        _state = _state.copy()
        _state[class_attr] = name
        return _state

    getstate = getattr(obj, '__getstate__', None)

    # call __getstate__() if present and bound;
    # 'obj' can be a class! then __getstate__ is present but unbound
    if hasattr(getstate, '__self__'):
        state = getstate()
        if isinstance(state, dict): return with_classname(state)
        raise TypeError(f"The result of __getstate__() is not a dict in {obj}")
        # return {'__state__': state}                         # wrap up a non-dict state in dict

    # otherwise check against other standard types, normally not JSON-serializable
    elif getattr(obj, '__class__', None) in (set, type):
        cls = obj.__class__
        if cls is set:
            state = list(obj)
        elif cls is type:
            state = classname(cls = obj, aliases = aliases)
        else:
            assert 0
        
        state = {state_attr: state}
        return with_classname(state)

    # otherwise use __dict__
    else:
        state = getattr(obj, '__dict__', None)
        if state is None:
            raise TypeError(f"__dict__ not present in {obj}")
        else:
            return with_classname(state)
    

def setstate(cls, state, state_attr = None, aliases = None):
    """
    Create an object of a given class and set its state using __setstate__(), if present,
    or by assigning directly to __dict__ otherwise.
    """
    
    # handle special classes: set, type
    if cls is type:
        name = state[state_attr]
        name = aliases.decode(name)
        return import_(name)
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

    