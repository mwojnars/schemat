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

from .errors import EncodeError, EncodeErrors, DecodeError
from .jsonpickle import JsonPickle, classname, import_, getstate, setstate

jsonp = JsonPickle()


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
        return jsonp.dumps(flat, **params)

    def from_json(self, dump, registry):

        flat = jsonp.loads(dump)
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
#####  ATOMIC types
#####

class Object(Schema):
    """
    Accepts any python object, optionally restricted to objects whose type(obj) is equal to one of
    predefined type(s) - the `type` parameter - or isinstance() of one of predefined base classes
    - the `base` parameter; at least one of these conditions must hold.
    If there is only one type in `type`, and an empty `base`, the type name is excluded
    from serializated output and is implied automatically during deserialization.
    Types can be given as import paths (strings), which will be automatically converted to a type object.
    """
    CLASS_ATTR = "@"    # name of a special attribute appended to object state to store a class name (with package) of the object being encoded

    type = None         # python type(s) for exact type checks: type(obj)==T
    base = None         # python base type(s) for inheritance checks: isinstance(obj,T)
    
    def __init__(self, type_ = None, base = None):
        self.__setstate__({'type': type_, 'base': base})
        
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
        if not (self.type or self.base): return True        # all objects are treated as valid when no reference types are configured
        t = type(obj)
        if t in self.type: return True
        if any(isinstance(obj, base) for base in self.base): return True
        return False

    def _unique_type(self):
        return len(self.type) == 1 and not self.base

    def _encode(self, obj):
        
        if not self._valid_type(obj):
            raise EncodeError(f"invalid object type, expected one of {self.type + self.base}, but got {type(obj)}")
        
        state = getstate(obj)
        assert isinstance(state, dict)

        # if the exact class is known upfront let's output compact state without "@" for class designation
        if self._unique_type():
            return state
        
        if self.CLASS_ATTR in state:
            raise EncodeError(f'non-serializable object state, a reserved character "{self.CLASS_ATTR}" occurs as a key in the state dictionary')
            
        # append class designator
        state[self.CLASS_ATTR] = classname(obj)
        return state

    def _decode(self, state):
        
        if self._unique_type():
            if self.CLASS_ATTR in state:
                raise DecodeError(f'ambiguous object state during decoding, the special key "{self.CLASS_ATTR}" is present, but not needed: {state}')
            class_ = self.type[0]

        else:
            if self.CLASS_ATTR not in state:
                raise DecodeError(f'corrupted object state during decoding, missing "{self.CLASS_ATTR}" key with object type designator: {state}')
            
            fullname = state.pop(self.CLASS_ATTR)
            class_ = import_(fullname)
            
        obj = setstate(class_, state)
        
        if not self._valid_type(obj):
            raise DecodeError(f"invalid object type after decoding, expected one of {self.type + self.base}, but got {type(obj)}")
            
        return obj
    

# class Object_(Schema):
#     """
#     Accepts any python object, optionally restricted to objects whose type(obj) is equal to one of
#     predefined type(s) - the `type` parameter - or isinstance() of one of predefined base classes
#     - the `base` parameter; at least one of these conditions must hold.
#     If there is only one type in `type`, and an empty `base`, the type name is excluded
#     from serializated output and is implied automatically during deserialization.
#     """
#
#     base = None         # python base type(s) for inheritance checks: isinstance(obj,T)
#     type = None         # python type(s) for equality checks: type(obj)==T
#     strict = True       # [bool] if True, only instances of <type> are allowed in encode/decode, otherwise an exception is raised
#
#     def __init__(self, type = None, base = None, strict = True):
#         self.base = base
#         self.type = type
#         self.strict = strict
#
#     def _encode(self, obj):
#         cls = self.type
#         if not cls: return obj
#
#         if isinstance(obj, cls):
#             if self._json_primitive(obj): return obj
#             try:
#                 return jsonp.getstate(obj, class_attr = None)
#             except TypeError as ex:
#                 raise EncodeError(f"can't retrieve state of an object: {ex}")
#
#         elif self.strict:
#             raise EncodeError(f"expected an instance of {cls}, but found: {obj}")
#         else:
#             return obj
#
#         # TODO: extended (wrapped) serialization of <dict> to avoid ambiguity of dicts containing "@" as a regular key
#
#     def _decode(self, state):
#         cls = self.type
#         if not cls or isinstance(state, cls): return state
#
#         # cast a <dict> to an instance of the implicit class
#         if isinstance(state, dict):
#             return jsonp.setstate(cls, state)
#         if self.strict:
#             raise DecodeError(f"the object decoded is not an instance of {cls}: {state}")
#         return state
#
#     def _json_primitive(self, obj):
#
#         return obj is None or isinstance(obj, (bool, int, float, tuple, list, dict))


class Class(Schema):
    """
    Accepts any global python class and encodes as a string containing its full package-module name.
    """
    def _encode(self, value):
        if value is None: return None
        return jsonp.classname(cls = value)
    
    def _decode(self, value):
        if not isinstance(value, str): raise DecodeError(f"expected a <str>, not {value}")
        return jsonp.import_(value)
        
class Primitive(Schema):
    """Schema of a specific primitive JSON-serializable python type."""
    
    type = None     # the predefined standard python type of all app-layer values; same type for db-layer values
    
    def __init__(self, type = None):
        if type is None: return
        assert type in (bool, int, float, str)
        self.type = type
    
    def _encode(self, value):
        if not isinstance(value, self.type): raise EncodeError(f"expected an instance of {self.type}, got {value}")
        return value

    def _decode(self, value):
        if not isinstance(value, self.type): raise DecodeError(f"expected an instance of {self.type}, got {value}")
        return value

class Boolean(Primitive):
    type = bool

class Integer(Primitive):
    type = int

class Float(Primitive):
    type = float

class String(Primitive):
    type = str
    
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


class Link(Schema):
    """
    The python value is an Item object.
    The DB value is an ID=(CID,IID), or just IID, of an item.
    """
    
    # default CID: if item's CID is equal to this, only IID is stored; otherwise, complete ID is stored
    cid = None
    
    def __init__(self, cid = None):
        self.cid = cid
    
    def _encode(self, item):
        
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
        from .site import registry
        
        return registry.get_item((cid, iid))
        

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

class text(str):
    """
    Localized rich text. Stores information about the language of the string, as well as its rich-text
    encoding: markup language, wiki language etc. Both can be missing (None), in such case the `text`
    instance is equivalent to a plain string <str>.
    """


    