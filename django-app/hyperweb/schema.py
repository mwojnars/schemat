
from .errors import EncodeError, EncodeErrors, DecodeError
from .jsonpickle import getstate, setstate
from .multidict import MultiDict
from .types import Schema, Boolean, String, Dict, Object


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
    
    def encode_one(self, value):
        return self.schema.encode(value)
    
    def decode_one(self, encoded):
        return self.schema.decode(encoded)
    
    def encode_many(self, values):
        """There can be multiple `values` to encode if self.multi is true. `values` is a list."""
        if len(values) >= 2 and not self.multi: raise Exception(f"multiple values not allowed by {self} schema")
        encoded = list(map(self.schema.encode, values))

        # compactify singleton lists
        if not self.multi or (len(encoded) == 1 and not isinstance(encoded[0], list)):
            encoded = encoded[0]
            
        return encoded
        
    def decode_many(self, encoded):
        """Returns a list of value(s)."""
        
        # de-compactification of singleton lists
        if not self.multi or not isinstance(encoded, list):
            encoded = [encoded]
    
        # schema-based decoding
        return list(map(self.schema.decode, encoded))
        
        
#####################################################################################################################################################

class Record(Schema):
    """
    Record of data composed of named fields stored as a MultiDict. Primarily used for schema definition
    inside categories. Can also be used as a sub-schema in compound schema definitions. Instances of MultiDict
    are valid objects for encoding. If standard dict-like functionality is desired, field.multi should be set
    to False in all fields.
    """
    
    fields   = None     # dict of field names & their Field() schema descriptors
    strict   = True     # if True, only the fields present in `fields` can occur in the data being encoded
    blank    = False
    
    def __init__(self, **fields):
        assert all(isinstance(name, str) and isinstance(schema, (Schema, Field)) for name, schema in fields.items())
        self.fields = fields
        self._init_fields()
    
    def __setstate__(self, state):
        self.__dict__ = dict(state)
        self._init_fields()

    def _init_fields(self):
        """Wrap up in Field all the fields whose values are plain Schema instances."""
        for name, field in self.fields.items():
            if isinstance(field, Field): continue
            # assert not field or isinstance(field, Schema)
            self.fields[name] = Field(schema = field)
        
    
    def _encode(self, data):
        """
        Convert a MultiDict (`data`) to a dict of {attr_name: encoded_values} pairs,
        while schema-encoding each field value beforehand.
        """
        
        if not isinstance(data, MultiDict): raise EncodeError(f"expected a MultiDict, got {data}")
        errors = []
        
        assert self.strict
        
        # encode & compactify values of fields through per-field schema definitions
        encoded = data.asdict_lists()
        for name, values in encoded.items():
            
            if self.strict and name not in self.fields:
                raise EncodeError(f'unknown field "{name}"')
            
            # schema-aware encoding
            field = self.fields.get(name)
            if field:
                encoded[name] = field.encode_many(values)
            # TODO: catch atype.encode() exceptions and append to `errors`
            
        if errors:
            raise EncodeErrors(errors)
            
        return encoded
        
        
    def _decode(self, data):
        """
        Decode a dict of {attr: value(s)} back to a MultiDict.
        Perform recursive top-down schema-based decoding of field values.
        """
        
        if not isinstance(data, dict): raise DecodeError(f"expected a <dict>, not {data}")
        assert self.strict

        # de-compactify & decode values of fields
        for name, values in data.items():
            
            if self.strict and name not in self.fields:
                raise DecodeError(f'field "{name}" of a record not allowed by its schema definition')
            
            # schema-based decoding
            field = self.fields.get(name)
            if field:
                data[name] = field.decode_many(values)
                
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
    
    def __init__(self, __type__ = object, **fields):
        self.type = __type__
        super(Struct, self).__init__(**fields)
        for name, field in self.fields.items():
            if field.multi: raise Exception(f'multiple values are not allowed for a field ("{name}") of a Struct schema')
    
    def _encode(self, obj):
        """
        Convert a MultiDict (`data`) to a dict of {attr_name: encoded_values} pairs,
        while schema-encoding each field value beforehand.
        """
        
        if not isinstance(obj, self.type): raise EncodeError(f"expected an object of type {self.type}, got {obj}")
        attrs = getstate(obj)
        encoded = {}
        
        # encode values of fields through per-field schema definitions
        for name, value in attrs.items():
            
            if name not in self.fields: raise EncodeError(f'unknown field "{name}"')
            encoded[name] = self.fields[name].encode_one(value)
            
        return encoded
        
    def _decode(self, encoded):
        """
        Decode a dict of {attr: value(s)} back to a MultiDict.
        Perform recursive top-down schema-based decoding of field values.
        """
        if not isinstance(encoded, dict): raise DecodeError(f"expected a <dict>, not {encoded}")
        attrs = {}
        
        # decode values of fields
        for name, value in encoded.items():
            
            if name not in self.fields: raise DecodeError(f'invalid field "{name}", not present in schema of a Struct')
            attrs[name] = self.fields[name].decode_one(value)
                
        return setstate(self.type, attrs)
    
#####################################################################################################################################################

class FieldSchema(Struct):
    """Schema of a field specification inside item's schema definition."""
    
    type = Field
    fields = {
        'schema':  Object(base = Schema),       # Switch(Object(base=Schema), Link(schema-category))
        'default': Object(),
        'multi':   Boolean(),
        'info':    String(),
    }

class ItemSchema(Struct):
    """Schema of item's schema for use inside category definitions."""
    
    type = Record
    fields = {
        'fields': Dict(String(), FieldSchema),  #Object(type=Field or base=Schema) Object(base=(Field,Schema))
        'strict': Boolean(),
    }
    