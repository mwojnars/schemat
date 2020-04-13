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
    module = import_module(mod) #, fromlist = [mod])
    try:
        return getattr(module, name)
    except:
        raise ImportError(f"cannot import name '{name}' from '{mod}'")
    
