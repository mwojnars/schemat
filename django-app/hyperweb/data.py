"""
Representation of attribute values of an item (item data).
"""

from .jsonpickle import JsonPickle
from .multidict import MultiDict


class Data(MultiDict):
    """
    Representation of an item's attribute values (item data).
    """
    
    _json = JsonPickle()
    
    
    @classmethod
    def from_json(cls, dump, schema = None):
        
        data = cls._json.loads(dump)
        
        if isinstance(data, dict):
            return cls(singular = data)
        
        assert isinstance(data, Data)
        return data
    
    def to_json(self, schema = None):
        
        # getstate = getattr(self, '__getstate__', None)
        # print("getstate:", getstate)

        return self._json.dumps(self)
        
