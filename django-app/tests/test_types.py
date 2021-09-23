import pickle, pytest

from hyperweb.item import Item
from hyperweb.boot import registry
from hyperweb.schema import Schema, OBJECT, INTEGER, CLASS


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

class T:
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
    
    # run(INTEGER(), None)
    with pytest.raises(Exception, match = 'expected an instance'):
        run(INTEGER(), 10.5)       # hyperweb.errors.EncodeError: expected an instance of <class 'int'>, got <class 'float'>: 10.5
    
    # run(OBJECT(CLASS), None)
    run(OBJECT(CLASS), CLASS())

    run(OBJECT(CLASS), CLASS())
    run(OBJECT(T), T(x=10))
    run(OBJECT(base = T), T(x=10))
    run(OBJECT(str), 'kot')
    run(OBJECT(type = (int, float)), 5.5)
    run(OBJECT(base = (int, float)), float_(5.5))
    run(OBJECT(dict), {'a': 1, 'b': 2})
    run(OBJECT(), {'a': 1, 'b': 2})
    run(OBJECT(), {'a': 1, 'b': 2, '@': 'ampersand'})
    run(OBJECT(dict), {'a': 1, 'b': 2, '@': 'ampersand'})
    run(OBJECT(), INTEGER())
    run(OBJECT(base = Schema), INTEGER())
    run(OBJECT(type = INTEGER), INTEGER())
    run(OBJECT(base = Schema), OBJECT(dict))
    run(OBJECT(base = Schema), OBJECT((list, dict, str, T)))

    c = C()
    c.d = C()
    c.y = [3,4,'5']
    
    with pytest.raises(Exception, match = 'non-serializable'):
        run(OBJECT(), {'a':1, 'łąęńÓŚŹŻ':2, 3:[]})         # hyperweb.errors.EncodeError: non-serializable object state, contains a non-string key: 3
    run(OBJECT(), [{'a':1, 'łąęńÓŚŹŻ':2, '3':[]}, None, c, C])
    run(OBJECT(), {"@": "xyz", "v": 5})


def test_Item():
    
    # category = registry.get_category(cid = 1)
    # item = category.create_item()
    # item['name'] = "Test Name"
    # item.iid = 12345                    # setting fake IID to allow serialization; normally this should be done through DB

    # a sample item to refer to during serialization; it must actually exist in DB,
    # otherwise the deserialization will raise an exception
    site = registry.site
    from hyperweb.core.classes import Site

    run(OBJECT(base = Item), site, True)
    run(OBJECT(Site), site, True)
    

#####################################################################################################################################################

registry.classpath.add('test', T, float_, C)
