"""
MultiDict. A dict-like collection of key-value pairs such that every key may be occur
more than once. The order of values under a given key is preserved.
"""

from django.utils.datastructures import MultiValueDict


class MultiDictKeyError(KeyError):
    pass


#####################################################################################################################################################

class MultiDict:
    """
    A dict-like collection of key-value pairs in which keys may occur
    more than once. The insertion order of values for a given key is preserved.
    Internally, MultiDict is a wrapper around standard <dict>, with lists of values
    being stored instead of singular values.
    Selected keys may still be stored as singleton values.
    To this end, they must be put in the `singleton` set upon init.
    MultiDict is NOT a subclass of <dict>, to avoid confusion.
    
    Methods __getitem__() and get() return the FIRST value for a key.
    
    Side note: as of Python 3.7, dict keeps insertion order, as a language feature not an implementation detail.
    """
    
    _values = None          # dict {key: list_of_values}
    _singletons = None      # predefined set of keys to be stored as singletons (no multi-values; no lists as wrappers)
    
    def __init__(self, singular = None, multiple = None, singletons = None):
        """
        MultiDict can be initialized with a dict of values, either `singular`
        (each dict value is a value), or `multiple` (each dict value is a *list* of values).
        """
        assert not (singular and multiple)
        if singular:
            self._values = {key: [value] for key, value in singular.items()}
        elif multiple:
            self._values = multiple.copy()
        else:
            self._values = {}
            
        self._singletons = singletons or set()
    
    def __getstate__(self, compact = True):
        
        return self._compact_state() if compact else self._values
    
    def __setstate__(self, values, compact = True):

        self._values = values
        if not compact: return
        
        # turn singleton non-list values back to a list (de-compactify)
        for key, value in values.items():
            if isinstance(value, list): continue
            values[key] = [value]
        

    def __getitem__(self, key):
        """Return the first value for the key; raise MultiDictKeyError if not found."""
        try:
            values = self._values[key]
        except KeyError:
            raise MultiDictKeyError(key)
        
        # assert len(list_) >= 1
        if key in self._singletons: return values
        return values[0]

    def __setitem__(self, key, value):
        if key in self._singletons:
            self._values[key] = value
        else:
            self._values[key] = [value]

    def __contains__(self, key):
        return key in self._values
        
    def keys(self):
        return self._values.keys()
        
    def get(self, key, default = None):
        """Return the first value for the key; or `default` if the key doesn't exist."""
        if key in self._singletons:
            return self._values.get(key, default)
        values = self._values.get(key, None)
        if values is None: return default
        return values[0]

    def getlist(self, key, default = None, copy_list = False):
        """
        Return a list of values for the key. If key doesn't exist,
        return an empty list, or the `default` value if not None.
        If copy_list is True, return a new copy of the list of values.
        """
        if key not in self._values:
            if default is None: return []
            return default
        
        if key in self._singletons:
            return [self._values[key]]
            
        # values = self._values.get(key, None)
        # if values is None:
        #     if default is None: return []
        #     return default

        values = self._values[key]
        if copy_list: return list(values)
        return values
        
    def first_values(self):
        """Return all first values per key as a standard dict."""
        return {key: values[0] for key, values in self._values.items()}
    
    def last_values(self):
        """Return all last values per key as a standard dict."""
        return {key: values[-1] for key, values in self._values.items()}

    def all_values(self):
        """Return a dict of lists of values per key; same as self._values.copy()."""
        return self._values.copy()

    def set_values(self, key, values):
        self._values[key] = list(values)

    def _compact_state(self):
        """Like all_values(), but singleton lists whose value is NOT a list are replaced with this value."""
        
        state = self.all_values()
        for key, values in state.items():
            if len(values) != 1: continue
            value = values[0]
            if isinstance(value, list): continue
            state[key] = value
            
        return state
        
    def append(self, key, value):
        if key in self._values:
            self._values[key].append(value)
        else:
            self._values[key] = [value]
    
    