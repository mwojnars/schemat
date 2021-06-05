import pickle, pytest

from hyperweb.item import Item, Site
from hyperweb.site import registry      # this import is necessary to ensure proper order of module initialization under circular imports of `registry` in types.py
from hyperweb.types import Object, Integer, Class
from hyperweb.schema import Schema


#####################################################################################################################################################
#####
#####  UTILITIES
#####

def run(schema, obj, verbose = False):
    """Run encoding+decoding of `obj` through `schema` and check if the result is the same as `obj`."""
    if verbose: print('\nobject: ', obj, getattr(obj, '__dict__', 'no __dict__'))
    flat = schema.encode(obj)
    if verbose: print('encoded:', flat)
    obj2 = schema.decode(flat)
    if verbose: print('decoded:', obj2, getattr(obj2, '__dict__', 'no __dict__'))
    assert obj == obj2 or pickle.dumps(obj) == pickle.dumps(obj2)

#####################################################################################################################################################

class _T:
    def __init__(self, x = None): self.x = x
    def __eq__(self, other): return self.__dict__ == other.__dict__
class float_(float):
    def __init__(self, x = None): self.x = x
    def __eq__(self, other): return self.__dict__ == other.__dict__

class C:
    x = 5.0
    s = {'A','B','C'}
    t = (1,2,3)
    def f(self): return 1
    def __eq__(self, other): return self.__dict__ == other.__dict__


#####################################################################################################################################################
#####
#####  TESTS
#####

def test_Object():
    
    run(Integer(), None)
    with pytest.raises(Exception, match = 'expected an instance'):
        run(Integer(), 10.5)       # hyperweb.errors.EncodeError: expected an instance of <class 'int'>, got <class 'float'>: 10.5
    
    run(Object(Class), None)
    run(Object(Class), Class())

    run(Object(Class), Class())
    run(Object(_T), _T(x=10))
    run(Object(base = _T), _T(x=10))
    run(Object(str), 'kot')
    run(Object(type = (int, float)), 5.5)
    run(Object(base = (int, float)), float_(5.5))
    run(Object(dict), {'a': 1, 'b': 2})
    run(Object(), {'a': 1, 'b': 2})
    run(Object(), {'a': 1, 'b': 2, '@': 'ampersand'})
    run(Object(dict), {'a': 1, 'b': 2, '@': 'ampersand'})
    run(Object(), Integer())
    run(Object(base = Schema), Integer())
    run(Object(type = Integer), Integer())
    run(Object(base = Schema), Object(dict))
    run(Object(base = Schema), Object((list, dict, str, _T)))

    c = C()
    c.d = C()
    c.y = [3,4,'5']
    
    with pytest.raises(Exception, match = 'non-serializable'):
        run(Object(), {'a':1, 'łąęńÓŚŹŻ':2, 3:[]})         # hyperweb.errors.EncodeError: non-serializable object state, contains a non-string key: 3
    run(Object(), [{'a':1, 'łąęńÓŚŹŻ':2, '3':[]}, None, c, C])
    run(Object(), {"@": "xyz", "v": 5})
    
def test_Item():
    
    # category = registry.get_category(cid = 1)
    # item = category.create_item()
    # item['name'] = "Test Name"
    # item.iid = 12345                    # setting fake IID to allow serialization; normally this should be done through DB

    # a sample item to refer to during serialization; it must actually exist in DB,
    # otherwise the deserialization will raise an exception
    site = registry.get_site()
    
    run(Object(base = Item), site, verbose = True)
    run(Object(Site), site, verbose = True)
    
    