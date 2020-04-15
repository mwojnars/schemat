
from .errors import EncodeError, EncodeErrors, DecodeError
from .jsonpickle import JsonPickle
from .multidict import MultiDict

#####################################################################################################################################################
#####
#####  TYPE
#####

class Type:
    """
    Base class for type definition of an item's attribute, its value or a part of it.
    Provides schema-based validation and schema-aware serialization.
    """

    _json = JsonPickle()
    
    def encode_json(self, value):
        
        flat = self.encode(value)
        return self._json.dumps(flat)

    def decode_json(self, dump):

        flat = self._json.loads(dump)
        return self.decode(flat)
    

    def encode(self, value):
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

    def decode(self, value):
        """
        Override in subclasses to decode a "flat" value returned by encode()
        back into custom python types.
        """
        return value


#####################################################################################################################################################
#####
#####  SCHEMA
#####

class Schema(Type):
    """Schema of items in a category, as a list of attribute names and their types."""

    class Attribute:
        """Helper class to store all pieces of information about a particular attribute."""
        info    = None      # human-readable description
        type_   = None      # subclass of Value represented by a Class instance
        default = None      # the value assumed if this attribute is missing in an item
        multi   = False     # whether this attribute can take on multiple values
    

    attrs = None        # optional list/set of attibute names; if present, only these attributes can occur in item's __data__
    types = None        # types of attribute values, as a dict; generic type is assumed for attributes not present in `types`
    
    def __init__(self):
        self.attrs = set()
        self.types = {}
    
    def encode(self, data):
        
        if not isinstance(data, MultiDict): raise EncodeError(f"expected a MultiDict, not {data}")
        errors = []
        
        # encode & compactify values of attributes through per-attribute type definitions
        encoded = data.all_values()
        for attr, values in encoded.items():
            
            # type-aware encoding
            atype = self.types.get(attr)
            if atype:
                encoded[attr] = values = list(map(atype.encode, values))
            # TODO: catch atype.encode() exceptions and append to `errors`
            
            # compactify singleton lists
            if len(values) == 1 and not isinstance(values[0], list):
                encoded[attr] = values[0]
            
        if errors:
            raise EncodeErrors(errors)
            
        return encoded
        
        
    def decode(self, data):
        
        if not isinstance(data, dict): raise DecodeError(f"expected a <dict>, not {data}")

        # de-compactify & decode values of attributes
        for attr, values in data.items():
            
            # de-compactification of singleton lists
            if not isinstance(values, list):
                data[attr] = values = [values]
        
            # schema-based decoding
            atype = self.types.get(attr)
            if atype:
                data[attr] = list(map(atype.decode, values))
                
        data = MultiDict(multiple = data)
        return data
    

