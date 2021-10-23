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
Email

List / Sequence
Dict / Mapping
"""

import json, base64
from hypertag.std.html import html_escape as esc
from hypertag import HyperHTML

# from .utils import dedent
from .errors import EncodeError, EncodeErrors, DecodeError
from .serialize import getstate, setstate, JSON
from .multidict import MultiDict
from .struct import struct, catalog


#####################################################################################################################################################
#####
#####  SCHEMA
#####

class multiple:
    """
    List of multiple values for a single data element (field of STRUCT), all matching a common schema.
    Optionally, the values can be accompanied with textual labels. Values can be accessed by positions or labels.
    If labels are present, they must differ between each other. Empty string is a valid non-missing label.
    In methods, "key" means either an index (integer position), or a label (string).
    """
    values = None       # list of (label, value) pairs, if labels are present, or a list of values otherwise
    labels = None       # dict of labels and their positions in `entries`: {label: index}; or None if labels not used
    
    @property
    def has_labels(self): return self.labels is not None
    
    def __init__(self, *unlabeled_values, **labeled_values):
        assert not (unlabeled_values and labeled_values), "can't use labeled and unlabeled values at the same time"
        if unlabeled_values:
            self.values = list(unlabeled_values)
        else:
            self.values = list(labeled_values.items())
            self.labels = {label: pos for pos, label in enumerate(labeled_values)}
        
    def __contains__(self, key):
        return (key in self.labels) if isinstance(key, str) else (0 <= key < len(self.values))

    def __getitem__(self, key):
        pos = self.position(key)
        entry = self.values[pos]
        return entry[1] if self.has_labels else entry

    def __delitem__(self, key):
        pos = self.position(key)
        if self.has_labels:
            label = self.values[pos][0]
            del self.labels[label]
        del self.values[pos]
        
    def get(self, key, default = None):
        return self[key] if key in self else default
        
    def append(self, value, label = None):
        if label is not None:
            assert self.has_labels, f"trying to insert a labeled value ({label}, {value}) to an unlabeled multiple"
            assert isinstance(label, str), f"label must be a string, not {label}"
            assert label not in self.labels, f"duplicate label '{label}'"
            self.labels[label] = len(self.values)
        entry = (label, value) if self.has_labels else value
        self.values.append(entry)

    def position(self, key):
        return self.labels[key] if isinstance(key, str) else key
    
# class multidict(multiple): pass
# class multilist(multiple): pass


#####################################################################################################################################################

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
                             display
               sanitize >                encode >
       FORM       ---         DATA         ---      STATE
                < form                  < decode
                
         
       PREVIEW
        ^^
       FORM (fields)   <--->   VALUE (object)   <--->   DB (json)
       

    Exceptions:
    - ValidationError in sanitize() -- invalid value submitted from a form
    - SchemaError in encode() -- input object doesn't fit the schema
    - DataError in decode() -- inconsistent data in DB
    """
    
    name  = None            # name of this schema instance for messaging purposes (not used currently)
    registry = None         # (TODO) global registry instance, like Item.registry (not used currently)
    
    # # instance-level settings
    # blank = True            # if True, None is a valid input value and is encoded as None;
    #                         # no other valid value can produce None as its serializable state
    # required = False        # (unused) if True, the value for encoding must be non-empty (true boolean value)
    
    default = None          # default value to be used in web forms or upon reads when no value was provided (yet) by a user
    info    = None          # human-readable description of this schema: what values are accepted and how are they interpreted
    multi   = False         # if multi=True and the schema is assigned to a field of STRUCT, the field can take on
                            # multiple values represented by a <multiple> instance;
                            # the detection of a multiple is done by a parent STRUCT (TODO), which calls
                            # encode_multi() instead of encode() and appends * to a field name in output state

    is_catalog = False      # True only in CATALOG and subclasses
    #is_compound = False    # True in schema classes that describe compound objects: catalogs, dicts, lists etc. (OBJECT too!)
    
    def __init__(self, default = None, info = None, multi = None):
        if default is not None: self.default = default
        if info is not None: self.info = info
        if multi is not None: self.multi = multi
    
    def dump_json(self, value, compact = True, **json_format):
        """
        JSON-encoding proceeds in two phases:
        1) reduction of the original `value` (with nested objects) to a smaller `flat` object using any external
           type information that's available; the flat object may still contain nested non-primitive objects;
        2) encoding of the `flat` object through json.dumps(); external type information is no longer used.
        """
        state = self.encode(value)
        return json.dumps(state, ensure_ascii = False, **json_format)

    def load_json(self, dump):

        state = json.loads(dump)
        return self.decode(state)
    
    def encode(self, value):
        """
        Convert `value` - a possibly composite object matching the current schema (self) -
        to a JSON-serializable "state" that does not contain non-standard nested objects anymore.
        By default, generic object encoding (JSON.encode()) is performed.
        Subclasses may override this method to perform more compact, schema-aware encoding.
        """
        return JSON.encode(value)
        
    def decode(self, state):
        """Convert a serializable "state" as returned by encode() back to an original custom object."""
        return JSON.decode(state)
        
    def __str__(self):
        name = self.name or self.__class__.__name__
        return name

    def get_registry(self):
        """Get global Registry. For internal use."""
        if self.registry: return self.registry
        from hyperweb.boot import registry          # TODO: replace with self.registry when Schema becomes an Item subclass
        return registry


    #######################################
    ##  display & edit
    ##
    
    def display(self, value):  # layout (line/block), style (basic/fine or F/T), editable (F/T/restricted-after-login)
        """
        Default (rich-)text representation of `value` for display in a response document, typically as HTML code.
        In the future, this method may return a Hypertag's DOM representation to allow better customization.
        
        Predefined utilities that can be used inside widgets:
        - %protocol hypertag (after import)
        - .scroll (css class) - for elements that should be assigned standard max-height with a scroll box around
        """
        if self.__widget__:
            registry = self.get_registry()
            hypertag = registry.site.hypertag
            return hypertag.render(self.__widget__, value = value, empty = False)
            # runtime = HyperHTML()  #Item.Hypertag
            # return hypertag(self.__widget__, runtime).render(value = value, empty = False)
        
        try:
            return value.__html__()
        except Exception as ex:
            pass
        
        return esc(str(value))

    __widget__ = None
    
    def form(self, value):
        """
        Return an HTML form (top-level #form element) for inputing values of a given schema.
        The form should be accompanied by a static non-editable presentation (#preview element)
        of the current form value. The #form should be initially hidden.
        Only when a user double-clicks on #preview, the #show will hide and the #form will be displayed.
        
        The #form should contain an initial value json-serialized in its "initial-value" attribute.
        On the first #form activation, this initial value gets decoded into values and states
        of #form fields, through the call to a JS function stored in "value_decode" attribute.
        
        Initialization (on server):
        - values of form fields (the state); "modified" flag; visibility of #form and #preview
        
        Utility methods:
        - form_encode(attr_name):
          - collect current form state, JSON.stringify it and save into a given attribute
          - return current state as an object
        - set_preview(state):
          - compute a preview value based on a given state and save it into the #preview element
        
        Actions:
        - form_show:
          - hide the preview, show the form ... form.setAttribute('class', 'active'); preview.setAttribute('class', 'inactive');
          - form_encode("initial-state") - keep initial state for calculation of the "modified" flag (only if no initial-state yet)
        - form_accept:
          - state = form_encode("current-state")
          - form_hide(state)
        - form_hide()
          - if state: set_preview(state)
          - hide the form, show the preview
          
        load --> form_show ---> form_accept
                           `--> form_hide
        
        #form-widget > #form, #preview
        .schema-XXX (schema-integer, schema-list etc.) - for attaching js event handlers
        
        Submit:
        - when the top-level form is to be submitted, all individual #form widgets are scanned, their
          "current-state"s collected (but only if present and != initial-state) and sent.
        
        Events:
        - mapping page events to form methods:
          onload? ondblclick? ...
        
        Document:
        - Hypertag: value-integer / value-string / value-field / ...
          - value-integer value=None empty=False
              protocol ValueInteger         role/act/proto/protocol/prototype/behavior/js-class/mixin
                div #view .view-long/.view-short
                div #form
          - %protocol @body js_class
              asset ".../protocols.js"
              div protocol=js_class
                @body
          
        - JS:
          class ValueInteger
            constructor() { ..(attach event handlers to all elements marked with ValueInteger protocol).. }
            ondblclick(e) { ... }
            view_ondblclick(e) { ... }
            form_buttonok_onclick(e)
            
        ----
        WIDGET (js)
        - new(state)
        - set_state(state) -- state represented by a JS object
        - get_state()
        - render()
        
        ----
        Return an HTML code with two top-level elements:
        1) #preview: static non-editable display of a current value of a (sub)field
        2) #form: input field or a modal window with a form for changing / setting the value
        The elements should come with or allow for instrumentation:
        - on("dblclick", #show): a function will be attached to #show that will hide the #show element on double click
          and show the #edit element instead
        - save(): js function that takes a form value, converts it to a display value, and saves in #show;
          this function may use ajax calls to the server to convert form values to display values,
          perform validation and assign errors in #show and #edit,
          and to compare new values with initial ones to set the "modified" flag;
        - "modified" flag: attr of #show indicating that the current #show value differs from the initial one
        - "error" flag: attributes in #show and/or #form that inform about errors in a given field
        The code may rely on JS scripts or React classes that need to be loaded separately.
        """

    def validate(self, value):
        """
        Check if `value` is correct under this schema, optionally make any necessary corrections.
        Return corrected value (None if incorrect), and a Validation result with an error/warning message.
        """
        

#####################################################################################################################################################
#####
#####  ATOMIC schema types
#####

class OBJECT(Schema):
    """
    Accepts any python object, optionally restricted to objects whose type(obj) is equal to one of
    predefined type(s) - the `type` parameter - or the object is an instance of one of predefined base classes
    - the `base` parameter; at least one of these conditions must hold.
    If there is only one type in `type`, and an empty `base`, the type name is excluded
    from serializated output and is implied automatically during deserialization.
    Types can be given as import paths (strings), which will be automatically converted to a type object.
    """
    # type = None         # python type(s) for exact type checks: type(obj)==T
    types = None         # python base type(s) for inheritance checks: isinstance(obj,T)
    #
    # def __init__(self, type = None, base = None):
    #     self.__setstate__({'type': type, 'base': base})
    #
    # def __getstate__(self):
    #     state = self.__dict__.copy()
    #     if len(self.type) == 1: state['type'] = self.type[0]
    #     if len(self.base) == 1: state['base'] = self.base[0]
    #     return state
    #
    # def __setstate__(self, state):
    #     """Custom __setstate__/__getstate__() is needed to allow compact encoding of 1-element lists in `type` and `base`."""
    #     self.type = self._prepare_types(state['type']) if 'type' in state else []
    #     self.base = self._prepare_types(state['base']) if 'base' in state else []
    #
    # def _prepare_types(self, types):
    #     types = list(types) if isinstance(types, (list, tuple)) else [types] if types else []
    #     types = [self.get_registry().get_class(t) if isinstance(t, str) else t for t in types]
    #     assert all(isinstance(t, type) for t in types)
    #     return types
    
    def __init__(self, *types, **params):
        super(OBJECT, self).__init__(**params)
        if types: self.types = list(types)
        
    def _valid_type(self, obj):
        return isinstance(obj, tuple(self.types)) if self.types else True
    
    # def _valid_type(self, obj):
    #     if not (self.type or self.base): return True        # all objects are valid when no reference types configured
    #     t = type(obj)
    #     if t in self.type: return True
    #     if any(isinstance(obj, base) for base in self.base): return True
    #     return False
    #
    # def _get_unique_type(self):
    #     return self.type[0] if len(self.type) == 1 and not self.types else None

    def encode(self, obj):
        
        if not self._valid_type(obj):
            raise EncodeError(f"invalid object type, expected one of {self.types or []}, but got {type(obj)}")
        return JSON.encode(obj) #, self._get_unique_type())

    def decode(self, state):
        
        obj = JSON.decode(state) #, self._get_unique_type())
        if not self._valid_type(obj):
            raise DecodeError(f"invalid object type after decoding, expected one of {self.types or []}, but got {type(obj)}")
        return obj


# the most generic schema for encoding/decoding of objects of any types
generic_schema = OBJECT()


class CLASS(Schema):
    """
    Accepts any global python type and encodes as a string containing its full package-module name.
    """
    def encode(self, value):
        if value is None: return None
        return self.get_registry().get_path(value)
    
    def decode(self, value):
        if not isinstance(value, str): raise DecodeError(f"expected a <str>, not {value}")
        return self.get_registry().get_class(value)
        
        
class Primitive(Schema):
    """Base class for schemas of primitive JSON-serializable python types."""

    type = None     # the predefined standard python type of all app-layer values; same type for db-layer values
    
    def __init__(self, type = None, **params):
        super(Primitive, self).__init__(**params)
        if type is None: return
        assert type in (bool, int, float, str)
        self.type = type
    
    def encode(self, value):
        if not isinstance(value, self.type): raise EncodeError(f"expected an instance of {self.type}, got {type(value)}: {value}")
        return value

    def decode(self, value):
        if not isinstance(value, self.type): raise DecodeError(f"expected an instance of {self.type}, got {type(value)}: {value}")
        return value

class BOOLEAN(Primitive):
    type = bool

class INTEGER(Primitive):
    type = int

class FLOAT(Primitive):
    type = float

class STRING(Primitive):
    type = str
    # html_element = 'hw-schema-string'
    
    __widget__ = """
        context $value
        custom "hw-widget-string-" data-value=$value
        #custom "hw-widget-string-" : inline | $value
    """

    
class TEXT(Primitive):
    """Similar to STRING, but differs in how the content is displayed: as a block rather than inline."""
    type = str
    
    __widget__ = """
        context $value
        custom "hw-widget-text-" data-value=$value
    """

    # def is_lengthy(self, value):
    #     return len(value) > 200 #or value.count('\n') > 3
    
class BYTES(Primitive):
    """Encodes a <bytes> object as a string using Base64 encoding."""
    type = bytes
    
    def encode(self, value):
        if not isinstance(value, bytes): raise EncodeError(f"expected an instance of {bytes}, got {type(value)}: {value}")
        return base64.b64encode(value).decode('ascii')

    def decode(self, encoded):
        if not isinstance(encoded, str): raise DecodeError(f"expected a string to decode, got {type(encoded)}: {encoded}")
        return base64.b64decode(encoded)
    
class CODE(TEXT):

    __widget__ = r"""
        context $value
        custom "hw-widget-code-" data-value=$dedent(value, False)
    """

#####################################################################################################################################################

class FILEPATH(STRING):
    """Path to an item in a Folder."""
    
class FILENAME(STRING):
    """
    Name of an individual entry in a Folder, without path.
    Names that end with '/' indicate directories and must link to items of Folder category.
    """

#####################################################################################################################################################

class ITEM(Schema):
    """
    Reference to an Item, encoded as ID=(CID,IID), or just IID if `category` or `cid` was provided.
    ITEM without parameters is equivalent to OBJECT(Item), however, ITEM can also be parameterized,
    which is not possible using an OBJECT.
    """
    
    # the required category or CID of items to be encoded; if None, all items can be encoded
    category = None
    cid      = None
    
    def __init__(self, category = None, cid = None, **params):
        super(ITEM, self).__init__(**params)
        if cid is not None: self.cid = cid
        if category is not None: self.category = category
            # if category.iid is None:
            #     print(f"WARNING: category {category} has empty ID in ITEM.__init__()")
            #     self.category = category
            # self.cid = category.iid
    
    def _get_cid(self):
        if self.cid is not None: return self.cid
        if self.category: return self.category.iid
        return None
    
    def encode(self, item):
        
        # if not isinstance(item, Item): pass
        if None in item.id:
            raise EncodeError(f"Linked item does not exist or its ID is missing, ID={item.id}")
            
        cid = self._get_cid()
        
        if None != cid:
            if cid == item.cid: return item.iid
            raise EncodeError(f"incorrect CID={item.cid} of an item {item}, expected CID={cid}")
        
        return list(item.id)

    def decode(self, value):
        
        cid = None
        ref_cid = self._get_cid()

        if isinstance(value, int):
            iid = value
            if ref_cid is None:
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
            cid = ref_cid
            
        return self.get_registry().get_item((cid, iid))
        
    # __widget__ = """
    #     context $value as item
    #     a href=$item.url() | $item
    # """
    
    
#####################################################################################################################################################
#####
#####  COMPOUND schema types
#####

class ENUM(Schema):
    """
    Only string values are allowed by default. Use `schema` argument to pass another type of schema for values;
    or set indices=True to enforce that only indices of values (0,1,...) are stored in the output - then the ordering
    of values in __init__() is meaningful for subsequent decoding.
    """
    schema   = STRING()
    values   = None
    valueset = None         # (temporary) set of permitted values
    indices  = None         # (temporary) dict of {index: value} when indices=True in __init__; serialized as False/True
    
    def __init__(self, *values, schema = None, indices = None, **params):
        super(ENUM, self).__init__(**params)
        self.values = list(values)
        if schema is not None: self.schema = schema
        if indices:
            self.indices = indices
        self._init()
        
    def __getstate__(self):
        state = self.__dict__.copy()
        del state['valueset']
        state['indices'] = bool(self.indices)
        return state
    
    def __setstate__(self, state):
        self.__dict__ = state
        self._init()
        
    def _init(self):
        self.valueset = set(self.values)         # for fast lookups
        if self.indices:
            self.indices = {v: idx for idx, v in enumerate(self.values)}

    def encode(self, value):
        if value not in self.valueset: raise EncodeError(f"unknown ENUM value: {value}")
        if self.indices:
            return self.indices[value]
        else:
            return self.schema.encode(value)
    
    def decode(self, encoded):
        # if not isinstance(encoded, list): raise DecodeError(f"expected a list, got {encoded}")
        
        if self.indices:
            if not isinstance(encoded, int): raise DecodeError(f"expected an integer as encoded ENUM value, got {encoded}")
            return self.values[encoded]
        
        value = self.schema.decode(encoded)
        if value not in self.valueset: raise DecodeError(f"unknown ENUM value after decoding: {value}")
        return value
    
    
class LIST(Schema):
    type = list
    schema = None       # schema of individual elements
    
    def __init__(self, schema, **params):
        super(LIST, self).__init__(**params)
        self.schema = schema
        
    def encode(self, values):
        if not isinstance(values, self.type): raise EncodeError(f"expected a {self.type}, got {values}")
        return [self.schema.encode(v) for v in values]

    def decode(self, encoded):
        if not isinstance(encoded, list): raise DecodeError(f"expected a list, got {encoded}")
        return self.type(self.schema.decode(e) for e in encoded)

class TUPLE(Schema):
    """
    If multiple `schemas` are given, each tuple must have this exact length and each element is encoded
    through a different schema, as provided. If there is one schema, this schema is used for
    all elements and the length of an input tuple can differ. If no schema is provided, the effect
    is the same as providing a single `generic_schema`.
    """
    type = tuple
    schemas = None      # list of schemas of individual elements

    def __init__(self, *schemas, **params):
        super(TUPLE, self).__init__(**params)
        self.schemas = list(schemas)
        
    def encode(self, values):
        if not isinstance(values, tuple): raise EncodeError(f"expected a tuple, got {values}")
        if len(self.schemas) <= 1:
            schema = self.schemas[0] if self.schemas else generic_schema
            return [schema.encode(v) for v in values]
        if len(values) != len(self.schemas): raise EncodeError(f"expected {len(self.schemas)} elements in a tuple, got {len(values)}")
        return [schema.encode(v) for v, schema in zip(values, self.schemas)]

    def decode(self, encoded):
        if not isinstance(encoded, list): raise DecodeError(f"expected a list, got {encoded}")
        if len(self.schemas) <= 1:
            schema = self.schemas[0] if self.schemas else generic_schema
            return [schema.decode(e) for e in encoded]
        if len(encoded) != len(self.schemas): raise EncodeError(f"expected {len(self.schemas)} elements in a tuple to be decoded, got {len(encoded)}")
        return tuple(schema.decode(e) for e, schema in zip(encoded, self.schemas))

    
class DICT(Schema):
    """
    Accepts <dict> objects as data values, or objects of a given `type` which should be a subclass of <dict>.
    Outputs a dict with keys and values encoded through their own schema.
    If no schema is provided, `generic_schema` is used as a default.
    """
    
    # schema of keys and values of app-layer dicts
    keys   = None
    values = None
    type   = None           # optional subtype of <dict>; if present, only objects of this type are accepted for encoding

    # the defaults are configured at class level for easy subclassing and to reduce output when this schema is serialized
    keys_default   = generic_schema
    values_default = generic_schema
    
    def __init__(self, keys = None, values = None, type = None, **params):
        super(DICT, self).__init__(**params)
        
        if keys is not None: self.keys = keys
        if values is not None: self.values = values
        if type is not None: self.type = type
        
    def encode(self, d):
        
        if not isinstance(d, self.type or dict): raise EncodeError(f"expected a <dict>, got {type(d)}: {d}")
        state = {}
        
        schema_keys   = self.keys or self.keys_default
        schema_values = self.values or self.values_default
        
        # encode keys & values through predefined field types
        for key, value in d.items():
            k = schema_keys.encode(key)
            if k in state: raise EncodeError(f"two different keys encoded to the same state ({k}) in DICT, one of them: {key}")
            state[k] = schema_values.encode(value)
        
        return state
        
    def decode(self, state):
        
        if not isinstance(state, dict): raise DecodeError(f"expected a <dict>, not {state}")
        d = (self.type or dict)()
        
        schema_keys   = self.keys or self.keys_default
        schema_values = self.values or self.values_default
        
        # decode keys & values through predefined field types
        for key, value in state.items():
            k = schema_keys.decode(key)
            if k in d: raise DecodeError(f"duplicate key ({k}) returned by field's {schema_keys} decode() for 2 different states, one of them: {key}")
            d[k] = schema_values.decode(value)
            
        return d

    def __str__(self):
        name   = self.name or self.__class__.__name__
        keys   = self.keys or self.keys_default
        values = self.values or self.values_default
        return f"{name}({keys}, {values})"


class CATALOG(DICT):
    """
    Schema of a catalog of items.
    Similar to DICT, but assumes keys are strings; and `type`, if present, must be a subclass of <catalog>.
    Provides tight integration with the UI: convenient layout for display of items,
    and access paths for locating form validation errors.
    Watch out the reversed ordering of arguments in __init__() !!
    """
    is_catalog   = True
    keys_default = STRING()
    
    def __init__(self, values = None, keys = None, type = None, **params):
        # if keys is None:
        #     keys = STRING()
        # else:
        #     assert isinstance(keys, STRING)             # `keys` may inherit from STRING, not necessarily be a STRING
        
        if keys: assert isinstance(keys, STRING)        # `keys` may inherit from STRING, not necessarily be a STRING
        if type: assert issubclass(type, catalog)
        super(CATALOG, self).__init__(keys, values, type, **params)
        
    def __str__(self):
        name   = self.name or self.__class__.__name__
        keys   = self.keys or self.keys_default
        values = self.values or self.values_default
        if type(keys) is STRING:
            return f"{name}({values})"
        else:
            return f"{name}({keys}, {values})"

    # def display(self, values):
    #
    #     view = """
    #         context $catalog
    #         ol
    #             for key, value in catalog.items():
    #                 li
    #                     i  | $key
    #                     ...| : $value
    #     """
    #     return hypertag(view).render(catalog = values)


class VARIANT(Schema):
    """
    Logical alternative of a number of distinct schemas: an app-layer object is serialized through
    the first matching sub-schema, and its name is stored in the output to allow deserialization
    through the same sub-schema.
    """
    schemas = None      # dict of sub-schemas; keys are names to be output during serialization
    
    def __init__(self, schemas, **params):
        """Either schema_list or schema_dict should be provided, but not both."""
        super(VARIANT, self).__init__(**params)
        # if schema_list and schema_dict:
        #     raise Exception("invalid parameters, either schema_list or schema_dict should be provided, but not both")
        # if schema_list:
        #     self.schemas = dict(enumerate(schema_list))
        # else:
        self.schemas = schemas
        
    def encode(self, value):
        
        for name, schema in self.schemas:
            try:
                encoded = schema.encode(value)
                return [name, encoded]
                
            except EncodeError:
                continue
                
        raise EncodeError(f"invalid value, no matching sub-schema in VARIANT for: {value}")
        
    def decode(self, encoded):
        
        if not (isinstance(encoded, list) and len(encoded) == 2):
            raise DecodeError(f"data corruption in VARIANT, the encoded object should be a 2-element list, got {encoded} instead")
        
        name, encoded = encoded
        schema = self.schemas[name]
        return schema.decode(encoded)
        

#####################################################################################################################################################
#####
#####  FIELD(S), RECORD, STRUCT
#####

class Field:
    """Specification of a field in a FIELDS/STRUCT catalog."""
    
    MISSING = None #object()      # token indicating that `default` value is missing; removed from output during serialization
    
    schema  = None          # instance of Schema
    # default = MISSING       # value assumed if this field is missing in an item; or MISSING if no default
    # multi   = False         # whether this field can be repeated (take on multiple values)
    # info    = None          # human-readable description of the field
    
    @property
    def default(self): return self.schema.default
    @property
    def multi(self): return self.schema.multi
    @property
    def info(self): return self.schema.info
    
    def __init__(self, schema = None, default = MISSING, info = None, multi = None):
        if schema is not None:  self.schema = schema
        if default is not Field.MISSING: self.schema.default = default
        if multi is not None:   self.schema.multi = multi
        if info is not None:    self.schema.info = info
    
    def __getstate__(self):
        # if len(self.__dict__) == 1 and 'schema' in self.__dict__:   # compactify the state when only `schema` is configured
        #     return self.schema
        
        if 'default' in self.__dict__ and self.default is Field.MISSING:           # exclude explicit MISSING value from serialization
            state = self.__dict__.copy()
            del state['default']
        else:
            state = self.__dict__
            
        return state
    
    # def __html__(self):
    #     view = """
    #         context $field as f
    #         span .field
    #             | $f.schema
    #             ...if f.multi | *
    #             if f.default <> f.MISSING
    #                 $default = str(f.default)
    #                 span .default title="default value: {default:crop(1000)}"
    #                     | [{default : crop(100)}]
    #             if f.info
    #                 span .info | • $f.info
    #                 # smaller dot: &middot;
    #                 # larger dot: •
    #     """
    #     return hypertag(view).render(field = self)
    
    def encode_one(self, value):
        return self.schema.encode(value)
    
    def decode_one(self, encoded):
        return self.schema.decode(encoded)
    
    def encode_many(self, values):
        """There can be multiple `values` to encode if self.multi is true. `values` is a list."""
        if len(values) >= 2 and not self.multi: raise Exception(f"multiple values not allowed by {self} schema")
        # encoded = [self.schema.encode(v) for v in values]
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
        # return [self.schema.decode(e) for e in encoded]
        return list(map(self.schema.decode, encoded))
        
        
#####################################################################################################################################################

class FIELDS(catalog, Schema):
    """
    Catalog of fields of items (MultiDict's) in a particular category;
    a dictionary of field names and their individual schemas as Field objects.
    Provides methods for schema-aware encoding and decoding of items,
    with every field value encoded through its dedicated field-specific schema.

    Primarily used for schema definition inside categories.
    Can also be used as a sub-schema in compound schema definitions. Instances of MultiDict
    are valid objects for encoding. If standard dict-like functionality is desired, field.multi should be set
    to False in all fields.
    """
    
    # default field specification to be used for fields not present in `fields`
    default_field = Field(OBJECT(multi = True))
    
    strict   = False    # if True, only the fields present in `fields` can occur in the data being encoded
    # fields   = None     # dict of field names & their Field() schema descriptors
    # blank    = False
    
    def __init__(self, **fields):
        # if __strict__ is not None: self.strict = __strict__
        # if fields: self.fields = fields
        # super(FIELDS, self).__init__(fields)
        params = {}                                     # TODO: accept nonempty params
        catalog.__init__(self, fields)
        Schema.__init__(self, **params)
        # self.update(fields)
        self._init_fields(self)
    
    def __getstate__(self):
        return self._reduce_fields(dict(self))
        
    def __setstate__(self, state):
        # self.__dict__ = dict(state)
        self.clear()
        self.update(state)
        self._init_fields(self)

    @staticmethod
    def _init_fields(fields):
        """Wrap up in Field all the fields whose values are plain Schema instances."""
        # if self.fields is None: self.fields = {}
        for name, field in fields.items():
            assert isinstance(name, str)
            if isinstance(field, Field): continue
            if field and not isinstance(field, Schema): raise Exception(f"expected an instance of Schema, got {field}")
            fields[name] = Field(field)
        return fields
    
    @staticmethod
    def _reduce_fields(fields):
        """If a Field() only has a schema configured, replace it with the schema object."""
        for name, field in fields.items():
            if list(field.__dict__.keys()) == ['schema']:
                fields[name] = field.schema
        return fields
    
    def encode(self, data):
        """
        Convert a MultiDict (`data`) to a dict of {attr_name: encoded_values} pairs,
        while schema-encoding each field value beforehand.
        """
        if not isinstance(data, MultiDict): raise EncodeError(f"expected a MultiDict, got {data}")
        errors = []
        
        # encode & compactify values of fields through per-field schema definitions
        encoded = data.asdict_lists()
        for name, values in encoded.items():
            
            if self.strict and name not in self:
                raise EncodeError(f'unknown field "{name}"')
            
            # schema-aware encoding
            field = self.get(name) or self.default_field
            encoded[name] = field.encode_many(values)
            # TODO: catch exceptions and append to `errors`
            
        if errors:
            raise EncodeErrors(errors)
            
        return encoded
        
    def decode(self, data):
        """
        Decode a dict of {attr: value(s)} back to a MultiDict.
        Perform recursive top-down schema-based decoding of field values.
        """
        if not isinstance(data, dict): raise DecodeError(f"expected a <dict>, not {data}")

        # de-compactify & decode values of fields
        for name, values in data.items():
            
            if self.strict and name not in self:
                raise DecodeError(f'field "{name}" of a record not allowed by its schema definition')
            
            # schema-based decoding
            field = self.get(name) or self.default_field
            data[name] = field.decode_many(values)
            
        return MultiDict(multiple = data)
    
    
    # def get_default(self, name):
    #     """Get the default value of a given item property as defined in this schema, or Field.MISSING."""
    #     field = self.get(name)
    #     return field.default if field else Field.MISSING

    def __str__(self):
        return str(dict(self))

#####################################################################################################################################################

class STRUCT(FIELDS):
    """
    Schema of a plain dict-like object that contains a number of named fields each one having its own schema.
    Similar to FIELDS, but the app-representation is a regular python object matching the schema
    rather than a MultiDict; and multiple values are not allowed for a field.
    When self.type is `struct`, both <struct> and <dict> instances are accepted during encoding,
    with the latter being automatically converted to a <struct> during decoding (!).
    """
    
    type   = None       # python type of accepted app-representation objects; instances of subclasses of `type` are NOT accepted
    fields = None       # optional dict of {field: schema} that can be defined by subclasses as an initial dict of `self` fields
    
    def __init__(self, **fields):
        self.type = self.type or struct
        assert isinstance(self.type, type), f'self.type is not a type: {self.type}'
        if self.fields:
            fields = {**self.fields, **fields}
        
        super(STRUCT, self).__init__(**fields)
        for name, field in self.items():
            if field.multi: raise Exception(f'multiple values are not allowed for a field ("{name}") of a STRUCT schema')
    
    def encode(self, obj):

        if self.type is struct:
            assert isinstance(obj, dict), f'not a dict or struct: {obj}'
            attrs = dict(obj)
        elif not isinstance(obj, self.type):
            raise EncodeError(f"expected an object of type {self.type}, got {obj}")
        else:
            attrs = getstate(obj)

        fields  = {**self.fields, **self} if self.fields else self
        encoded = {}
        
        # encode values of fields through per-field schema definitions
        for name, value in attrs.items():
            
            if name not in fields: raise EncodeError(f'unknown field "{name}", expected one of {list(fields.keys())}')
            encoded[name] = fields[name].encode_one(value)
            
        return encoded
        
    def decode(self, encoded):

        if not isinstance(encoded, dict): raise DecodeError(f"expected a <dict>, not {encoded}")
        fields = {**self.fields, **self} if self.fields else self
        attrs  = {}
        
        # decode values of fields
        for name, value in encoded.items():
            
            if name not in fields: raise DecodeError(f'invalid field "{name}", not present in schema of a STRUCT')
            attrs[name] = fields[name].decode_one(value)
            
        if self.type is struct:
            return struct(attrs)
        
        return setstate(self.type, attrs)

    def __str__(self):
        name = self.name or self.__class__.__name__
        if name != 'STRUCT': return name
        fields = ','.join(self.keys())
        return f"{name}({fields})"

    # def display(self, obj):
    #
    #     parts = []
    #     for name, field in self.items():
    #         v = getattr(obj, name, 'MISSING')
    #         s = field.schema.display(v)
    #         parts.append(f"{name}:{esc(s)}")
    #
    #     return ' '.join(parts)
    
    
class FIELD(STRUCT):
    """Schema of a field specification in a category's list of fields."""
    
    type = Field
    fields = FIELDS._init_fields({
        'schema':  OBJECT(Schema),       # VARIANT(OBJECT(base=Schema), ITEM(schema-category))
        'default': OBJECT(),
        'multi':   BOOLEAN(),
        'info':    STRING(),
    })
    
    __widget__ = """
        context $value as f
        span .field
            | $f.schema
            ...if f.multi | *
            if f.default <> f.MISSING
                $default = str(f.default)
                span .default title="default value: {default:crop(1000)}"
                    | ({default : crop(100)})
            if f.info
                span .info | • $f.info
                # smaller dot: &middot;
                # larger dot: •
    """
    
    # def display(self, field):
    #     view = """
    #         context $field as f
    #         span .field
    #             | $f.schema
    #             ...if f.multi | *
    #             if f.default <> f.MISSING
    #                 $default = str(f.default)
    #                 span .default title="default value: {default:crop(1000)}"
    #                     | [{default : crop(100)}]
    #             if f.info
    #                 span .info | • $f.info
    #                 # smaller dot: &middot;
    #                 # larger dot: •
    #     """
    #     # multi = '*' if self.multi else ''
    #     # return f"{self.schema}{multi} [{self.default}] / <i>{esc(self.info or '')}</i>"
    #     return hypertag(view).render(field = field)


# def struct(typename, __type__ = object, **__fields__):
#     """Dynamically create a subclass of STRUCT."""
#
#     class _struct_(STRUCT):
#         type = __type__
#         fields = __fields__
#
#     _struct_.__name__ = typename
#     return _struct_

# INFO: it's possible to use field_schema and record_schema, as below,
#       but the YAML output of the root category becomes more verbose then (multiple nesting levels)
#
# field_schema = STRUCT(Field,
#                       schema    = OBJECT(base = Schema),
#                       default   = OBJECT(),
#                       multi     = BOOLEAN(),
#                       info      = STRING(),
#                       )
#
# record_schema = STRUCT(FIELDS,
#                        fields = DICT(STRING(), FIELD()),
#                        strict = BOOLEAN(),
#                        )
    

# # rules for detecting disallowed field names in category schema definitions
# STOP_ATTR = {
#     'special':      (lambda attr: attr[0] == '_'),
#     'reserved':     (lambda attr: attr in 'load insert update save'),
#     'multidict':    (lambda attr: attr.endswith(MULTI_SUFFIX)),
# }
# re_codename = re.compile(r'^[a-zA-Z][a-zA-Z0-9_-]*$')         # valid names of a space or category

