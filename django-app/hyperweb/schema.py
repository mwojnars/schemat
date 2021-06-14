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

List / Sequence
Dict / Mapping
"""

import json

from .errors import EncodeError, EncodeErrors, DecodeError
from .serialize import classname, import_, getstate, setstate
from .multidict import MultiDict
from .item import Item


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
    
    # registry = None
    
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
        """Encode recursively all non-primitive objects inside a list of values using the generic object_schema = Object()."""
        return [object_schema._encode(v, registry) for v in values]
        
    @staticmethod
    def _decode_list(state, registry):
        """Decode recursively all non-primitive objects inside a list of values using the generic object_schema = Object()."""
        return [object_schema._decode(v, registry) for v in state]
        
    @staticmethod
    def _encode_dict(state, registry):
        """Encode recursively all non-primitive objects inside `state` using the generic object_schema = Object()."""
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
        """Decode recursively all non-primitive objects inside `state` using the generic object_schema = Object()."""
        return {k: object_schema._decode(v, registry) for k, v in state.items()}


# the most generic schema for encoding/decoding any types of objects; used internally in Object()
# for recursive encoding/decoding of individual values inside a given object's state
object_schema = Object()


class Class(Schema):
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
    """Schema of a specific primitive JSON-serializable python type."""
    
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

class Boolean(Primitive):
    type = bool

class Integer(Primitive):
    type = int

class Float(Primitive):
    type = float

class String(Primitive):
    type = str
    
class Text(Primitive):
    """Similar to String, but differs in how the content is displayed: as a block rather than inline."""
    type = str
    
    
class Link(Schema):
    """
    Encodes an Item into its ID=(CID,IID), or just IID.
    Link() is equivalent to Object(Item), however, Link can be parameterized
    with a predefined CID, Link(cid), which is not possible using an Object.
    """
    
    # default CID: if item's CID is equal to this, only IID is stored; otherwise, complete ID is stored
    cid = None
    
    def __init__(self, category = None, cid = None):
        if category is not None: self.cid = category.iid
        elif cid is not None: self.cid = cid
    
    def _encode(self, item, registry):
        
        # if not isinstance(item, Item): pass
        if None in item.id:
            raise EncodeError(f"Linked item does not exist or its ID is missing, ID={item.id}")
            
        if self.cid is not None and item.cid == self.cid:
            return item.iid
        
        return item.id

    def _decode(self, value, registry):
        
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
        
    def _encode(self, values, registry):
        if not isinstance(values, self.type): raise EncodeError(f"expected a {self.type}, got {values}")
        return [self.schema.encode(v, registry) for v in values]

    def _decode(self, encoded, registry):
        if not isinstance(encoded, list): raise DecodeError(f"expected a list, got {encoded}")
        return self.type(self.schema.decode(e, registry) for e in encoded)

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
        
    def _encode(self, d, registry):
        
        if not isinstance(d, dict): raise EncodeError(f"expected a <dict>, got {type(d)}: {d}")
        state = {}
        
        # encode keys & values through predefined field types
        for key, value in d.items():
            k = self.keys.encode(key, registry) if self.keys else key
            if k in state: raise EncodeError(f"duplicate state ({k}) returned by field's {self.keys} encode() for 2 different values, one of them: {key}")
            state[k] = self.values.encode(value, registry) if self.values else value
        
        return state
        
    def _decode(self, state, registry):
        
        if not isinstance(state, dict): raise DecodeError(f"expected a <dict>, not {state}")
        d = {}
        
        # decode keys & values through predefined field types
        for key, value in state.items():
            k = self.keys.decode(key, registry) if self.keys else key
            if k in d: raise DecodeError(f"duplicate value ({k}) returned by field's {self.keys} decode() for 2 different states, one of them: {key}")
            d[k] = self.values.decode(value, registry) if self.values else value
            
        return d


class Select(Schema):
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
                
        raise EncodeError(f"invalid value, no matching sub-schema in Select for: {value}")
        
    def _decode(self, encoded, registry):
        
        if not (isinstance(encoded, list) and len(encoded) == 2):
            raise DecodeError(f"data corruption in Select, the encoded object should be a 2-element list, got {encoded} instead")
        
        name, encoded = encoded
        schema = self.schemas[name]
        return schema.decode(encoded, registry)
        

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

#####################################################################################################################################################
#####
#####  FIELD & RECORD & STRUCT
#####

class Field:
    """Specification of a field in a Record or Struct."""
    
    MISSING = object()      # token indicating that `default` value is missing; removed from output during serialization
    
    schema  = None          # instance of Schema
    default = MISSING       # value assumed if this field is missing in an item; or MISSING if no default
    multi   = False         # whether this field can take on multiple values
    info    = None          # human-readable description of the field
    
    def __init__(self, schema = None, default = None, multi = None, info = None):
        if schema is not None:  self.schema = schema
        if default is not None: self.default = default
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

class Record(Schema):
    """
    Schema of a record of data composed of named fields stored as a MultiDict. Primarily used for schema definition
    inside categories. Can also be used as a sub-schema in compound schema definitions. Instances of MultiDict
    are valid objects for encoding. If standard dict-like functionality is desired, field.multi should be set
    to False in all fields.
    """

    # default field specification to be used for fields not present in `fields`
    default_field = Field(schema = object_schema, multi = True)
    
    fields   = None     # dict of field names & their Field() schema descriptors
    strict   = True     # if True, only the fields present in `fields` can occur in the data being encoded
    blank    = False
    
    def __init__(self, __strict__ = None, **fields):
        # assert all(isinstance(name, str) and isinstance(schema, (Schema, Field)) for name, schema in fields.items())
        # self.fields = fields or self.fields or {}
        if __strict__ is not None: self.strict = __strict__
        if fields: self.fields = fields
        self._init_fields()
    
    def __setstate__(self, state):
        self.__dict__ = dict(state)
        self._init_fields()

    def _init_fields(self):
        """Wrap up in Field all the fields whose values are plain Schema instances."""
        if self.fields is None: self.fields = {}
        for name, field in self.fields.items():
            assert isinstance(name, str)
            if isinstance(field, Field): continue
            if field and not isinstance(field, Schema): raise Exception(f"expected an instance of Schema, got {field}")
            self.fields[name] = Field(schema = field)
        
    
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
            
            if self.strict and name not in self.fields:
                raise EncodeError(f'unknown field "{name}"')
            
            # schema-aware encoding
            field = self.fields.get(name)
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
            
            if self.strict and name not in self.fields:
                raise DecodeError(f'field "{name}" of a record not allowed by its schema definition')
            
            # schema-based decoding
            field = self.fields.get(name)
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
        field = self.fields.get(name)
        return field.default if field else Field.MISSING


#####################################################################################################################################################

class Struct(Record):
    """
    Schema of a plain dict-like object that contains a number of named fields each one having its own schema.
    Similar to Record, but the app-representation is a regular python object matching the schema
    rather than a MultiDict; and multiple values are not allowed for a field.
    """
    
    type = None         # python type of accepted app-representation objects; instances of subclasses of `type` are NOT accepted
    
    def __init__(self, __type__ = None, **fields):
        if __type__: self.type = __type__
        super(Struct, self).__init__(**fields)
        for name, field in self.fields.items():
            if field.multi: raise Exception(f'multiple values are not allowed for a field ("{name}") of a Struct schema')
    
    def _encode(self, obj, registry):
        """
        Convert a MultiDict (`data`) to a dict of {attr_name: encoded_values} pairs,
        while schema-encoding each field value beforehand.
        """
        
        if not isinstance(obj, self.type): raise EncodeError(f"expected an object of type {self.type}, got {obj}")
        attrs = getstate(obj)
        encoded = {}
        
        # encode values of fields through per-field schema definitions
        for name, value in attrs.items():
            
            if name not in self.fields: raise EncodeError(f'unknown field "{name}", expected one of {list(self.fields.keys())}')
            encoded[name] = self.fields[name].encode_one(value, registry)
            
        return encoded
        
    def _decode(self, encoded, registry):
        """
        Decode a dict of {attr: value(s)} back to a MultiDict.
        Perform recursive top-down schema-based decoding of field values.
        """
        if not isinstance(encoded, dict): raise DecodeError(f"expected a <dict>, not {encoded}")
        attrs = {}
        
        # decode values of fields
        for name, value in encoded.items():
            
            if name not in self.fields: raise DecodeError(f'invalid field "{name}", not present in schema of a Struct')
            attrs[name] = self.fields[name].decode_one(value, registry)
                
        return setstate(self.type, attrs)
    
# def struct(typename, __type__ = object, **__fields__):
#     """Dynamically create a subclass of Struct."""
#
#     class _struct_(Struct):
#         type = __type__
#         fields = __fields__
#
#     _struct_.__name__ = typename
#     return _struct_

    
#####################################################################################################################################################
#####
#####  Special-purpose schema
#####

class FieldSchema(Struct):
    """Schema of a field specification inside item's schema definition."""

    type = Field
    fields = {
        'schema':  Object(base = Schema),       # Select(Object(base=Schema), Link(schema-category))
        'default': Object(),
        'multi':   Boolean(),
        'info':    String(),
    }

class RecordSchema(Struct):
    """Schema of item's schema for use inside category definitions."""

    type = Record
    fields = {
        'fields': Dict(String(), FieldSchema()),  #Object(type=Field or base=Schema) Object(base=(Field,Schema))
        'strict': Boolean(),
    }

# INFO: it's possible to use field_schema and record_schema, as below,
#       only the YAML output of the root category is more verbose then (multiple nesting levels)
#
# field_schema = Struct(Field,
#                       schema    = Object(base = Schema),
#                       default   = Object(),
#                       multi     = Boolean(),
#                       info      = String(),
#                       )
#
# record_schema = Struct(Record,
#                        fields = Dict(String(), FieldSchema()),
#                        strict = Boolean(),
#                        )
    
