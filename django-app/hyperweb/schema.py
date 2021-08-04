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
Email

List / Sequence
Dict / Mapping
"""

import json, base64
from hypertag.std.html import html_escape as esc

from .utils import hypertag, dedent
from .errors import EncodeError, EncodeErrors, DecodeError
from .serialize import classname, import_, getstate, setstate
from .multidict import MultiDict
from .item import Item
from .types import text, html, struct, catalog


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
                             display
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
    # registry = None
    
    is_catalog = False      # True only in CATALOG and subclasses
    
    def to_json(self, value, registry, **params):
        """
        JSON-encoding proceeds in two phases:
        1) reduction of the original `value` (with nested objects) to a smaller `flat` object using any external
           type information that's available; the flat object may still contain nested non-primitive objects;
        2) encoding of the `flat` object through JsonPickle; external type information is no longer used.
        """
        
        flat = self.encode(value, registry)
        return json.dumps(flat, ensure_ascii = False, **params)
        # return jsonp.dumps(flat, **params)

    def from_json(self, dump, registry):

        flat = json.loads(dump)
        return self.decode(flat, registry)
    
    
    def encode(self, value, registry):
        if value is None:
            if self.blank: return None
            raise EncodeError("missing value (None) not permitted")
        
        # self.registry = object_schema.registry = registry or self.registry
        # assert self.registry

        state = self._encode(value, registry)
        if self.blank:
            if state is None: raise EncodeError(f"internal error in class {self.__class__}, encoded state of {value} is None, which is not permitted with blank=true")

        return state
        
    def decode(self, state, registry):
        if self.blank and state is None:
            return None
        
        # self.registry = object_schema.registry = registry or self.registry
        # assert self.registry
        
        value = self._decode(state, registry)
        assert value is not None
        return value

        
    def _encode(self, value, registry):
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

    def _decode(self, value, registry):
        """
        Override in subclasses to decode a "flat" value returned by _encode()
        back into custom python types.
        """
        return value

    def __str__(self):
        name = self.name or self.__class__.__name__
        return name

    #############################################
    
    def is_lengthy(self, value):
        """True if display() may potentially produce a long multiline output which needs a scrollable box around."""
        return True

    def display(self, value):  # inline = False, target = "HTML"
        """
        Default (rich-)text representation of `value` for display in a response document, typically as HTML code.
        In the future, this method may return a Hypertag's DOM representation to allow better customization.
        """
        fun = getattr(value, '__html__', None)
        if fun and callable(fun):
            return html(fun())

        return text(value)
        

#####################################################################################################################################################
#####
#####  ATOMIC schema types
#####

class OBJECT(Schema):
    """
    Accepts any python object, optionally restricted to objects whose type(obj) is equal to one of
    predefined type(s) - the `type` parameter - or the object is an instance of one of predefined base classes
    - the `base` parameter; at least one of these conditions must hold.
    If there is only one type in `type`, and an empty `base`, the type name is excluded
    from serializated output and is implied automatically during deserialization.
    Types can be given as import paths (strings), which will be automatically converted to a type object.
    """
    ITEM_FLAG  = None   # special value of CLASS_ATTR that denotes a reference to an Item
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

    def _encode(self, obj, registry):
        
        if not self._valid_type(obj):
            raise EncodeError(f"invalid object type, expected one of {self.type + self.base}, but got {type(obj)}")
        
        t = type(obj)
        
        # retrieve object's state while checking against standard python types that need special handling
        if t in self.PRIMITIVES:
            return obj
        if t is list:
            return self._encode_list(obj, registry)                           # return a list, but first encode recursively all its elements
        if t is dict:
            obj = self._encode_dict(obj, registry)
            return {self.STATE_ATTR: obj, self.CLASS_ATTR: classname(obj)} if self.CLASS_ATTR in obj else obj
            # an "escape" wrapper must be added around a dict that contains the reserved key "@"
        if issubclass(t, Item):
            if None in obj.id: raise EncodeError(f'non-serializable Item instance with missing or incomplete ID: {obj.id}')
            id = list(obj.id)
            if self._unique_type(): return id
            return {self.STATE_ATTR: id, self.CLASS_ATTR: self.ITEM_FLAG}
        
        if isinstance(obj, type):
            state = classname(cls = obj)
            # state = {self.STATE_ATTR: classname(cls = obj)}
        elif t in (set, tuple):
            state = self._encode_list(obj, registry)                          # warning: ordering of elements of a set in `state` is undefined and may differ between calls
            # state = {self.STATE_ATTR: self._encode_list(obj)}       # warning: ordering of elements of a set in `state` is undefined and may differ between calls
        # elif issubclass(t, Item):
        #     if None in obj.id: raise EncodeError(f'non-serializable Item instance with missing or incomplete ID: {obj.id}')
        #     state = list(obj.id)
        else:
            state = getstate(obj)
            state = self._encode_dict(state, registry)                        # recursively encode all non-standard objects inside `state`
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
    
    def _decode(self, state, registry):
        
        obj = self._decode_object(state, registry)
        if not self._valid_type(obj):
            raise DecodeError(f"invalid object type after decoding, expected one of {self.type + self.base}, but got {type(obj)}")
        # if isinstance(obj, Item):
        #     if obj.data: raise DecodeError(f'invalid serialized state of an Item instance, expected ID only, got non-empty item data: {obj.data}')
        #     obj = registry.get_item(obj.id)         # replace the decoded item with an object from the Registry
        return obj

    def _decode_object(self, state, registry, _name_dict = classname(cls = dict)):

        t = type(state)
        
        # decoding of a standard python dict when a wrapper was added
        if t is dict and state.get(self.CLASS_ATTR, None) == _name_dict:
            if self.STATE_ATTR in state:
                state = state[self.STATE_ATTR]          # `state` is a wrapper around an actual dict, created to "escape" the special "@" character
            return self._decode_dict(state, registry)
        
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
            if self.STATE_ATTR in state:
                state_attr = state.pop(self.STATE_ATTR)
                if state: raise DecodeError(f'invalid serialized state, expected only {self.CLASS_ATTR} and {self.STATE_ATTR} special keys but got others: {state}')
                state = state_attr

            if fullname == self.ITEM_FLAG:                  # decoding a reference to an Item?
                return registry.get_item(state)        # ...get it from the Registry
            class_ = import_(fullname)
            
        # instantiate the output object; special handling for standard python types and Item
        if class_ in self.PRIMITIVES:
            return state
        if class_ is list:
            return self._decode_list(state, registry)
        if class_ is dict:
            return self._decode_dict(state, registry)
        if class_ in (set, tuple):
            values = state
            return class_(values)
        if isinstance(class_, type):
            if issubclass(class_, Item):
                return registry.get_item(state)                 # get the referenced item from the Registry
            if issubclass(class_, type):
                typename = state
                return import_(typename)

        # default object decoding via setstate()
        state = self._decode_dict(state, registry)
        return setstate(class_, state)
        
        
    @staticmethod
    def _encode_list(values, registry):
        """Encode recursively all non-primitive objects inside a list of values using the generic object_schema = OBJECT()."""
        return [object_schema._encode(v, registry) for v in values]
        
    @staticmethod
    def _decode_list(state, registry):
        """Decode recursively all non-primitive objects inside a list of values using the generic object_schema = OBJECT()."""
        return [object_schema._decode(v, registry) for v in state]
        
    @staticmethod
    def _encode_dict(state, registry):
        """Encode recursively all non-primitive objects inside `state` using the generic object_schema = OBJECT()."""
        # TODO: if there are any non-string keys in `state`, the entire dict must be converted to a list representation
        for key in state:
            if type(key) is not str: raise EncodeError(f'non-serializable object state, contains a non-string key: {key}')

        return {k: object_schema._encode(v, registry) for k, v in state.items()}

        # encode = object_schema._encode
        # for key, value in state.items():
        #     # JSON only allows <str> as a type of dictionary keys
        #     if type(key) is not str: raise EncodeError(f'non-serializable object state, contains a non-string key: {key}')
        #     if type(value) not in self.PRIMITIVES:
        #         state[key] = encode(value)
        # return state
    
    @staticmethod
    def _decode_dict(state, registry):
        """Decode recursively all non-primitive objects inside `state` using the generic object_schema = OBJECT()."""
        return {k: object_schema._decode(v, registry) for k, v in state.items()}


# the most generic schema for encoding/decoding any types of objects; used internally in OBJECT()
# for recursive encoding/decoding of individual values inside a given object's state
object_schema = OBJECT()


class CLASS(Schema):
    """
    Accepts any global python type and encodes as a string containing its full package-module name.
    """
    def _encode(self, value, registry):
        if value is None: return None
        return classname(cls = value)
    
    def _decode(self, value, registry):
        if not isinstance(value, str): raise DecodeError(f"expected a <str>, not {value}")
        return import_(value)
        
        
class Primitive(Schema):
    """Base class for schemas of primitive JSON-serializable python types."""

    type = None     # the predefined standard python type of all app-layer values; same type for db-layer values
    
    def __init__(self, type = None):
        if type is None: return
        assert type in (bool, int, float, str)
        self.type = type
    
    def _encode(self, value, registry):
        if not isinstance(value, self.type): raise EncodeError(f"expected an instance of {self.type}, got {type(value)}: {value}")
        return value

    def _decode(self, value, registry):
        if not isinstance(value, self.type): raise DecodeError(f"expected an instance of {self.type}, got {type(value)}: {value}")
        return value

    def is_lengthy(self, value):
        return False

class BOOLEAN(Primitive):
    type = bool

class INTEGER(Primitive):
    type = int

class FLOAT(Primitive):
    type = float

class STRING(Primitive):
    type = str
    
class TEXT(Primitive):
    """Similar to STRING, but differs in how the content is displayed: as a block rather than inline."""
    type = str

    def is_lengthy(self, value):
        return len(value) > 200 #or value.count('\n') > 3
        
class BYTES(Primitive):
    """Encodes a <bytes> object as a string using Base64 encoding."""
    type = bytes
    
    def _encode(self, value, registry):
        if not isinstance(value, bytes): raise EncodeError(f"expected an instance of {bytes}, got {type(value)}: {value}")
        return base64.b64encode(value).decode('ascii')

    def _decode(self, encoded, registry):
        if not isinstance(encoded, str): raise DecodeError(f"expected a string to decode, got {type(encoded)}: {encoded}")
        return base64.b64decode(encoded)
    
class ENUM(Schema):
    """
    Only string values are allowed by default. Use `schema` argument to pass another type of schema for values;
    or set indices=True to enforce that only indices of values (0,1,...) are stored in the output - then the ordering
    of values in __init__() is meaningful for subsequent decoding.
    """
    schema   = STRING()
    values   = None
    valueset = None         # (temporary) set of permitted values
    indices  = None         # (temporary) dict of {index: value} when indices=True in __init__; serialized as False/True
    
    def __init__(self, *values, schema = None, indices = None):
        self.values = list(values)
        if schema is not None: self.schema = schema
        if indices:
            self.indices = indices
        self._init()
        
    def __getstate__(self):
        state = self.__dict__.copy()
        del state['valueset']
        state['indices'] = bool(self.indices)
        return state
    
    def __setstate__(self, state):
        self.__dict__ = state
        self._init()
        
    def _init(self):
        self.valueset = set(self.values)         # for fast lookups
        if self.indices:
            self.indices = {v: idx for idx, v in enumerate(self.values)}

    def _encode(self, value, registry):
        if value not in self.valueset: raise EncodeError(f"unknown ENUM value: {value}")
        if self.indices:
            return self.indices[value]
        else:
            return self.schema.encode(value, registry)
    
    def _decode(self, encoded, registry):
        # if not isinstance(encoded, list): raise DecodeError(f"expected a list, got {encoded}")
        
        if self.indices:
            if not isinstance(encoded, int): raise DecodeError(f"expected an integer as encoded ENUM value, got {encoded}")
            return self.values[encoded]
        
        value = self.schema.decode(encoded, registry)
        if value not in self.valueset: raise DecodeError(f"unknown ENUM value after decoding: {value}")
        return value
    
    
class LINK(Schema):
    """
    Encodes an Item into its ID=(CID,IID), or just IID if `category` or `cid` was provided.
    LINK without parameters is equivalent to OBJECT(Item), however, LINK can also be parameterized,
    which is not possible using an OBJECT.
    """
    
    # the required category or CID of items to be encoded; if None, all items can be encoded
    category = None
    cid      = None
    
    def __init__(self, category = None, cid = None):
        if cid is not None: self.cid = cid
        if category is not None: self.category = category
            # if category.iid is None:
            #     print(f"WARNING: category {category} has empty ID in LINK.__init__()")
            #     self.category = category
            # self.cid = category.iid
    
    def _get_cid(self):
        if self.cid is not None: return self.cid
        if self.category: return self.category.iid
        return None
    
    def _encode(self, item, registry):
        
        # if not isinstance(item, Item): pass
        if None in item.id:
            raise EncodeError(f"Linked item does not exist or its ID is missing, ID={item.id}")
            
        cid = self._get_cid()
        
        if None != cid == item.cid:
            return item.iid
        
        return item.id

    def _decode(self, value, registry):
        
        cid = None
        ref_cid = self._get_cid()

        if isinstance(value, int):
            iid = value
            if ref_cid is None:
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
            cid = ref_cid

        # from .core import site              # importing an application-global object !!! TODO: pass `registry` as argument to decode() to replace this import
        # from .site import registry
        # print(f'registry loaded by LINK in thread {threading.get_ident()}', flush = True)

        return registry.get_item((cid, iid))
        
#####################################################################################################################################################

class PATH_STRING(STRING):
    """Path to an item in a Directory."""
    
class ENTRY_NAME(STRING):
    """
    Name of an individual entry in a Directory, without path.
    Names that end with '/' indicate directories and must link to items of Directory category.
    """

class ENTRY(LINK):
    """
    Entry in a Directory: reference to an item, with an additional flag for sub-Directory items
    indicating whether this item should be interpreted as-is or as a subfolder.
    """
    
    
    
#####################################################################################################################################################
#####
#####  COMPOUND schema types
#####

class LIST(Schema):
    type = list
    schema = None       # schema of individual elements
    
    def __init__(self, schema):
        self.schema = schema
        
    def _encode(self, values, registry):
        if not isinstance(values, self.type): raise EncodeError(f"expected a {self.type}, got {values}")
        return [self.schema.encode(v, registry) for v in values]

    def _decode(self, encoded, registry):
        if not isinstance(encoded, list): raise DecodeError(f"expected a list, got {encoded}")
        return self.type(self.schema.decode(e, registry) for e in encoded)

class TUPLE(Schema):
    """
    If multiple `schemas` are given, each tuple must have this exact length and each element is encoded
    through a different schema, as provided. If there is one schema, this schema is used for
    all elements and the length of an input tuple can differ. If no schema is provided, the effect
    is the same as providing a single `object_schema`.
    """
    type = tuple
    schemas = None      # list of schemas of individual elements

    def __init__(self, *schemas):
        self.schemas = list(schemas)
        
    def _encode(self, values, registry):
        if not isinstance(values, tuple): raise EncodeError(f"expected a tuple, got {values}")
        if len(self.schemas) <= 1:
            schema = self.schemas[0] if self.schemas else object_schema
            return [schema.encode(v, registry) for v in values]
        if len(values) != len(self.schemas): raise EncodeError(f"expected {len(self.schemas)} elements in a tuple, got {len(values)}")
        return [schema.encode(v, registry) for v, schema in zip(values, self.schemas)]

    def _decode(self, encoded, registry):
        if not isinstance(encoded, list): raise DecodeError(f"expected a list, got {encoded}")
        if len(self.schemas) <= 1:
            schema = self.schemas[0] if self.schemas else object_schema
            return [schema.decode(e, registry) for e in encoded]
        if len(encoded) != len(self.schemas): raise EncodeError(f"expected {len(self.schemas)} elements in a tuple to be decoded, got {len(encoded)}")
        return tuple(schema.decode(e, registry) for e, schema in zip(encoded, self.schemas))

    
class DICT(Schema):
    """
    Accepts <dict> objects as data values, or objects of a given `type` which should be a subclass of <dict>.
    Outputs a dict with keys and values encoded through their own schema.
    If no schema is provided, `object_schema` is used as a default.
    """
    
    # schema of keys and values of app-layer dicts
    keys   = None
    values = None
    type   = None           # optional subtype of <dict>; if present, only objects of this type are accepted for encoding

    # the defaults are configured at class level for easy subclassing and to reduce output when this schema is serialized
    keys_default   = object_schema
    values_default = object_schema
    
    def __init__(self, keys = None, values = None, type = None):
        
        if keys is not None: self.keys = keys
        if values is not None: self.values = values
        if type is not None: self.type = type
        
    def _encode(self, d, registry):
        
        if not isinstance(d, self.type or dict): raise EncodeError(f"expected a <dict>, got {type(d)}: {d}")
        state = {}
        
        schema_keys   = self.keys or self.keys_default
        schema_values = self.values or self.values_default
        
        # encode keys & values through predefined field types
        for key, value in d.items():
            k = schema_keys.encode(key, registry)
            if k in state: raise EncodeError(f"duplicate state ({k}) returned by field's {self.keys} encode() for 2 different values, one of them: {key}")
            state[k] = schema_values.encode(value, registry)
        
        return state
        
    def _decode(self, state, registry):
        
        if not isinstance(state, dict): raise DecodeError(f"expected a <dict>, not {state}")
        d = (self.type or dict)()
        
        schema_keys   = self.keys or self.keys_default
        schema_values = self.values or self.values_default
        
        # decode keys & values through predefined field types
        for key, value in state.items():
            k = schema_keys.decode(key, registry)
            if k in d: raise DecodeError(f"duplicate key ({k}) returned by field's {schema_keys} decode() for 2 different states, one of them: {key}")
            d[k] = schema_values.decode(value, registry)
            
        return d

class CATALOG(DICT):
    """
    Schema of a catalog of items.
    Similar to DICT, but assumes keys are strings; and `type`, if present, must be a subclass of <catalog>.
    Provides tight integration with the UI: convenient layout for display of items,
    and access paths for locating form validation errors.
    Watch out the reversed ordering of arguments in __init__() !!
    """
    is_catalog   = True
    keys_default = STRING()
    
    def __init__(self, values = None, keys = None, type = None):
        # if keys is None:
        #     keys = STRING()
        # else:
        #     assert isinstance(keys, STRING)             # `keys` may inherit from STRING, not necessarily be a STRING
        
        if keys: assert isinstance(keys, STRING)        # `keys` may inherit from STRING, not necessarily be a STRING
        if type: assert issubclass(type, catalog)
        super(CATALOG, self).__init__(keys, values, type)
        
    # def display(self, values):
    #
    #     from hypertag import HyperHTML                  # TODO: refactor to avoid import
    #     view = """
    #         context $catalog
    #         ol
    #             for key, value in catalog.items():
    #                 li
    #                     i  | $key
    #                     ...| : $value
    #     """
    #     return html(HyperHTML().render(view, catalog = values))


class VARIANT(Schema):
    """
    Logical alternative of a number of distinct schemas: an app-layer object is serialized through
    the first matching sub-schema, and its name is stored in the output to allow deserialization
    through the same sub-schema.
    """
    schemas = None      # dict of sub-schemas; keys are names to be output during serialization
    
    def __init__(self, **schemas):
        """Either schema_list or schema_dict should be provided, but not both."""
        # if schema_list and schema_dict:
        #     raise Exception("invalid parameters, either schema_list or schema_dict should be provided, but not both")
        # if schema_list:
        #     self.schemas = dict(enumerate(schema_list))
        # else:
        self.schemas = schemas
            
    def _encode(self, value, registry):
        
        for name, schema in self.schemas:
            try:
                encoded = schema.encode(value, registry)
                return [name, encoded]
                
            except EncodeError:
                continue
                
        raise EncodeError(f"invalid value, no matching sub-schema in VARIANT for: {value}")
        
    def _decode(self, encoded, registry):
        
        if not (isinstance(encoded, list) and len(encoded) == 2):
            raise DecodeError(f"data corruption in VARIANT, the encoded object should be a 2-element list, got {encoded} instead")
        
        name, encoded = encoded
        schema = self.schemas[name]
        return schema.decode(encoded, registry)
        

#####################################################################################################################################################
#####
#####  SPECIAL-PURPOSE SCHEMA
#####

class CODE(TEXT):
    
    def display(self, code):
        code_html = dedent(esc(code))
        code_html = code_html.replace('\n', '</pre>\n<pre>')        # this prevents global html indentation (after embedding in Hypertag) from being treated as a part of code
        return html(f"<pre>{code_html}</pre>")
    

#####################################################################################################################################################
#####
#####  FIELD & RECORD & STRUCT
#####

class Field:
    """Specification of a field in a FIELDS/STRUCT catalog."""
    
    MISSING = object()      # token indicating that `default` value is missing; removed from output during serialization
    
    schema  = None          # instance of Schema
    default = MISSING       # value assumed if this field is missing in an item; or MISSING if no default
    multi   = False         # whether this field can be repeated (take on multiple values)
    info    = None          # human-readable description of the field
    
    def __init__(self, schema = None, default = MISSING, info = None, multi = None):
        if schema is not None:  self.schema = schema
        if default is not Field.MISSING: self.default = default
        if multi is not None:   self.multi = multi
        if info is not None:    self.info = info
    
    def __getstate__(self):
        # if len(self.__dict__) == 1 and 'schema' in self.__dict__:   # compactify the state when only `schema` is configured
        #     return self.schema
        
        if self.__dict__.get('default') is Field.MISSING:           # exclude explicit MISSING value from serialization
            state = self.__dict__.copy()
            del state['default']
        else:
            state = self.__dict__
            
        return state
    
    def __html__(self):
        view = """
            context $field as f
            span .field
                | $f.schema
                ...if f.multi | *
                if f.default <> f.MISSING
                    $default = str(f.default)
                    span .default title="default value: {default:crop(1000)}"
                        | [{default : crop(100)}]
                if f.info
                    span .info | • $f.info
                    # smaller dot: &middot;
                    # larger dot: •
        """
        return hypertag(view, field = self)
    
        # multi = '*' if self.multi else ''
        # return f"{self.schema}{multi} [{self.default}] / <i>{esc(self.info or '')}</i>"
    
    def encode_one(self, value, registry):
        return self.schema.encode(value, registry)
    
    def decode_one(self, encoded, registry):
        return self.schema.decode(encoded, registry)
    
    def encode_many(self, values, registry):
        """There can be multiple `values` to encode if self.multi is true. `values` is a list."""
        if len(values) >= 2 and not self.multi: raise Exception(f"multiple values not allowed by {self} schema")
        encoded = [self.schema.encode(v, registry) for v in values]
        # self.schema.registry = registry
        # encoded = list(map(self.schema.encode, values))

        # compactify singleton lists
        if not self.multi or (len(encoded) == 1 and not isinstance(encoded[0], list)):
            encoded = encoded[0]
            
        return encoded
        
    def decode_many(self, encoded, registry):
        """Returns a list of value(s)."""
        
        # de-compactification of singleton lists
        if not self.multi or not isinstance(encoded, list):
            encoded = [encoded]
    
        # schema-based decoding
        return [self.schema.decode(e, registry) for e in encoded]
        # self.schema.registry = registry
        # return list(map(self.schema.decode, encoded))
        
        
#####################################################################################################################################################

class FIELDS(catalog, Schema):
    """
    Catalog of fields of items (MultiDict's) in a particular category;
    a dictionary of field names and their individual schemas as Field objects.
    Provides methods for schema-aware encoding and decoding of items,
    with every field value encoded through its dedicated field-specific schema.

    Primarily used for schema definition inside categories.
    Can also be used as a sub-schema in compound schema definitions. Instances of MultiDict
    are valid objects for encoding. If standard dict-like functionality is desired, field.multi should be set
    to False in all fields.
    """
    
    # default field specification to be used for fields not present in `fields`
    default_field = Field(schema = object_schema, multi = True)
    
    # fields   = None     # dict of field names & their Field() schema descriptors
    strict   = False    # if True, only the fields present in `fields` can occur in the data being encoded
    blank    = False
    
    def __init__(self, **fields):
        # if __strict__ is not None: self.strict = __strict__
        # if fields: self.fields = fields
        super(FIELDS, self).__init__(fields)
        self.update(fields)
        self._init_fields()
    
    def __setstate__(self, state):
        # self.__dict__ = dict(state)
        self.clear()
        self.update(state)
        self._init_fields()

    def _init_fields(self):
        """Wrap up in Field all the fields whose values are plain Schema instances."""
        # if self.fields is None: self.fields = {}
        for name, field in self.items():
            assert isinstance(name, str)
            if isinstance(field, Field): continue
            if field and not isinstance(field, Schema): raise Exception(f"expected an instance of Schema, got {field}")
            self[name] = Field(schema = field)
        
    
    def _encode(self, data, registry):
        """
        Convert a MultiDict (`data`) to a dict of {attr_name: encoded_values} pairs,
        while schema-encoding each field value beforehand.
        """
        
        if not isinstance(data, MultiDict): raise EncodeError(f"expected a MultiDict, got {data}")
        errors = []
        
        # encode & compactify values of fields through per-field schema definitions
        encoded = data.asdict_lists()
        for name, values in encoded.items():
            
            if self.strict and name not in self:
                raise EncodeError(f'unknown field "{name}"')
            
            # schema-aware encoding
            field = self.get(name)
            if field:
                encoded[name] = field.encode_many(values, registry)
            else:
                encoded[name] = self.default_field.encode_many(values, registry)
            # TODO: catch atype.encode() exceptions and append to `errors`
            
        if errors:
            raise EncodeErrors(errors)
            
        return encoded
        
        
    def _decode(self, data, registry):
        """
        Decode a dict of {attr: value(s)} back to a MultiDict.
        Perform recursive top-down schema-based decoding of field values.
        """
        if not isinstance(data, dict): raise DecodeError(f"expected a <dict>, not {data}")

        # de-compactify & decode values of fields
        for name, values in data.items():
            
            if self.strict and name not in self:
                raise DecodeError(f'field "{name}" of a record not allowed by its schema definition')
            
            # schema-based decoding
            field = self.get(name)
            if field:
                data[name] = field.decode_many(values, registry)
            else:
                data[name] = self.default_field.decode_many(values, registry)
                
        return MultiDict(multiple = data)
    
    
    def get_default(self, name):
        """
        Get the default value of a given item attribute as defined in this schema.
        Return a pair (value, found), where `found` is True (there is a default) or False (no default found).
        """
        field = self.get(name)
        return field.default if field else Field.MISSING

    def __str__(self):
        return str(dict(self))
    
    def is_lengthy(self, value):
        return False

#####################################################################################################################################################

class STRUCT(FIELDS):
    """
    Schema of a plain dict-like object that contains a number of named fields each one having its own schema.
    Similar to FIELDS, but the app-representation is a regular python object matching the schema
    rather than a MultiDict; and multiple values are not allowed for a field.
    When self.type is `struct`, both <struct> <dict> instances are accepted during encoding,
    with the latter being automatically converted to a <struct> during decoding (!).
    """
    
    type = None         # python type of accepted app-representation objects; instances of subclasses of `type` are NOT accepted
    
    def __init__(self, **fields):
        self.type = self.type or struct
        assert isinstance(self.type, type), f'self.type is not a type: {self.type}'
        
        super(STRUCT, self).__init__(**fields)
        for name, field in self.items():
            if field.multi: raise Exception(f'multiple values are not allowed for a field ("{name}") of a STRUCT schema')
    
    def _encode(self, obj, registry):

        if self.type is struct:
            assert isinstance(obj, dict), f'not a dict or struct: {obj}'
            attrs = dict(obj)
        elif not isinstance(obj, self.type):
            raise EncodeError(f"expected an object of type {self.type}, got {obj}")
        else:
            attrs = getstate(obj)
        
        encoded = {}
        
        # encode values of fields through per-field schema definitions
        for name, value in attrs.items():
            
            if name not in self: raise EncodeError(f'unknown field "{name}", expected one of {list(self.keys())}')
            encoded[name] = self[name].encode_one(value, registry)
            
        return encoded
        
    def _decode(self, encoded, registry):

        if not isinstance(encoded, dict): raise DecodeError(f"expected a <dict>, not {encoded}")
        attrs = {}
        
        # decode values of fields
        for name, value in encoded.items():
            
            if name not in self: raise DecodeError(f'invalid field "{name}", not present in schema of a STRUCT')
            attrs[name] = self[name].decode_one(value, registry)
            
        if self.type is struct:
            return struct(attrs)
        
        return setstate(self.type, attrs)
    
# def struct(typename, __type__ = object, **__fields__):
#     """Dynamically create a subclass of STRUCT."""
#
#     class _struct_(STRUCT):
#         type = __type__
#         fields = __fields__
#
#     _struct_.__name__ = typename
#     return _struct_

    
#####################################################################################################################################################
#####
#####  Special-purpose schema
#####

class FIELD(STRUCT):
    """Schema of a field specification in a category's list of fields."""

    type = Field
    fields = {
        'schema':  OBJECT(base = Schema),       # VARIANT(OBJECT(base=Schema), LINK(schema-category))
        'default': OBJECT(),
        'multi':   BOOLEAN(),
        'info':    STRING(),
    }

    # def display(self, obj):
    #
    #     parts = []
    #     for name, schema in self.fields.items():
    #         v = getattr(obj, name, 'MISSING')
    #         s, t = schema.display(v)
    #         if t == 'plaintext': s = esc(s)
    #         parts.append(f"{name}:{s}")
    #
    #     return html(' '.join(parts))
        

# INFO: it's possible to use field_schema and record_schema, as below,
#       but the YAML output of the root category becomes more verbose then (multiple nesting levels)
#
# field_schema = STRUCT(Field,
#                       schema    = OBJECT(base = Schema),
#                       default   = OBJECT(),
#                       multi     = BOOLEAN(),
#                       info      = STRING(),
#                       )
#
# record_schema = STRUCT(FIELDS,
#                        fields = DICT(STRING(), FIELD()),
#                        strict = BOOLEAN(),
#                        )
    
