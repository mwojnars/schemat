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
    # _singletons = None      # predefined set of keys to be stored as singletons (no multi-values; no lists as wrappers)
    
    def __init__(self, singular = None, multiple = None, compact = None): #singletons = None):
        """
        MultiDict can be initialized with a dict of values, either `singular`
        (each dict value is a value), or `multiple` (each dict value is a *list* of values).
        """
        assert bool(singular) + bool(multiple) + bool(compact) <= 1
        if singular:
            self._values = {key: [value] for key, value in singular.items()}
        elif multiple:
            self._values = multiple.copy()
        elif compact:
            self.set_compact(compact)
        else:
            self._values = {}
            
        # self._singletons = singletons or set()
    
    def __getstate__(self, compact = True):
        
        return self.get_compact() if compact else self._values
    
    def __setstate__(self, values, compact = True):

        if compact: self.set_compact(values)
        else:
            self._values = values
        
    def __getitem__(self, key):
        """Return the first value for the key; raise MultiDictKeyError if not found."""
        try:
            values = self._values[key]
        except KeyError:
            raise MultiDictKeyError(key)
        
        # assert len(list_) >= 1
        # if key in self._singletons: return values
        return values[0]

    def __setitem__(self, key, value):
        # if key in self._singletons:
        #     self._values[key] = value
        # else:
        self._values[key] = [value]

    def __delitem__(self, key):
        del self._values[key]

    def __contains__(self, key):
        values = self._values.get(key)
        return bool(values)
        
    def __len__(self):
        return len(self._values)
        
    def __bool__(self):
        return bool(self._values)
        
    def keys(self):
        return self._values.keys()
        
    def get(self, key, default = None):
        """Return the first value for the key; or `default` if the key doesn't exist."""
        # if key in self._singletons:
        #     return self._values.get(key, default)
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
        
        # if key in self._singletons:
        #     return [self._values[key]]
            
        # values = self._values.get(key, None)
        # if values is None:
        #     if default is None: return []
        #     return default

        values = self._values[key]
        if copy_list: return list(values)
        return values
        
    def setlist(self, key, values):
        values = list(values)
        if not values:
            self._values.pop(key, None)             # do NOT store empty lists, they are implicit
        else:
            self._values[key] = values

    #####
        
    def dict_first(self):
        """Return all first values per key as a standard dict."""
        return {key: values[0] for key, values in self._values.items()}
    
    def dict_last(self):
        """Return all last values per key as a standard dict."""
        return {key: values[-1] for key, values in self._values.items()}

    def dict_all(self):
        """Return a dict of lists of values per key; same as self._values.copy()."""
        return self._values.copy()

    def items_first(self):
        """Generator of (key, first value) pairs."""
        for key, values in self._values.items():
            yield key, values[0]
    
    def items_last(self):
        """Generator of (key, last value) pairs."""
        for key, values in self._values.items():
            yield key, values[-1]

    def items_all(self):
        """Generator of (key, list_of_values) pairs."""
        return self._values.items()
    
    #####

    def get_compact(self):
        """Like dict_all(), but singleton lists whose value is NOT a list are replaced with this value."""
        
        state = self.dict_all()
        for key, values in state.items():
            if len(values) != 1: continue
            value = values[0]
            if isinstance(value, list): continue
            state[key] = value
            
        return state
        
    def set_compact(self, values):
        
        self._values = values
        
        # turn singleton non-list values back to a list (de-compactify)
        for key, value in values.items():
            if isinstance(value, list): continue
            values[key] = [value]
        

    def append(self, key, value):
        if key in self._values:
            self._values[key].append(value)
        else:
            self._values[key] = [value]
    
    
    def update(self, d):
        """Replace existing key lists. Leave a list unchanged if its key is not in `d`."""
        if isinstance(d, MultiDict):
            self._values.update(d.copy()._values)
        else:
            assert isinstance(d, dict)
            self._values.update({key: [value] for key, value in d.items()})
        
        
    def extend(self, d):
        """Extend rather than replace existing key lists."""
        if isinstance(d, MultiDict):
            if not self._values:
                self._values = d._values.copy()
            else:
                for key, values in d._values.items():
                    oldvals = self._values.get(key)
                    self._values[key] = oldvals + values if oldvals else values

        else:
            assert isinstance(d, dict)
            for key, value in d.items():
                oldvals = self._values.get(key)
                self._values[key] = oldvals + [value] if oldvals else [value]
    
            
    def copy(self):
        """
        A shallow copy of self, but with value lists copied, too (!) -
        so that it's safe to modify value lists on both copies.
        """
        dup = MultiDict()
        dup._values = {key: values.copy() for key, values in self._values.items()}
        return dup
    
        
        