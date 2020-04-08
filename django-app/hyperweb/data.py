"""
Representation of attribute values of an item (item data).
"""

from .jsonpickle import JsonPickle
from .multidict import MultiDict


class Data(MultiDict):
    """
    Representation of an item's attribute values (item data).
    """
    
    json = JsonPickle()
    
    @classmethod
    def from_json(cls, dump):
        
        data = cls.json.loads(dump)
        
        # for now, we assume `data` is a plain dict, no multi-values
        if isinstance(data, dict):
            return cls.from_dict(data)
        
        assert isinstance(data, Data)
        return data
    