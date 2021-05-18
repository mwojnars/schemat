
from .errors import EncodeError, EncodeErrors, DecodeError
from .multidict import MultiDict
from .types import Type


#####################################################################################################################################################
#####
#####  SCHEMA
#####

class Field:
    """Specification of a field in a dict-like record of data (Record)."""
    info    = None      # human-readable description
    type    = None      # subclass of Type represented by a Class instance
    default = None      # value assumed if this field is missing in an item
    multi   = False     # whether this field can take on multiple values


class Record(Type):
    """
    Dict-like record of data composed of named fields. Primarily used as a type for schema definition inside categories.
    Can also be used as a sub-type in compound type definitions.
    
    Record recognizes MultiDict as valid objects for encoding.
    The ORDERING of fields in an Record instance is the same
    """

    fields   = None     # dict of field names & their types; generic type is assumed if a type is None or missing
    strict   = False    # if True, only the fields present in `fields` can occur in the data being encoded
    
    def __init__(self):
        self.fields = {}
    
    def _encode(self, data):
        """Convert item's __data__ object (multidict) to a dict of {attr_name: encoded_values} pairs."""
        
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
                raise DecodeError(f'field "{field}" found in an item but not present in category schema')
            
            # de-compactification of singleton lists
            if not isinstance(values, list):
                data[field] = values = [values]
        
            # schema-based decoding
            ftype = self.fields.get(field)
            if ftype:
                data[field] = list(map(ftype.decode, values))
                
        data = MultiDict(multiple = data)
        return data
    
    
    # def get_default(self, name):
    #     """
    #     Get the default value of a given item attribute as defined in this schema.
    #     Return a pair (value, found), where `found` is True (there is a default) or False (no default found).
    #     """
    #     field = self.fields.get(name)
    #     if field.default is MISSING:
    #         return None, False
    #     else:
    #         return field.default, True
    #
    #     # if self.defaults and attr in self.defaults:
    #     #     return self.defaults[attr], True
    #     # else:
    #     #     return None, False


class Schema(Record):
    pass
