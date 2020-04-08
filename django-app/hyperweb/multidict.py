"""
MultiDict. A dict-like collection of key-value pairs such that every key may be occur
more than once. The order of values under a given key is preserved.
"""

from django.utils.datastructures import MultiValueDict


class MultiDictKeyError(KeyError):
    pass

#####################################################################################################################################################

class MultiDict(MultiValueDict):
    """
    A dict-like collection of key-value pairs, in which every key may occur
    more than once. The insertion order of values for a given key is preserved.
    
    Currently, the implementation is based on Django's MultiValueDict, with modifications:
    1) __getitem__() and get() methods return the FIRST value for a key, not the last one;
    2) __getitem__ does NOT return an empty list [] for a missing value, but instead raises an exception.
    3) getlist() does NOT copy the returned internal list of values by default.
    
    Side note: as of Python 3.7, dict keeps insertion order, as a language feature not an implementation detail.
    """

    @classmethod
    def from_dict(cls, values):
        """Create a new MultiDict initialized with values from a standard dict (no multi-values)."""
        
        return cls((key, [value]) for key, value in values.items())

    def __getitem__(self, key):
        """
        Return the first data value for this key; raise MultiDictKeyError if not found.
        """
        try:
            list_ = super().__getitem__(key)
        except KeyError:
            raise MultiDictKeyError(key)
        
        assert len(list_) >= 1
        return list_[0]

    def get(self, key, default = None):
        """
        Return the first data value for the key. If key doesn't exist return `default`.
        """
        try:
            val = self[key]
            return val
        except KeyError:
            return default

    def getlist(self, key, default = None, copy_list = False):
        """
        Return a list of values for the key. If key doesn't exist,
        return an empty list, or the `default` value if not None.
        If copy_list is True, return a new copy of the list of values.
        """
        try:
            values = super().__getitem__(key)
        except KeyError:
            if default is None:
                return []
            return default
        
        assert values is not None
        if copy_list:
            return list(values)
        return values
        
        