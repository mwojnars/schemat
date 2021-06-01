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

Tuple
List / Sequence
Dict / Mapping

"""

from .errors import EncodeError, EncodeErrors, DecodeError
from .jsonpickle import JsonPickle

jsonp = JsonPickle()


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
    
    
    def to_json(self, value, registry):
        """
        JSON-encoding proceeds in two phases:
        1) reduction of the original `value` (with nested objects) to a smaller `flat` object using any external
           type information that's available; the flat object may still contain nested non-primitive objects;
        2) encoding of the `flat` object through JsonPickle; external type information is no longer used.
        """
        
        flat = self.encode(value)
        return jsonp.dumps(flat)

    def from_json(self, dump, registry):

        flat = jsonp.loads(dump)
        return self.decode(flat)
    

    def encode(self, value):
        if value is None:
            if self.blank: return None
            raise EncodeError("missing value (None) not permitted")
        
        state = self._encode(value)
        if self.blank:
            if state is None: raise EncodeError(f"internal error in class {self.__class__}, encoded state of {value} is None, which is not permitted with blank=true")

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
#####  ATOMIC types
#####

class Object(Schema):
    """
    Accepts any python object, optionally restricted to objects of a predefined class.
    During decoding, the predefined class is implied if the data deserialized don't have class specification.
    """

    class_ = None       # python class to be implied for objects during decoding; if strict=True, only objects of this class can be encoded
    strict = True       # [bool] if True, only instances of <class_> are allowed in encode/decode, otherwise an exception is raised
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
                return jsonp.getstate(obj, class_attr = None)
            except TypeError as ex:
                raise EncodeError(f"can't retrieve state of an object: {ex}")
            
        elif self.strict:
            raise EncodeError(f"expected an instance of {cls}, but found: {obj}")
        else:
            return obj

    def _decode(self, state):
        cls = self.class_
        if not cls or isinstance(state, cls): return state
        
        # cast a <dict> to an instance of the implicit class
        if isinstance(state, dict):
            return jsonp.setstate(cls, state)
        if self.strict:
            raise DecodeError(f"the object decoded is not an instance of {cls}: {state}")
        return state

    def _json_primitive(self, obj):
    
        return obj is None or isinstance(obj, (bool, int, float, tuple, list, dict))


class Class(Schema):
    """
    Accepts any global python class and encodes as a string containing its full package-module name.
    """
    def _encode(self, value):
        if value is None: return None
        return jsonp.classname(cls = value)
    
    def _decode(self, value):
        if not isinstance(value, str): raise DecodeError(f"expected a <str>, not {value}")
        return jsonp.import_(value)
        

class String(Schema):
    
    def _encode(self, value):
        if not isinstance(value, str): raise EncodeError(f"expected a <str>, not {value}")
        return value

    def _decode(self, value):
        if not isinstance(value, str): raise DecodeError(f"expected a <str>, not {value}")
        return value

class Dict(Schema):
    """
    Field that accepts <dict> objects as data values and ensures that keys and values of the dict
    are interpreted as fields of particular Field types.
    """
    
    # optional specification of Fields to be used for interpreting keys/values of incoming dicts
    keys   = None
    values = None
    
    def __init__(self, keys = None, values = None):
        
        if keys is not None: self.keys = keys
        if values is not None: self.values = values
        
    def _encode(self, d):
        
        if not isinstance(d, dict): raise EncodeError(f"expected a <dict>, not {d}")
        state = {}
        
        # encode keys & values through predefined field types
        for key, value in d.items():
            k = self.keys.encode(key) if self.keys else key
            if k in state: raise EncodeError(f"duplicate state ({k}) returned by field's {self.keys} encode() for 2 different values, one of them: {key}")
            state[k] = self.values.encode(value) if self.values else value
        
        return state
        
    def _decode(self, state):
        
        if not isinstance(state, dict): raise DecodeError(f"expected a <dict>, not {state}")
        d = {}
        
        # decode keys & values through predefined field types
        for key, value in state.items():
            k = self.keys.decode(key) if self.keys else key
            if k in d: raise DecodeError(f"duplicate value ({k}) returned by field's {self.keys} decode() for 2 different states, one of them: {key}")
            d[k] = self.values.decode(value) if self.values else value
            
        return d


class Link(Schema):
    """
    The python value is an Item object.
    The DB value is an ID=(CID,IID), or just IID, of an item.
    """
    
    # default CID: if item's CID is equal to this, only IID is stored; otherwise, complete ID is stored
    cid = None
    
    def __init__(self, cid = None):
        self.cid = cid
    
    def _encode(self, item):
        
        if None in item.id:
            raise EncodeError(f"Linked item does not exist or its ID is missing, ID={item.id}")
            
        if self.cid is not None and item.cid == self.cid:
            return item.iid
        
        return item.id

    def _decode(self, value):
        
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
        from .site import registry
        
        return registry.get_item((cid, iid))
        

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


    