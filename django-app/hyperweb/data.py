"""
TODO: remove this file.

Representation of attribute values of an item (item data).
"""

# from .jsonpickle import JsonPickle
# from .multidict import MultiDict
#
# jsonp = JsonPickle()
#
#
# class Data(MultiDict):
#     """
#     Representation of an item's attribute values (item data).
#     """
#
#     @classmethod
#     def from_json(cls, dump, schema = None):
#
#         data = jsonp.loads(dump)
#
#         if isinstance(data, dict):
#             return cls(singular = data)
#
#         assert isinstance(data, Data)
#         return data
#
#     def to_json(self, schema = None):
#
#         # getstate = getattr(self, '__getstate__', None)
#         # print("getstate:", getstate)
#
#         return jsonp.dumps(self)
        

#####################################################################################################################################################

# # shorthand for use inside __getattribute__()
# _get_ = object.__getattribute__
#
#
# class Data2:
#
#     # internal instance variables
#     __data__   = None       # MultiDict
#     __loaded__ = None       # True if this item's data has been fully loaded from DB; for implementation of lazy loading of linked items
#
#     def __init__(self):
#         self.__data__ = MultiDict()
#         self.__loaded__ = False
#
#     def __getitem__(self, name): pass
#     def __getlist__(self, name): pass
#     def __setitem__(self, name, value): pass
#     def __setlist__(self, name, values): pass
#
#     def __getattribute__(self, name):
#
#         if name[:2] == '__':
#             return _get_(self, name)
#
#         data   = _get_(self, '__data__')
#         loaded = _get_(self, '__loaded__')
#         load   = _get_(self, '__load__')
#
#         if MULTI_SUFFIX and name.endswith(MULTI_SUFFIX):
#             basename = name[:-len(MULTI_SUFFIX)]
#             if not (loaded or basename in data): load()
#             return data.get_list(basename)
#
#         if not (loaded or name in data): load()
#         return data[name]
        