"""
TODO: remove this file.

Representation of attribute values of an item (item data).
"""

class Data:
    """
    Features:
    - repeated fields (multi-dict)
    - derived properties: an indicator of a property being derived from other props rather than stored in DB;
         same property can be marked as derived one in an item, and as original one in another item;
         (maybe this should be moved to Item? Item will keep a collection of imputation functions)
    - changed properties: an indicator that a given property was assigned a new (different) value than stored in DB
    
    Access to and naming of repeated fields:
    - data['field:1'], data['field:2'], data['field:last']? -- fields accessed by their *position* within a group
    - data['field-key'] -- entries accessed by their unique *label* within a field group; example labels:
      - 'title-en', 'title-de', 'title-fr' (title of a given publication in different languages)
      - 'release-2.4.2', 'release-2.5-dev1' (consecutive releases of a software package; value is a date of release + link)
      - 'population-2020', 'population-2021' (statistics of population of a country in different years)
    - data['field*'] -- list of all entries for a field
    - data['field'] -- single (unique??) entry for a field; schema may contain a flag first/last/error to control
      the exact behavior when multiple entries are present
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
#     def load_json(cls, dump, schema = None):
#
#         data = jsonp.loads(dump)
#
#         if isinstance(data, dict):
#             return cls(singular = data)
#
#         assert isinstance(data, Data)
#         return data
#
#     def dump_json(self, schema = None):
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
        