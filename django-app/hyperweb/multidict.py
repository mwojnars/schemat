"""
MultiDict. A dict-like collection of key-value pairs such that every key may be occur
more than once. The order of values under a given key is preserved.
"""

class MultiKeyError(KeyError):
    """Multiple values are present for a key, but a singleton value was expected."""


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
    
    Side note: as of Python 3.7, <dict> preserves insertion order, as a language feature not an implementation detail.
    """
    
    RAISE = object()        # token that indicates that a KeyError should be raised in get***() if a given key is not found
    
    _values = None          # dict {key: list_of_values}
    
    
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
        """
        Return the (unique) value for the key; raise KeyError if not found,
        or MultiKeyError if multiple values are present.
        """
        return self.get(key, MultiDict.RAISE)
        
        # try:
        #     values = self._values[key]
        # except KeyError:
        #     raise MultiDictKeyError(key)
        #
        # # assert len(list_) >= 1
        # # if key in self._singletons: return values
        # return values[0]

    def __setitem__(self, key, value):
        # if key in self._singletons:
        #     self._values[key] = value
        # else:
        self._values[key] = [value]

    def __delitem__(self, key):
        del self._values[key]

    def __contains__(self, key):
        return key in self._values
        # values = self._values.get(key)
        # return bool(values)
        
    def __len__(self):
        return len(self._values)
        
    def __bool__(self):
        return bool(self._values)
        
    #############################################

    def add(self, key, *values):
        """Add value(s) to a given key without removing the existing ones. Values are added at the end of a list."""
        if not values: return
        if key in self._values:
            self._values[key] += list(values)
        else:
            self._values[key] = list(values)
        
    def set(self, key, *values):
        """
        Assign an arbitrary number of `values` to a given `key` while removing any existing value.
        If no value is provided, the key is removed (if present).
        """
        if values: self._values[key] = list(values)
        else:      self._values.pop(key, None)              # do NOT store empty lists, this would violate MultiDict invariant
        
    def get(self, key, default = None, mode = 'uniq'):
        """
        Return a value for the key, or `default` if the key doesn't exist, or raise KeyError if default=RAISE.
        What value is picked depends on `mode`: the first one (mode="first"), the last one ("last"),
        or the single unique value ("uniq"), in the latter case a MultiKeyError is raised if multiple values
        are present for the key.
        """
        values = self._values.get(key, None)
        if not values:
            if default is MultiDict.RAISE: raise KeyError(key)
            return default
        if mode == 'uniq':
            if len(values) > 1: raise MultiKeyError(f"multiple values are present for a key ({key}) but a single value was expected")
            return values[0]
        return values[-1] if mode == 'last' else values[0]

    def get_first(self, key, default = None):
        return self.get(key, default, 'first')
        
    def get_last(self, key, default = None):
        return self.get(key, default, 'last')
        
    # def get(self, key, default = None):
    #     """
    #     Return the (unique) value for the key, or `default` if the key doesn't exist.
    #     Raise KeyError if default=RAISE, or MultiKeyError if multiple values are present.
    #     """
    #     values = self._values.get(key, None)
    #     if values is None:
    #         if default is MultiDict.RAISE: raise KeyError(key)
    #         return default
    #     if len(values) > 1: raise MultiKeyError(f"multiple values are present for a key ({key}) when a single value was expected")
    #     return values[0]
    #
    # def get_first(self, key, default = None):
    #     """
    #     Return the first value for the key, or `default` if the key doesn't exist, or raise KeyError if default=RAISE.
    #     """
    #     values = self._values.get(key, None)
    #     if values is None:
    #         if default is MultiDict.RAISE: raise KeyError(key)
    #         return default
    #     return values[0]
    #
    # def get_last(self, key, default = None):
    #     """
    #     Return the last value for the key, or `default` if the key doesn't exist, or raise KeyError if default=RAISE.
    #     """
    #     values = self._values.get(key, None)
    #     if values is None:
    #         if default is MultiDict.RAISE: raise KeyError(key)
    #         return default
    #     return values[-1]

    def get_list(self, key, copy_list = False):
        """
        Return a list of values for the key, or an empty list if the key doesn't exist.
        If copy_list is True, a new copy of the list is created, otherwise the one stored
        internally is returned (should not be modified by the caller!).
        """
        if key not in self._values:
            return []
        
        # if key in self._singletons:
        #     return [self._values[key]]
        
        # values = self._values.get(key, None)
        # if values is None:
        #     if default is None: return []
        #     return default

        values = self._values[key]
        if copy_list: return list(values)
        return values
        

    #############################################

    def keys(self):
        return self._values.keys()
        
    def values(self, *keys):
        """
        If `keys` are empty, generate all values stored in this multidict, including all those of multi-valued keys.
        If `keys` are given, only generate values for the provided keys; if a key is not present it gets ignored silently.
        """
        if not keys:
            for values in self._values.values():
                for v in values:
                    yield v
        else:
            for key in keys:
                values = self._values.get(key, None)
                if not values: continue
                for v in values: yield v

    def values_first(self):
        """Generate first values of all keys."""
        for values in self._values.values():
            yield values[0]

    def values_last(self):
        """Generate last values of all keys."""
        for values in self._values.values():
            yield values[-1]

    #############################################
    
    def asdict(self, mode = 'lists'):
        """`mode` is either 'lists' (return lists of all values) or 'first' (only first values)
            or 'last' (only last values).
        """
        if mode == 'lists': return self.asdict_lists()
        if mode == 'first': return self.asdict_first()
        if mode == 'last':  return self.asdict_last()
        raise Exception(f'unknown mode ({mode})')
        
    def asdict_first(self):
        """Return all first values per key as a standard dict."""
        return {key: values[0] for key, values in self._values.items()}
    
    def asdict_last(self):
        """Return all last values per key as a standard dict."""
        return {key: values[-1] for key, values in self._values.items()}

    def asdict_lists(self):
        """Return a dict of lists of values per key; same as self._values.copy()."""
        return self._values.copy()

    def items(self):
        """
        Generator of (key, value) pairs for ALL available values per key.
        A given key may be produced more than once (!).
        Items that share the same key are yielded one after another.
        """
        for key, values in self._values.items():
            for value in values:
                yield key, value
    
    def items_first(self):
        """Generator of (key, first value) pairs."""
        for key, values in self._values.items():
            yield key, values[0]
    
    def items_last(self):
        """Generator of (key, last value) pairs."""
        for key, values in self._values.items():
            yield key, values[-1]

    def items_lists(self):
        """Generator of (key, list_of_values) pairs. Whenever possible, items() should be preferred."""
        return self._values.items()
    
    #####

    def get_compact(self):
        """Like dict_all(), but singleton lists whose value is NOT a list are replaced with this value."""
        
        state = self.asdict_lists()
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
    
        
        