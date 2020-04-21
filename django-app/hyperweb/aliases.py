from importlib import import_module

from .errors import SysConfigError


#####################################################################################################################################################

class Aliases:
    """
    Predefined mapping of full python names (package+module+name) of selected python entities
    (classes, types) to short names for use in serialization of items and attribute values.
    Support for reading and saving serializable state of objects.
    """
    
    # per-class aliases
    aliases     = None      # [dict] mapping of full python names to aliases
    aliases_rev = None      # [dict] reverse mapping: alias -> full name
    
    def __init__(self, aliases, validate = False):
        """
        The argument, `aliases`, is a list of generic aliases of the form:
            (from-prefix, to-prefix, list-of-suffixes)
        Typically, "from-prefix" is a package-module name with a trailing dot;
        while "list-of-suffixes" is a list of names to be aliased in a given module.
        """
        self.aliases = {}
        
        # translate prefix-suffix aliases to direct per-class mappings;
        # validate correctness of original class names
        for from_prefix, to_prefix, suffixes in aliases:
            for suffix in suffixes:
                fullname = from_prefix + suffix
                
                # check validity of the `fullname`;
                # this can be skipped (validate=False) if not all system modules have been loaded yet
                if validate:
                    try:
                        self.import_(fullname, alias = False)
                    except Exception as ex:
                        raise SysConfigError(f"cannot import name '{fullname}' during Aliases initialization; cause: {ex}")
                
                alias = to_prefix + suffix
                self.aliases[fullname] = alias
        
        # compute a reversed mapping and check against duplicate aliases
        self.aliases_rev = {alias: fullname for fullname, alias in self.aliases.items()}
        if len(self.aliases_rev) < len(self.aliases):
            raise Exception("Aliases are not unique:", aliases)
    
    
    def encode(self, fullname):
        return self.aliases.get(fullname, fullname)

    def decode(self, alias):
        return self.aliases_rev.get(alias, alias)


    def import_(self, fullname, alias = True):
        """
        Dynamic import of a python class/function/variable given its full (dotted) package-module name.
        If no module name is present, __main__ is used.
        """
        if alias:
            fullname = self.decode(fullname)

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
        
    
    def classname(self, obj = None, cls = None):
        """Fully qualified class name of the object 'obj' or class 'cls'."""
        if cls is None: cls = obj.__class__
        name = cls.__module__ + "." + cls.__name__
        return self.encode(name)
    
    
    def getstate(self, obj, class_attr = None, state_attr = None):
        """
        Retrieve object's state with __getstate__(), or take it from __dict__.
        Append class name in the resulting dictionary, if needed, and if `class_attr` is provided.
        `obj` shall not be an instance of a standard JSON-serializable type: int/float/list/tuple/dict/NoneType...
        """
        getstate = getattr(obj, '__getstate__', None)
    
        # call __getstate__() if present and bound;
        # 'obj' can be a class! then __getstate__ is present but unbound
        if hasattr(getstate, '__self__'):
            state = getstate()
            if not isinstance(state, dict):
                raise TypeError(f"The result of __getstate__() is not a dict in {obj}")
            # return with_classname(state)
    
        # otherwise check against other standard types, normally not JSON-serializable
        elif getattr(obj, '__class__', None) in (set, type):
            cls = obj.__class__
            if cls is set:
                state = list(obj)
            elif cls is type:
                state = self.classname(cls = obj)
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
        state[class_attr] = self.classname(obj)
        return state
        
    
    def setstate(self, cls, state, state_attr = None):
        """
        Create an object of a given class and set its state using __setstate__(), if present,
        or by assigning directly to __dict__ otherwise.
        """
        
        # handle special classes: set, type
        if cls is type:
            name = state[state_attr]
            return self.import_(name)
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
