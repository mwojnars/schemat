from collections import namedtuple


class Data:
    """
    A collection of field values (Item.data) of a particular item. Supports:
    - multiple values per field
    - optional labels and comments for entries
    - derived fields (auto-imputation)
    - change management (propagation of "draft" flags)
    - data paths: subelements can be accessed in a single get(), e.g., get('population.2020/warsaw/male')
      - field-label separator:     ":"
      - field-subfield separator:  "/"
    
    - derived properties: an indicator of a property being derived from other props rather than stored in DB;
         same property can be marked as derived one in an item, and as original one in another item;
         (maybe this should be moved to Item? Item will keep a collection of imputation functions)
    - changed properties: an indicator that a given property was assigned a new (different) value than stored in DB
    
    Access to and naming of repeated fields:
    - data['field:1'], data['field:2'], data['field:last']? -- fields accessed by their *position* within a group
    - data['field label'] data['field+label']
      data['field.label'] -- entries accessed by their unique *label* within a field group; example labels:
      - 'title-en', 'title-de', 'title-fr' (title of a given publication in different languages)
      - 'release-2.4.2', 'release-2.5-dev1' (consecutive releases of a software package; value is a date of release + link)
      - 'population-2020', 'population-2021' (statistics of population of a country in different years)
      - 'title.en', 'title:en', 'long-field.en', 'long-field:en'
      - 'population.2020/warsaw/male', 'population[1]/warsaw/male'
      - 'xid:springer.com' (xid pulled from springer.com)
    - 'field' -- single (unique??) entry for a field; schema may contain a flag first/last/error to control
      the exact behavior when multiple entries are present

    - data.all('field')
    - data.all('field')[0], data.all('field')[-1]
    - data.first('field'), data.last('field')
    - data.first('field', 'label'), data.first('field+label'), data.first('field.label'), data.first('field/label')
    - data.all('field', 'label') -- multiple entries can share the same label, not just the same key
    - data.get = data.first
    """
    
    Entry = namedtuple('Entry', ['field', 'label', 'value', 'comment'])
    
    entries = None          # list of tuples: (field_name, label, value, comment); label & comment are optional (None)
    

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
        