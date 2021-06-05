"""
DRAFT

- coerce -- target python class/type to cast onto
- required
- require_all
- widget
- errors returned as a list/dict rather than raised (?); json/xpath paths as keys like in:
  - 'phones[0].location': '"bar" is not one of "home", "work"'
- to_primitive()

types:

Int -- with min-max range of values
Range
Enum
Email

Tuple
List / Sequence
Dict / Mapping
"""

import json

from .errors import EncodeError, EncodeErrors, DecodeError
from .serialize import classname, import_, getstate, setstate
from .item import Item

from .site import registry


#####################################################################################################################################################
#####
#####  TYPE
#####

class Schema:
    """ 
    Base class for schema validators of data elements, i.e., of values and sub-values of items' fields.
    Provides schema-based validation of form values and schema-aware serialization. Schemas can be nested.
    An instance of Schema serves only as a schema specification, and NOT as an actual value of a type,
    similar to standard Python type annotations.
    
    A Schema object defines:
    - constraints on the set of values that can be assigned to a given field/attribute/variable
    A Schema class provides:
    - validation: determining if a value satisfies the constraints (= valid value) or not
    - sanitization: removing or cleansing any parts of value that could have harmful side-effects in further processing
    - normalization: tranforming related variants of a value to their unique canonical (normal) form
    - encoding & decoding: serialization of valid values to a raw format (a string) for transmission and storage
    - rendering & formatting: for human-readable display of valid values
    
                            RESPONSE
                               ^^
                             render
               sanitize >                encode >
       FORM       ---         DATA         ---      STATE
                < form                  < decode

    Exceptions:
    - ValidationError in sanitize() -- invalid value submitted from a form
    - SchemaError in encode() -- input object doesn't fit the schema
    - DataError in decode() -- inconsistent data in DB
    """
    
    name  = None            # name of this schema instance for messaging purposes
    
    # instance-level settings
    blank = True            # if True, None is a valid input value and is encoded as None;
                            # no other valid value can produce None as its serializable state
    required = False        # (unused) if True, the value for encoding must be non-empty (true boolean value)
    
    
    def to_json(self, value, registry, **params):
        """
        JSON-encoding proceeds in two phases:
        1) reduction of the original `value` (with nested objects) to a smaller `flat` object using any external
           type information that's available; the flat object may still contain nested non-primitive objects;
        2) encoding of the `flat` object through JsonPickle; external type information is no longer used.
        """
        
        flat = self.encode(value)
        return json.dumps(flat, ensure_ascii = False, **params)
        # return jsonp.dumps(flat, **params)

    def from_json(self, dump, registry):

        flat = json.loads(dump)
        return self.decode(flat)
    
    
    def encode(self, value):
        if value is None:
            if self.blank: return None
            raise EncodeError("missing value (None) not permitted")
        
        state = self._encode(value)
        if self.blank:
            if state is None: raise EncodeError(f"internal error in class {self.__class__}, encoded state of {value} is None, which is not permitted with blank=true")

        return state
        
    def decode(self, state):
        if self.blank and state is None:
            return None
        
        value = self._decode(state)
        assert value is not None
        return value

        
    def _encode(self, value):
        """
        Override in subclasses to encode and compactify `value` into serializable python types (a "flat" structure).
        This is similar to value.__getstate__(), but depends and relies on schema definition,
        which may contain additional type constraints and therefore be used to reduce
        the amount of information generated during serialization and subsequently stored in DB.
        It is guaranteed that the same - or more specific - schema will be used for decode(),
        so that deserialization has all the same - or more - information about type constraints
        as serialization did.
        If, for any reason, a less specific schema is used for decode(), the client must ensure that
        the default rules of imputation during data decoding will correctly make up for the missing
        values originally defined by the schema.
        The returned flat structure may still contain instances of non-standard types (!),
        in such case a generic object notation is used to json-pickle the instances.
        """
        return value

    def _decode(self, value):
        """
        Override in subclasses to decode a "flat" value returned by _encode()
        back into custom python types.
        """
        return value

    def __str__(self):
        name = self.name or self.__class__.__name__
        return name

    #############################################
    
    def render(self, value, target = "HTML"):
        """Default rendering of this value for display in a markup document."""
        return str(value)
    
    class Render:
        
        def __init__(self, value): self.value = value
        
        def __hyml__(self):
            return html_escape(str(self.value))
            
            # Link:
            # item = self.value
            # cid, iid = item.id
            # url = item.get_url()
            # return f"<link href='{url}'>{item.data.name or item.data.title}</link>"
        

#####################################################################################################################################################
#####
#####  ATOMIC schema types
#####

class Object(Schema):
    """
    Accepts any python object, optionally restricted to objects whose type(obj) is equal to one of
    predefined type(s) - the `type` parameter - or the object is an instance of one of predefined base classes
    - the `base` parameter; at least one of these conditions must hold.
    If there is only one type in `type`, and an empty `base`, the type name is excluded
    from serializated output and is implied automatically during deserialization.
    Types can be given as import paths (strings), which will be automatically converted to a type object.
    """
    CLASS_ATTR = "@"    # special attribute appended to object state to store a class name (with package) of the object being encoded
    STATE_ATTR = "="    # special attribute to store a non-dict state of data types not handled by JSON: tuple, set, type ...
    PRIMITIVES = (bool, int, float, str, type(None))        # objects of these types are returned unchanged during encoding
    
    type = None         # python type(s) for exact type checks: type(obj)==T
    base = None         # python base type(s) for inheritance checks: isinstance(obj,T)
    
    def __init__(self, type = None, base = None):
        self.__setstate__({'type': type, 'base': base})
        
    def __setstate__(self, state):
        """Custom __setstate__/__getstate__() is needed to allow compact encoding of 1-element lists in `type` and `base`."""
        self.type = self._prepare_types(state['type']) if 'type' in state else []
        self.base = self._prepare_types(state['base']) if 'base' in state else []
        
    @staticmethod
    def _prepare_types(types):
        types = list(types) if isinstance(types, (list, tuple)) else [types] if types else []
        types = [import_(t) if isinstance(t, str) else t for t in types]
        assert all(isinstance(t, type) for t in types)
        return types
        
    def __getstate__(self):
        state = self.__dict__.copy()
        if len(self.type) == 1: state['type'] = self.type[0]
        if len(self.base) == 1: state['base'] = self.base[0]
        return state
    
    def _valid_type(self, obj):
        if not (self.type or self.base): return True        # all objects are valid when no reference types configured
        t = type(obj)
        if t in self.type: return True
        if any(isinstance(obj, base) for base in self.base): return True
        return False

    def _unique_type(self):
        return len(self.type) == 1 and not self.base

    def _encode(self, obj):
        
        if not self._valid_type(obj):
            raise EncodeError(f"invalid object type, expected one of {self.type + self.base}, but got {type(obj)}")
        
        t = type(obj)
        
        # retrieve object's state while checking against standard python types that need special handling
        if t in self.PRIMITIVES:
            return obj
        if t is list:
            return self._encode_list(obj)                           # return a list, but first encode recursively all its elements
        if t is dict:
            obj = self._encode_dict(obj)
            return {self.STATE_ATTR: obj, self.CLASS_ATTR: classname(obj)} if self.CLASS_ATTR in obj else obj
            # an "escape" wrapper must be added around a dict that contains the reserved key "@"
        
        if t is type:
            state = classname(cls = obj)
            # state = {self.STATE_ATTR: classname(cls = obj)}
        elif t in (set, tuple):
            state = self._encode_list(obj)                          # warning: ordering of elements of a set in `state` is undefined and may differ between calls
            # state = {self.STATE_ATTR: self._encode_list(obj)}       # warning: ordering of elements of a set in `state` is undefined and may differ between calls
        elif issubclass(t, Item):
            if None in obj.id: raise EncodeError(f'non-serializable Item instance with missing or incomplete ID: {obj.id}')
            state = list(obj.id)
            # state = {self.STATE_ATTR: list(obj.id)}
        else:
            state = getstate(obj)
            state = self._encode_dict(state)                        # recursively encode all non-standard objects inside `state`
            #TODO: allow non-dict state from getstate()
        
            assert isinstance(state, dict)
            
            if self.CLASS_ATTR in state:
                raise EncodeError(f'non-serializable object state, a reserved character "{self.CLASS_ATTR}" occurs as a key in the state dictionary')
            
        # if the exact class is known upfront, let's output compact state without adding "@" for class designation
        if self._unique_type():
            return state
        
        # wrap up in a dict and append class designator
        if not isinstance(state, dict):
            state = {self.STATE_ATTR: state}
        state[self.CLASS_ATTR] = classname(obj)
        
        return state
    
    def _decode(self, state):
        
        obj = self._decode_object(state)
        if not self._valid_type(obj):
            raise DecodeError(f"invalid object type after decoding, expected one of {self.type + self.base}, but got {type(obj)}")
        # if isinstance(obj, Item):
        #     if obj.data: raise DecodeError(f'invalid serialized state of an Item instance, expected ID only, got non-empty item data: {obj.data}')
        #     obj = registry.get_item(obj.id)         # replace the decoded item with an object from the Registry
        return obj

    def _decode_object(self, state, _name_dict = classname(cls = dict)):

        t = type(state)
        
        # decoding of a standard python dict
        if t is dict and state.get(self.CLASS_ATTR, None) == _name_dict:
            if self.STATE_ATTR in state:
                state = state[self.STATE_ATTR]          # `state` is a wrapper around an actual dict, created to "escape" the special "@" character
            return self._decode_dict(state)
        
        # if t is dict:
        #     if self.CLASS_ATTR in state:
        #         fullname = state.pop(self.CLASS_ATTR)
        #         if self.STATE_ATTR in state:
        #             state_attr = state.pop(self.STATE_ATTR)
        #             if state: raise DecodeError(f'invalid serialized state, expected only {self.CLASS_ATTR} and {self.STATE_ATTR} special keys but got others: {state}')
        #             state = state_attr
        #         elif self._unique_type():
        #             raise DecodeError(f'ambiguous object state during decoding, the special key "{self.CLASS_ATTR}" is not needed but present: {state}')
        #
        #         class_ = import_(fullname)
        #     else:
        #         class_ = dict
        #
        # elif self._unique_type():
        #     class_ = self.type[0]
        # else:
        #     class_ = t              # the object is of standard python type (non-unique type, but not a dict either)

        # determine the expected type `class_` of the output object
        if self._unique_type():
            if t is dict and self.CLASS_ATTR in state and self.STATE_ATTR not in state:
                raise DecodeError(f'ambiguous object state during decoding, the special key "{self.CLASS_ATTR}" is not needed but present: {state}')
            class_ = self.type[0]

        elif t is not dict:
            class_ = t              # an object of a standard python type must have been encoded (non-unique type, but not a dict either)

        elif self.CLASS_ATTR not in state:
            class_ = dict
            # raise DecodeError(f'corrupted object state during decoding, missing "{self.CLASS_ATTR}" key with object type designator: {state}')

        else:
            fullname = state.pop(self.CLASS_ATTR)
            class_ = import_(fullname)
            if self.STATE_ATTR in state:
                state_attr = state.pop(self.STATE_ATTR)
                if state: raise DecodeError(f'invalid serialized state, expected only {self.CLASS_ATTR} and {self.STATE_ATTR} special keys but got others: {state}')
                state = state_attr
                
        # check against standard python types that need special (or no) decoding
        if class_ in self.PRIMITIVES:
            return state
        if class_ is list:
            return self._decode_list(state)
        
        # if class_ is not dict: raise DecodeError(f'invalid arguments for decoding, expected a <dict> instance, got {state}')

        # instantiate the output object; special handling for standard python types and Item
        if class_ is dict:
            # if self.CLASS_ATTR in state:
            #     state = state[self.STATE_ATTR]
            return self._decode_dict(state)
        if class_ is type:
            typename = state #[self.STATE_ATTR]
            return import_(typename)
        if class_ in (set, tuple):
            values = state #[self.STATE_ATTR]
            return class_(values)
        if issubclass(class_, Item):
            id = state  #.pop(self.STATE_ATTR)
            # if state: raise DecodeError(f'invalid serialized state of a reference to an Item, expected ID only, got non-empty item data: {state}')
            return registry.get_item(id)                # get the referenced item from the Registry

        # default object decoding via setstate()
        state = self._decode_dict(state)
        return setstate(class_, state)
        
        
    @staticmethod
    def _encode_list(values):
        """Encode recursively all non-primitive objects inside a list of values using the generic object_schema = Object()."""
        return [object_schema._encode(v) for v in values]
        
    @staticmethod
    def _decode_list(state):
        """Decode recursively all non-primitive objects inside a list of values using the generic object_schema = Object()."""
        return [object_schema._decode(v) for v in state]
        
    @staticmethod
    def _encode_dict(state):
        """Encode recursively all non-primitive objects inside `state` using the generic object_schema = Object()."""
        # TODO: if there are any non-string keys in `state`, the entire dict must be converted to a list representation
        for key in state:
            if type(key) is not str: raise EncodeError(f'non-serializable object state, contains a non-string key: {key}')

        return {k: object_schema._encode(v) for k, v in state.items()}

        # encode = object_schema._encode
        # for key, value in state.items():
        #     # JSON only allows <str> as a type of dictionary keys
        #     if type(key) is not str: raise EncodeError(f'non-serializable object state, contains a non-string key: {key}')
        #     if type(value) not in self.PRIMITIVES:
        #         state[key] = encode(value)
        # return state
    
    @staticmethod
    def _decode_dict(state):
        """Decode recursively all non-primitive objects inside `state` using the generic object_schema = Object()."""
        return {k: object_schema._decode(v) for k, v in state.items()}


# the most generic schema for encoding/decoding any types of objects; used internally in Object()
# for recursive encoding/decoding of individual values inside a given object's state
object_schema = Object()


class Class(Schema):
    """
    Accepts any global python class and encodes as a string containing its full package-module name.
    """
    def _encode(self, value):
        if value is None: return None
        return classname(cls = value)
    
    def _decode(self, value):
        if not isinstance(value, str): raise DecodeError(f"expected a <str>, not {value}")
        return import_(value)
        
class Primitive(Schema):
    """Schema of a specific primitive JSON-serializable python type."""
    
    type = None     # the predefined standard python type of all app-layer values; same type for db-layer values
    
    def __init__(self, type = None):
        if type is None: return
        assert type in (bool, int, float, str)
        self.type = type
    
    def _encode(self, value):
        if not isinstance(value, self.type): raise EncodeError(f"expected an instance of {self.type}, got {type(value)}: {value}")
        return value

    def _decode(self, value):
        if not isinstance(value, self.type): raise DecodeError(f"expected an instance of {self.type}, got {type(value)}: {value}")
        return value

class Boolean(Primitive):
    type = bool

class Integer(Primitive):
    type = int

class Float(Primitive):
    type = float

class String(Primitive):
    type = str
    
class Link(Schema):
    """
    Encodes an Item into its ID=(CID,IID), or just IID.
    Link() is equivalent to Object(Item), however, Link can be parameterized
    with a predefined CID, Link(cid), which is not possible using an Object.
    """
    
    # default CID: if item's CID is equal to this, only IID is stored; otherwise, complete ID is stored
    cid = None
    
    def __init__(self, cid = None):
        self.cid = cid
    
    def _encode(self, item):
        
        # if not isinstance(item, Item): pass
        if None in item.id:
            raise EncodeError(f"Linked item does not exist or its ID is missing, ID={item.id}")
            
        if self.cid is not None and item.cid == self.cid:
            return item.iid
        
        return item.id

    def _decode(self, value):
        
        cid = None
        
        if isinstance(value, int):
            iid = value
            if self.cid is None:
                raise DecodeError(f"expected a (CID,IID) tuple, but got only IID ({iid})")
        else:
            # unpack (CID,IID)
            try:
                cid, iid = value
            except Exception as ex:
                raise DecodeError(f"expected a (CID,IID) tuple, not {value} - {ex}")

            if not isinstance(cid, int):
                raise DecodeError(f"expected CID to be an integer, but got {type(cid)} instead: {cid}")
            if not isinstance(iid, int):
                raise DecodeError(f"expected IID to be an integer, but got {type(iid)} instead: {iid}")

        # if self.cid is not None:
        #     if cid is not None and cid != self.cid:
        #         raise DecodeError(f"expected CID={self.cid}, not {cid}")
        
        if cid is None:
            cid = self.cid

        # from .core import site              # importing an application-global object !!! TODO: pass `registry` as argument to decode() to replace this import
        # from .site import registry
        # print(f'registry loaded by Link in thread {threading.get_ident()}', flush = True)

        return registry.get_item((cid, iid))
        
    
#####################################################################################################################################################
#####
#####  COMPOUND schema types
#####

class List(Schema):
    type = list
    schema = None       # schema of individual elements
    
    def __init__(self, schema):
        self.schema = schema
        
    def _encode(self, values):
        if not isinstance(values, self.type): raise EncodeError(f"expected a {self.type}, got {values}")
        return [self.schema.encode(v) for v in values]

    def _decode(self, encoded):
        if not isinstance(encoded, list): raise DecodeError(f"expected a list, got {encoded}")
        return self.type(self.schema.decode(e) for e in encoded)

class Tuple(List):
    type = tuple
    
class Dict(Schema):
    """Accepts <dict> objects as data values. Outputs a dict with keys and values encoded through their own schema."""
    
    # schema of keys and values of app-layer dicts
    keys   = None
    values = None
    
    def __init__(self, keys = None, values = None):
        
        if keys is not None: self.keys = keys
        if values is not None: self.values = values
        
    def _encode(self, d):
        
        if not isinstance(d, dict): raise EncodeError(f"expected a <dict>, not {d}")
        state = {}
        
        # encode keys & values through predefined field types
        for key, value in d.items():
            k = self.keys.encode(key) if self.keys else key
            if k in state: raise EncodeError(f"duplicate state ({k}) returned by field's {self.keys} encode() for 2 different values, one of them: {key}")
            state[k] = self.values.encode(value) if self.values else value
        
        return state
        
    def _decode(self, state):
        
        if not isinstance(state, dict): raise DecodeError(f"expected a <dict>, not {state}")
        d = {}
        
        # decode keys & values through predefined field types
        for key, value in state.items():
            k = self.keys.decode(key) if self.keys else key
            if k in d: raise DecodeError(f"duplicate value ({k}) returned by field's {self.keys} decode() for 2 different states, one of them: {key}")
            d[k] = self.values.decode(value) if self.values else value
            
        return d


class Switch(Schema):
    """
    Logical alternative of a number of distinct schemas: an app-layer object is serialized through
    the first matching sub-schema, and the schema name or index 0,1,... is stored in the output
    to allow deserialization through the same sub-schema.
    """
    schemas = None      # dict of sub-schemas; keys are names or numeric IDs to be output during serialization
    
    def __init__(self, *schema_list, **schema_dict):
        """Either schema_list or schema_dict should be provided, but not both."""
        if schema_list and schema_dict:
            raise Exception("invalid parameters, either schema_list or schema_dict should be provided, but not both")
        if schema_list:
            self.schemas = dict(enumerate(schema_list))
        else:
            self.schemas = schema_dict
            
    def _encode(self, value):
        
        for name, schema in self.schemas:
            try:
                encoded = schema.encode(value)
                return [name, encoded]
                
            except EncodeError:
                continue
                
        raise EncodeError(f"invalid value, no matching sub-schema in Switch for: {value}")
        
    def _decode(self, encoded):
        
        if not (isinstance(encoded, list) and len(encoded) == 2):
            raise DecodeError(f"data corruption in Switch, the encoded object should be a 2-element list, got {encoded} instead")
        
        name, encoded = encoded
        schema = self.schemas[name]
        return schema.decode(encoded)
        

#####################################################################################################################################################
#####
#####  Python types
#####

class reference:
    """
    Reference to an Item. Only used internally during serialization to replace an original Item instance
    and store only its ID in the output, to be replaced back with a Registry-loaded item during decoding.
    """
    id = None       # ID of the referenced item
    
    def __init__(self, item):
        self.id = item.id
    def __getstate__(self):
        return self.id

class text(str):
    """
    Localized rich text. Stores information about the language of the string, as well as its rich-text
    encoding: markup language, wiki language etc. Both can be missing (None), in such case the `text`
    instance is equivalent to a plain string <str>.
    """


#####################################################################################################################################################

# if __name__ == "__main__":
#
#     def test(schema, obj):
#         print()
#         print('object: ', obj, getattr(obj, '__dict__', 'no __dict__'))
#         flat = schema.encode(obj)
#         print('encoded:', flat)
#         obj2 = schema.decode(flat)
#         print('decoded:', obj2, getattr(obj2, '__dict__', 'no __dict__'))
#
#     test(Integer(), None)
#     # test(Integer(), 10.5)       # hyperweb.errors.EncodeError: expected an instance of <class 'int'>, got <class 'float'>: 10.5
#     test(Object(Class), None)
#     test(Object(Class), Class())
#
#     class _T:
#         def __init__(self, x = None): self.x = x
#     class float_(float):
#         def __init__(self, x = None): self.x = x
#
#     test(Object(Class), Class())
#     test(Object(_T), _T(x=10))
#     test(Object(base = _T), _T(x=10))
#     test(Object(str), 'kot')
#     test(Object(type = (int, float)), 5.5)
#     test(Object(base = (int, float)), float_(5.5))
#     test(Object(dict), {'a': 1, 'b': 2})
#     test(Object(), {'a': 1, 'b': 2})
#     test(Object(), {'a': 1, 'b': 2, '@': 'ampersand'})
#     test(Object(dict), {'a': 1, 'b': 2, '@': 'ampersand'})
#     test(Object(), Integer())
#     test(Object(base = Schema), Integer())
#     test(Object(type = Integer), Integer())
#     test(Object(base = Schema), Object(dict))
#     test(Object(base = Schema), Object((list,dict,str,_T)))
#
#     class C:
#         x = 5.0
#         s = {'A','B','C'}
#         t = (1,2,3)
#         def f(self): return 1
#
#     c = C()
#     c.d = C()
#     c.y = [3,4,'5']
#
#     # test(Object(), {'a':1, 'łąęńÓŚŹŻ':2, 3:[]})         # hyperweb.errors.EncodeError: non-serializable object state, contains a non-string key: 3
#     test(Object(), [{'a':1, 'łąęńÓŚŹŻ':2, '3':[]}, None, c, C])
#     test(Object(), {"@": "xyz", "v": 5})
    