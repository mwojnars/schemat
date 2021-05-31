
from .errors import EncodeError, EncodeErrors, DecodeError
from .multidict import MultiDict
from .types import Type


#####################################################################################################################################################
#####
#####  SCHEMA
#####

class Field:
    """Specification of a field in a Record."""
    
    MISSING = object()      # token indicating that `default` value is missing; removed from output during serialization
    
    type    = None          # instance of Type
    default = MISSING       # value assumed if this field is missing in an item; or MISSING if no default
    multi   = False         # whether this field can take on multiple values
    info    = None          # human-readable description of the field
    # compact = True          # whether a list of values (when multi=True) should be compactified if possible
    
    def __init__(self, type = None, default = None, multi = None, info = None):
        if type is not None:    self.type = type
        if default is not None: self.default = default
        if multi is not None:   self.multi = multi
        if info is not None:    self.info = info
    
    def __getstate__(self):
        if len(self.__dict__) == 1 and 'type' in self.__dict__:     # compact state when only `type` is configured
            return self.type
        
        if self.__dict__.get('default') is Field.MISSING:           # exclude explicit MISSING value from serialization
            state = self.__dict__.copy()
            del state['default']
        else:
            state = self.__dict__
            
        return state
    
    def encode(self, values):
        pass
        

class Record(Type):
    """
    Record of data composed of named fields stored as a MultiDict. Primarily used as a type for schema definition
    inside categories. Can also be used as a sub-type in compound type definitions. Instances of MultiDict
    are valid objects for encoding. If standard dict-like functionality is desired, field.multi should be set
    to False in all fields.
    """
    
    fields   = None     # dict of field names & their Field descriptors; generic type is assumed if a type is None or missing
    strict   = True     # if True, only the fields present in `fields` can occur in the data being encoded
    
    def __init__(self, fields = None):
        self.fields = dict(fields) if fields else {}
        self._init_fields()
    
    def __setstate__(self, state):
        self.__dict__ = dict(state)
        self._init_fields()

    def _init_fields(self):
        """Wrap up in Field all the fields whose values are plain Type instances."""
        if self.fields is None: self.fields = {}
        for name, ftype in self.fields.items():
            if isinstance(ftype, Field): continue
            assert not ftype or isinstance(ftype, Type)
            self.fields[name] = Field(type = ftype)
        
    
    def _encode(self, data):
        """Convert item's data (multidict) to a dict of {attr_name: encoded_values} pairs."""
        
        if not isinstance(data, MultiDict): raise EncodeError(f"expected a MultiDict, not {data}")
        errors = []
        
        # encode & compactify values of fields through per-field type definitions
        encoded = data.asdict_lists()
        for field, values in encoded.items():
            
            if self.strict and field not in self.fields:
                raise EncodeError(f'unknown field "{field}"')
            
            # type-aware encoding
            ftype = self.fields.get(field)
            if ftype:
                encoded[field] = values = list(map(ftype.type.encode, values))
            # TODO: catch atype.encode() exceptions and append to `errors`
            
            # compactify singleton lists
            if len(values) == 1 and not isinstance(values[0], list):
                encoded[field] = values[0]
            
        if errors:
            raise EncodeErrors(errors)
            
        return encoded
        
        
    def _decode(self, data):
        """Decode a dict of {attr: value(s)} back to a MultiDict."""
        
        if not isinstance(data, dict): raise DecodeError(f"expected a <dict>, not {data}")

        # de-compactify & decode values of fields
        for field, values in data.items():
            
            if self.strict and field not in self.fields:
                raise DecodeError(f'field "{field}" of a record not allowed by its type definition')
            
            # de-compactification of singleton lists
            if not isinstance(values, list):
                data[field] = values = [values]
        
            # schema-based decoding
            ftype = self.fields.get(field)
            if ftype:
                data[field] = list(map(ftype.type.decode, values))
                
        data = MultiDict(multiple = data)
        return data
    
    
    def get_default(self, name):
        """
        Get the default value of a given item attribute as defined in this schema.
        Return a pair (value, found), where `found` is True (there is a default) or False (no default found).
        """
        field = self.fields.get(name)
        return field.default if field else Field.MISSING

