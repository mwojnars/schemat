from .errors import EncodeError, EncodeErrors, DecodeError
from .globals import aliases
from .jsonpickle import JsonPickle


#####################################################################################################################################################
#####
#####  FIELD
#####

class Field:
    """
    Base class for definition of data fields: their values and sub-values.
    Provides schema-based validation of form values and schema-aware serialization.
    Fields can be nested.
    
               sanitize >          encode >
       FORM       ---      DATA      ---      STATE
               < form             < decode
    
    Exceptions:
    - ValidationError in sanitize() -- invalid value submitted from a form
    - SchemaError in encode() -- input object doesn't fit the schema
    - DataError in decode() -- inconsistent data in DB
    """
    
    # class-level global object
    _json = JsonPickle()
    
    # instance-level settings
    blank = True            # if True, None is a valid input value and is encoded as None; no other valid value can produce None as its serializable state

    
    def encode_json(self, value):
        
        flat = self.encode(value)
        return self._json.dumps(flat)

    def decode_json(self, dump):

        flat = self._json.loads(dump)
        return self.decode(flat)
    

    def encode(self, value):
        if value is None:
            if self.blank: return None
            raise EncodeError("missing value (None) not permitted")
        
        state = self._encode(value)
        if self.blank:
            assert state is not None, f"internal error in class {self.__class__}, encoded state of {value} is None, which is not permitted with blank=true"

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


#####################################################################################################################################################
#####
#####  ATOMIC types
#####

class Object(Field):
    """
    Accepts any python object, optionally restricted to objects of a predefined class.
    During decoding, the predefined class is implied if the data deserialized don't have class specification.
    """

    class_ = None       # python class to be implied for objects during decoding; if strict=True, only objects of this class can be encoded
    strict = False      # [bool] if True, only instances of <class_> are allowed in encode/decode, otherwise an exception is raised
    #skip_empty = False # if True, empty collections (list/tuple/set/dict) in the object are removed during encoding
    
    def __init__(self, class_ = None, strict = False):
        self.class_ = class_
        self.strict = strict

    def _encode(self, obj):
        cls = self.class_
        if not cls: return obj
        
        if isinstance(obj, cls):
            if self._json_primitive(obj): return obj
            try:
                return aliases.getstate(obj, class_attr = None)
            except TypeError as ex:
                raise EncodeError(f"can't retrieve state of an object: {ex}")
            
        elif self.strict:
            raise EncodeError(f"expected an instance of {cls}, but found: {obj}")
        else:
            return obj

    def _decode(self, state):
        cls = self.class_
        print("Object.decode:", cls, state)
        if not cls or isinstance(state, cls): return state
        
        # cast a <dict> to an instance of the implicit class
        if isinstance(state, dict):
            return aliases.setstate(cls, state)
        if self.strict:
            raise DecodeError(f"the object decoded is not an instance of {cls}: {state}")
        return state

    def _json_primitive(self, obj):
    
        return obj is None or isinstance(obj, (bool, int, float, tuple, list, dict))


class Class(Field):
    """
    Accepts any global python class and encodes as a string containing its full package-module name.
    The name is transformed through global `aliases`.
    """
    
    def _encode(self, value):
        if value is None: return None
        return aliases.classname(cls = value)
    
    def _decode(self, value):
        if not isinstance(value, str): raise DecodeError(f"expected a <str>, not {value}")
        return aliases.import_(value)
        

class String(Field):
    
    def _encode(self, value):
        if not isinstance(value, str): raise EncodeError(f"expected a <str>, not {value}")
        return value

    def _decode(self, value):
        if not isinstance(value, str): raise DecodeError(f"expected a <str>, not {value}")
        return value


class Dict(Field):
    """Specification of a key-value mapping where every key must be unique; wrapper for a standard <dict> type."""

    key_type = None
    value_type = None
    

class Link(Field):
    """
    The python value is an Item object.
    The DB value is an ID=(CID,IID), or just IID, of an item.
    """
    
    # default CID: if item's CID is equal to this, only IID is stored; otherwise, complete ID is stored
    cid = None
    
    def __init__(self, cid = None):
        self.cid = cid
    
    def _encode(self, item):
        
        if None in item.__id__:
            raise EncodeError(f"Linked item does not exist or its ID is missing, ID={item.__id__}")
            
        if self.cid is not None and item.__cid__ == self.cid:
            return item.__iid__
        
        return item.__id__

    def _decode(self, value):
        
        cid = iid = None
        
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

        from .core import Site
        category = Site._categories[cid]
        return category.new(__id__ = (cid, iid))
        