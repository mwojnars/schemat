
from .errors import EncodeError, EncodeErrors, DecodeError
from .multidict import MultiDict
from .fields import Field


#####################################################################################################################################################
#####
#####  SCHEMA
#####

class Schema(Field):
    """Schema of item data in a category, as a list of field names and their types."""

    class Attribute:
        """Helper class to store all pieces of information about a particular field."""
        info    = None      # human-readable description
        type_   = None      # subclass of Value represented by a Class instance
        default = None      # the value assumed if this field is missing in an item
        multi   = False     # whether this field can take on multiple values
    
        
    fields = None       # field names & their types, as a dict; generic type is assumed if type is None or missing
    strict = None       # if True, only the fields present in `attrs` can occur in the data being encoded
    
    def __init__(self):
        # self.attrs = []
        self.fields = {}
    
    def _encode(self, data):
        
        if not isinstance(data, MultiDict): raise EncodeError(f"expected a MultiDict, not {data}")
        errors = []
        
        # encode & compactify values of fields through per-field type definitions
        encoded = data.dict_all()
        for field, values in encoded.items():
            
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
            
            # de-compactification of singleton lists
            if not isinstance(values, list):
                data[field] = values = [values]
        
            # schema-based decoding
            ftype = self.fields.get(field)
            if ftype:
                data[field] = list(map(ftype.decode, values))
                
        data = MultiDict(multiple = data)
        return data
    

