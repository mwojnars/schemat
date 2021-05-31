
from .errors import EncodeError, EncodeErrors, DecodeError
from .multidict import MultiDict
from .types import Schema


#####################################################################################################################################################
#####
#####  SCHEMA
#####

class Field:
    """Specification of a field in a Record."""
    
    MISSING = object()      # token indicating that `default` value is missing; removed from output during serialization
    
    schema    = None        # instance of Schema
    default = MISSING       # value assumed if this field is missing in an item; or MISSING if no default
    multi   = False         # whether this field can take on multiple values
    info    = None          # human-readable description of the field
    # compact = True          # whether a list of values (when multi=True) should be compactified if possible
    
    def __init__(self, schema = None, default = None, multi = None, info = None):
        if schema is not None:  self.schema = schema
        if default is not None: self.default = default
        if multi is not None:   self.multi = multi
        if info is not None:    self.info = info
    
    def __getstate__(self):
        if len(self.__dict__) == 1 and 'schema' in self.__dict__:   # compact state when only `schema` is configured
            return self.schema
        
        if self.__dict__.get('default') is Field.MISSING:           # exclude explicit MISSING value from serialization
            state = self.__dict__.copy()
            del state['default']
        else:
            state = self.__dict__
            
        return state
    
    def encode(self, values):
        pass
        

class Record(Schema):
    """
    Record of data composed of named fields stored as a MultiDict. Primarily used for schema definition
    inside categories. Can also be used as a sub-schema in compound schema definitions. Instances of MultiDict
    are valid objects for encoding. If standard dict-like functionality is desired, field.multi should be set
    to False in all fields.
    """
    
    fields   = None     # dict of field names & their Field() schema descriptors
    strict   = True     # if True, only the fields present in `fields` can occur in the data being encoded
    
    def __init__(self, fields = None):
        self.fields = dict(fields) if fields else {}
        self._init_fields()
    
    def __setstate__(self, state):
        self.__dict__ = dict(state)
        self._init_fields()

    def _init_fields(self):
        """Wrap up in Field all the fields whose values are plain Schema instances."""
        if self.fields is None: self.fields = {}
        for name, field in self.fields.items():
            if isinstance(field, Field): continue
            assert not field or isinstance(field, Schema)
            self.fields[name] = Field(schema = field)
        
    
    def _encode(self, data):
        """Convert item's data (multidict) to a dict of {attr_name: encoded_values} pairs."""
        
        if not isinstance(data, MultiDict): raise EncodeError(f"expected a MultiDict, not {data}")
        errors = []
        
        # encode & compactify values of fields through per-field schema definitions
        encoded = data.asdict_lists()
        for name, values in encoded.items():
            
            if self.strict and name not in self.fields:
                raise EncodeError(f'unknown field "{name}"')
            
            # schema-aware encoding
            field = self.fields.get(name)
            if field:
                encoded[name] = values = list(map(field.schema.encode, values))
            # TODO: catch atype.encode() exceptions and append to `errors`
            
            # compactify singleton lists
            if len(values) == 1 and not isinstance(values[0], list):
                encoded[name] = values[0]
            
        if errors:
            raise EncodeErrors(errors)
            
        return encoded
        
        
    def _decode(self, data):
        """Decode a dict of {attr: value(s)} back to a MultiDict."""
        
        if not isinstance(data, dict): raise DecodeError(f"expected a <dict>, not {data}")

        # de-compactify & decode values of fields
        for name, values in data.items():
            
            if self.strict and name not in self.fields:
                raise DecodeError(f'field "{name}" of a record not allowed by its schema definition')
            
            # de-compactification of singleton lists
            if not isinstance(values, list):
                data[name] = values = [values]
        
            # schema-based decoding
            field = self.fields.get(name)
            if field:
                data[name] = list(map(field.schema.decode, values))
                
        data = MultiDict(multiple = data)
        return data
    
    
    def get_default(self, name):
        """
        Get the default value of a given item attribute as defined in this schema.
        Return a pair (value, found), where `found` is True (there is a default) or False (no default found).
        """
        field = self.fields.get(name)
        return field.default if field else Field.MISSING

#####################################################################################################################################################

class Struct(Schema):
    """
    Schema of a plain dict-like object that contains a number of named fields each one having its own schema.
    Similar to Record, but the app-representation is a regular python object matching the schema
    rather than a MultiDict; and multiple values are not allowed for a field.
    """
    