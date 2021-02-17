
from .errors import EncodeError, EncodeErrors, DecodeError
from .multidict import MultiDict
from .fields import Field


#####################################################################################################################################################
#####
#####  SCHEMA
#####

class Schema(Field):
    """Schema of item data in a category, as a list of field names and their types."""

    class Attribute:  # Field
        """Helper class to store all pieces of information about a particular field."""
        info    = None      # human-readable description
        type    = None      # subclass of Type represented by a Class instance
        default = None      # value assumed if this field is missing in an item
        multi   = False     # whether this field can take on multiple values
    
    fields   = None     # dict of field names & their types; generic type is assumed if a type is None or missing
    defaults = None     # dict of default values for selected fields
    strict   = False    # if True, only the fields present in `fields` can occur in the data being encoded
    
    def __init__(self):
        # self.attrs = []
        self.fields = {}
    
    def _encode(self, data):
        """Convert item's __data__ object (multidict) to a dict of {attr_name: encoded_values} pairs."""
        
        if not isinstance(data, MultiDict): raise EncodeError(f"expected a MultiDict, not {data}")
        errors = []
        
        # encode & compactify values of fields through per-field type definitions
        encoded = data.asdict_multi()
        for field, values in encoded.items():
            
            if self.strict and field not in self.fields:
                raise EncodeError(f'unknown field "{field}"')
            
            # type-aware encoding
            ftype = self.fields.get(field)
            if ftype:
                encoded[field] = values = list(map(ftype.encode, values))
            # TODO: catch atype.encode() exceptions and append to `errors`
            
            # compactify singleton lists
            if len(values) == 1 and not isinstance(values[0], list):
                encoded[field] = values[0]
            
        if errors:
            raise EncodeErrors(errors)
            
        return encoded
        
        
    def _decode(self, data):
        
        if not isinstance(data, dict): raise DecodeError(f"expected a <dict>, not {data}")

        # de-compactify & decode values of fields
        for field, values in data.items():
            
            if self.strict and field not in self.fields:
                raise DecodeError(f'unknown field "{field}"')
            
            # de-compactification of singleton lists
            if not isinstance(values, list):
                data[field] = values = [values]
        
            # schema-based decoding
            ftype = self.fields.get(field)
            if ftype:
                data[field] = list(map(ftype.decode, values))
                
        data = MultiDict(multiple = data)
        return data
    
    
    def get_default(self, name):
        """
        Get the default value of a given item attribute as defined in this schema.
        Return a pair (value, found), where `found` is True (there is a default) or False (no default found).
        """
        field = self.fields.get(name)
        if field.default is MISSING:
            return None, False
        else:
            return field.default, True
        
        # if self.defaults and attr in self.defaults:
        #     return self.defaults[attr], True
        # else:
        #     return None, False

