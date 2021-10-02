from textwrap import dedent
from xml.sax.saxutils import quoteattr

from nifty.text import html_escape
from hypertag.std.html import html_escape as esc

from .config import ROOT_CID
from .errors import *
from .multidict import MultiDict
from .cache import LRUCache
from .schema import generic_schema, Field


#####################################################################################################################################################

class handler:
    """
    Decorator of Item methods that marks a given method as a handler of web requests: wsgi, asgi...
    Only the methods decorated with @handler can be assigned to URLs and called by the view processing function.
    If name=None, the name of handler is the same as method's.
    """
    def __init__(self, name = None):
        if callable(name): raise Exception("Incorrect use of @handler: missing ()")
        self.name = name
        
    def __call__(self, method):
        if not self.name: self.name = method.__name__
        method.handler = self
        return method

class cached:
    """
    Decorator that wraps a given function/method with LRU caching of result values, possibly with TTL.
    The wrapper performs a simple but exact matching of function arguments.
    A more complex handling of arguments, with support for edge cases, is performed by Cache.memoize() in cache.py,
    but that approach is based on hashes, so in rare cases it can signal a false match.
    Note: there is only one cache created for a given function/method, and so all the calls,
    even if directed to different items (through `self`), share the same cache capacity.
    Note: exceptions are NOT cached currently.
    
    A possible ALTERNATIVE in python 3.3:
    - from functools import lru_cache
    
    """
    def __init__(self, size = 1000, ttl = None):
        self.cache = LRUCache(maxsize = size, ttl = ttl)
        
    def __call__(self, func):
        missing = object()
        
        def wrapper(*args, **kwargs):
            
            self.cache.evict()              # the modified Cache implementation does NOT perform automatic eviction
            key = (args, tuple(kwargs.items()))
            result = self.cache.get(key, missing)
            if result is not missing:
                #print(f"function cache, result loaded: {result}")
                return result
            
            result = func(*args, **kwargs)
            self.cache.set(key, result)
            #print(f"function cache, result saved: {result}")
            return result
            
        return wrapper


#####################################################################################################################################################
#####
#####  ITEM
#####

class MetaItem(type):
    
    def __init__(cls, name, bases, dct):
        super().__init__(name, bases, dct)
        
        class DoesNotExist(ItemDoesNotExist):
            item_class = cls
    
        cls.DoesNotExist = DoesNotExist
        
        # fill out the dict of handlers
        cls.handlers = handlers = {}
        for attr in dir(cls):                   # this iterates over ALL methods including base classes
            method = getattr(cls, attr)
            if not callable(method): continue
            try:
                hdl = method.handler
            except AttributeError:
                continue
            if not isinstance(hdl, handler): continue

            name = hdl.name
            if name in handlers:
                raise DuplicateHandler(f'Duplicate name of a web handler, "{name}", in {cls}')
            # bound_method = method.__get__(cls, Category)       # binding method to `self`
            handlers[name] = method #bound_method
            
        # print(cls, handlers)


class Item(object, metaclass = MetaItem):
    """
    Item is an elementary object operated upon by Hyperweb and a unit of storage in DB.
    
    Item's metadata - in DB:
    - cid, iid
    - revision -- current revision id 1,2,3,...; increased after each modification of the item
    ? created_at, updated_at -- kept inside MySQL as UTC and converted to local timezone during select (https://stackoverflow.com/a/16751478/1202674)
    - owner + permissions (?) -- the owner can be a group of users (e.g., all editors of a journal, all site admins, ...)
    ? D is_draft -- this item is under construction, not fully functional yet (app-level feature)
    ? M is_mock  -- a mockup object created for unit testing or integration tests; should stay invisible to users and be removed after tests
    ? H is_honeypot -- artificial empty item for detection and tracking of automated access
    ? R is_removed -- undelete is possible for a predefined grace period, eg. 1 day (since updated_at)
    
    Item's metadata - derived (in memory):
    - category, registry
    - namespace -- the namespace this item was loaded through; should be used for
    
    Item's status -- temporary (in memory):
    - draft/newborn: newly created object, not linked with a record in DB (= IID is missing); may be inserted to DB to create a new record, or be filled with an existing record from DB
    - dirty: has local modifications that may deviate from the contents of the corresponding DB record
    - stub/dummy/short/frame: IID is present, but no data loaded yet (lazy loading)
    - loaded:
    
    Mapping an internal Item to an ItemView for read-only access in templates and handlers:
    - itemview.FIELD       -->  item.data.get_first(FIELD)
    - itemview.FIELD__list  -->  item.data.get_list(FIELD)
    - itemview.FIELD__first, FIELD__last
    - itemview._first(FIELD), _last(), _list()
    
    BaseItem,Core,Seed... -- when loading a category NAME (iid XXX), a subclass NAME_XXX is dynamically created for its items
    - method() --
    - METHOD() -- calls METHOD of NAME_XXX
    """
    
    RAISE = MultiDict.RAISE
    
    # builtin instance attributes & properties, not user-editable ...
    cid      = None         # CID (Category ID) of this item
    iid      = None         # IID (Item ID within category) of this item
                            # ... the (CID,IID) tuple is a globally unique ID of an item and a primary key in DB
    
    data     = None         # MultiDict with values of object attributes; an attribute can have multiple values
    
    category = None         # parent category of this item, as an instance of Category
    registry = None         # Registry that manages access to this item
    
    handlers = None         # dict {handler_name: method} of all handlers (= public web methods)
                            # exposed by items of the current Item subclass
    templates = None        # dict of {endpoint: template} that stores Hypertag scripts to be rendered into HTML
                            # if a suitable handler is not found in `handlers`
    
    @property
    def id(self): return self.cid, self.iid
    
    # is_newborn, is_fresh, is_mature
    def has_id(self): return self.cid is not None and self.iid is not None
    
    # # names that must not be used for attributes inside data
    # __reserved__ = ['set', 'get', 'get_list', 'insert', 'update', 'save', 'get_url']
    
    
    def __init__(self, category = None, data = None):
        """
        Create a new item instance. Assign category, registry, properties, CID (if possible).
        self.loaded is left uninitialized (False).
        """
        self.data = MultiDict(data) if data is not None else None       # unloaded item has self.data=None
        
        if category is not None:
            self.category = category
            self.registry = category.registry           # can be None
            self.cid      = category.iid

    def seed(self, data, bind = True):
        """
        Initialize this (newly created) item with a given dict of property values, `data`.
        Mark it as loaded. Then call bind(), if bind=True.
        """
        # self.data.update(data)
        # self._loaded = True
        self.data = MultiDict(data)
        if bind: self.bind()

    def isinstance(self, category):
        """
        Check whether this item belongs to a category that inherits from `category` via a prototype chain.
        All comparisons along the way use item IDs, not python object identity.
        """
        return self.category.issubcat(category)
        
    def __contains__(self, field):
        return field in self.data
        
    def __getitem__(self, field):
        return self.get(field, Item.RAISE)

    def __setitem__(self, field, value):
        return self.data.set(field, value)
        
    def get(self, field, default = None, category_default = True, impute = True, mode = 'first'):
        """Get a value of `field` from self.data using data.get(), or from self.category's schema defaults
           if category_default=True. If the field is missing and has no default, `default` is returned,
           or KeyError is raised if default=RAISE.
           `impute`: if True, value imputation will be attempted if `field` is a derived property (TODO)
        """
        self.prepare(field)
        
        if field in self.data:
            return self.data.get(field, mode = mode)
        
        if category_default:
            cat_default = self.category.get_default(field)
            if cat_default is not Field.MISSING:            # TODO: refactor Field.MISSING -> Item.MISSING
                return cat_default
            
            # TODO: check category-level field of the same name (another way to define a default value)
            
        if default is Item.RAISE:
            raise KeyError(field)
        
        return default

    # def getfield(self, field, default = None, mode = 'first'):
    #     """
    #     Like get(), but additionally looks for `field` inside `self` (instance or class attribute)
    #     before returning the default.
    #     """
    #     try:
    #         return self.get(field, Item.RAISE, mode = mode)
    #     except KeyError:
    #         pass
    #
    #     try:
    #         return getattr(self, field)
    #     except AttributeError:
    #         pass
    #
    #     if default is Item.RAISE:
    #         raise KeyError(field)
    #
    #     return default

    def get_uniq(self, field, default = None, category_default = True):
        return self.get(field, default, category_default, 'uniq')
        
    def get_first(self, field, default = None, category_default = True):
        return self.get(field, default, category_default, 'first')
        
    def get_last(self, field, default = None, category_default = True):
        return self.get(field, default, category_default, 'last')
        
    def get_list(self, field, copy_list = False):
        """Get a list of all values of an attribute from data. Shorthand for self.data.get_list()"""
        self.prepare(field)
        return self.data.get_list(field, copy_list)

    def set(self, key, *values):
        """
        Assign `values` to a given key in data. This can be used instead of __setattr__ when the key looks
        like a private attr and would be assigned to __dict__ otherwise; or when mutliple values have to be assigned.
        """
        self.data.set(key, *values)
        
    def add(self, key, *values):
        self.data.add(key, *values)
        
    def __dir__(self):
        attrs = set(super().__dir__())
        attrs.update(self.data.keys())
        return attrs
        
    def __repr__(self, max_len = 30):
        return self.ciid(html = False)
        
    def __html__(self):
        url = quoteattr(self.url())
        # name = self.get('name', str(self.iid))
        # cat  = self.category.get('name', str(self.cid))
        # return f"<span style='font-size:75%;padding-right:3px'>{esc(cat)}:</span><a href={url}>{esc(name)}</a>"
        
        name = esc(self.get('name', ''))
        note = self.category.get('name', None) or self.ciid(False, False)
        if name:
            return f"<a href={url}>{name}</a><span style='font-size:80%;padding-left:3px'>[{esc(note)}]</span>"
        else:
            return f"<a href={url}>{esc(repr(self))}</a>"

        # ciid = esc(repr(self))
        # if name: return f"<a href={url}>{name}</a> <span style='font-size:80%'>{ciid}</span>"
        # else:    return f"<a href={url}>{ciid}</a>"
    
    def ciid(self, html = True, brackets = True, max_len = None, ellipsis = '...'):
        """
        "Category-Item ID" (CIID) string (stamp, emblem) having the form:
        - [CATEGORY-NAME:IID], if the category of self has a "name" property; or
        - [CID:IID] otherwise.
        If html=True, the first part (CATEGORY-NAME or CID) is hyperlinked to the category's profile page
        (unless URL failed to generate) and the CATEGORY-NAME is HTML-escaped. If max_len is not None,
        CATEGORY-NAME gets truncated and suffixed with '...' to make its length <= max_len.
        """
        cat = self.category.get('name', str(self.cid))
        if max_len and len(cat) > max_len: cat = cat[:max_len - 3] + ellipsis
        if html:
            cat = esc(cat)
            url = self.category.url('', __raise__ = False)
            if url: cat = f"<a href={url}>{cat}</a>"
        stamp = f"{cat}:{self.iid}"
        if not brackets: return stamp
        return f"[{stamp}]"

    # def current(self):
    #     """Look this item's ID up in the Registry and return its most recent instance; load from DB if no longer in the Registry."""
    #     return self.registry.get_item(self.id)
    
    def prepare(self, field):
        """
        If item data was not yet loaded from DB and `field` is not in self.data, load the entire item now.
        This does NOT guarantee that `field` is actually loaded, bcs it may be missing in DB.
        """
        # if self._loaded or self.iid is None or field in self.data: return
        if self.data is None: self.load()
    
    # def reload(self):
    #     return self.load(force = True)

    def load(self, record = None):
        """
        Load properties of this item from a DB into self.data, IF NOT LOADED YET.
        Only with a not-None `record`, (re)loading takes place even if `self` was already loaded,
        the newly loaded `data` fully replaces the existing self.data in such case.
        """
        if self.iid is None: raise Exception(f'trying to load() a newborn item with no IID, {self}')
        if self.data is not None and record is None: return self
        if record is None:
            record = self.registry.load_record(self.id)

        # self.data = MultiDict()                 # this must be set already here to avoid infinite recursion
        # self._decode(record['data'])

        fields = self.category.get('fields')        # specification of fields {field_name: schema}
        data   = fields.load_json(record['data'])         #generic_schema.load_json(data)
        self.data = MultiDict(data)
        self.bind()

        return self
    
    # def _decode(self, data):
    #     """Decode raw information from a DB `record` and store in `self`."""
    #
    #     # for field, value in record.items():
    #     #     if value in (None, ''): continue
    #     #     if field == 'data': continue
    #     #     setattr(self, field, value)
    #
    #     # if not self.has_id():
    #     #     self.cid = record['cid']
    #     #     self.iid = record['iid']
    #     # else:
    #     #     assert self.cid == record['cid']
    #     #     assert self.iid == record['iid']
    #
    #     # # impute category; note the special case: the root Category item is a category for itself!
    #     # cid, iid = self.id
    #     # self.category = self if (cid == iid == ROOT_CID) else self.registry.get_category(cid)
    #
    #     # convert data from JSON string to a struct
    #     fields = self.category.get('fields')        # specification of fields {field_name: schema}
    #     data = fields.load_json(data)       #generic_schema.load_json(data)
    #     self.data = MultiDict(data)
    #     #self.data.update(data)

    def bind(self):
        """
        Override this method in subclasses to provide initialization after this item is retrieved from DB.
        Typically, this method initializes transient properties and performs cross-item initialization.
        Only after bind(), the item is a fully functional element of a graph of interconnected items.
        When creating new items, bind() should be called manually, typically after all related items
        have been created and connected.
        """
    
    def dump_data(self):
        """Dump self.data to a JSON string using schema-based encoding of nested values."""
        fields = self.category.get('fields')        # specification of fields {field_name: schema}
        # return generic_schema.dump_json(self.data)
        return fields.dump_json(self.data)
        
    def insert(self):
        """
        Insert this item as a new row in DB. Assign a new IID (self.iid) and return it.
        The item might have already been present in DB, but still a new copy is created.
        """
        self.registry.insert_item(self)
        
    def update(self, fields = None):
        """Update the contents of this item's row in DB."""
        # TODO: allow granular update of selected fields by making combined
        #       SELECT (of newest revision) + UPDATE (of selected fields WHERE revision=last_seen_revision)
        #  `fields` -- if None, all "dirty" fields are included
        #  `base_revision` (optional)
        #  `retries` -- max. no. of retries if UPDATE finds a different `revision` number than the initial SELECT pulled
        # Execution of this method can be delegated to the local node where `self` resides to minimize intra-network traffic (?)
        
        self.registry.update_item(self)

    def save(self):
        """
        Save this item to DB. This means either an update of an existing DB row (if iid is already present),
        or an insert of a new row (iid is assigned and can be retrieved from self.iid).
        """
        if self.iid is None:
            self.insert()
        else:
            self.update()

    def serve(self, request, app, default_endpoint = 'view'):
        """
        Process a web request submitted to a given endpoint of `self` and return a response document.
        Endpoint can be implemented as a handler function/method, or a template.
        Handler functions are stored in a parent category object.
        URL query parameters are passed inside request.GET, e.g., q=request.GET.get('q','')
        """
        request.app  = app
        request.item = self
        endpoint = request.endpoint or default_endpoint

        # from django.template.loader import get_template
        # template = get_template((endpoint or 'template') + '.hy')
        # return template.render({'item': self}, request)
        
        # search for a Hypertag script in item's property `endpoints`
        template = self.category.get('endpoints', {}).get(endpoint)   #or self.templates.get(endpoint)
        if template: return self.render(template, request)

        # search for a handler method inside the class
        handler = self.handlers.get(endpoint)
        if handler: return handler(self, request)

        raise InvalidHandler(f'Endpoint "{endpoint}" not found in {self} ({self.__class__})')
        
    def render(self, template, request):
        """Render a given template script as a response to a given request."""
        
        app   = request.app
        site  = request.site
        item  = request.item
        
        context = dict(item = item, request = request, registry = self.registry, #data = View(item),
                       site = site, app = app)
        
        return site.hypertag.render(template, **context)
        
    def __getstate__(self):
        raise Exception("Item instance cannot be directly serialized, incorrect schema configuration")

    def get_schema(self, field_name):
        """
        Look up this item's category definition to retrieve a schema of a given field.
        When called on a category object, this method returns a schema pulled from the ROOT category,
        rather than itself (!).
        """
        schema = None
        fields = self.category.get('fields', {})
        
        if field_name in fields:
            schema = fields[field_name].schema
        if schema is None:
            schema = generic_schema
        
        return schema

    def get_entries(self, order = 'schema'):
        """Retrieve a list of entries in self.data ordered appropriately."""
        # return self.data.items()
        
        entries = []
        fields  = self.category.get('fields', {})
        
        # retrieve entries by their order in category's schema (fields)
        for f in fields:
            entries += [(f, v) for v in self.data.get_list(f)]
            
        # add out-of-schema entries, in their natural order (of insertion)
        for key, values in self.data.items_lists():
            if key in fields: continue
            entries += [(key, v) for v in values]
            
        return entries
        

    def url(self, __route__ = None, __raise__ = True, **params):
        """
        Return a *relative* URL of this item as assigned by the current Application (if __route__=None),
        that is, by the one that's processing the current web request; or an *absolute* URL
        assigned by an application anchored at a given route.
        __route__=None should only be used during request processing, when a current app is defined.
        """
        try:
            if __route__ is None:
                app = self.registry.current_app
                return './' + app.url_path(self, params = params)      # ./ informs the browser this is a relative path, even if dots and ":" are present similar to a domain name with http port
            return self.registry.site.get_url(self, __route__, params = params)
        
        except Exception as ex:
            if __raise__: raise
            return ''

ItemDoesNotExist.item_class = Item


#####################################################################################################################################################
#####
#####  CATEGORY
#####

class Category(Item):
    """
    A category is an item that describes other items: their schema and functionality;
    also acts as a manager that controls access to and creation of new items within category.
    """
    def new(self, **props):
        """
        Create a newborn item of this category (not yet in DB); connect it with self.registry;
        mark it as pending for insertion to DB.
        """
        itemclass = self.get_class()
        item = itemclass(category = self, data = props)
        self.registry.stage(item)                       # mark `item` for insertion on next commit()
        return item
    
    __call__ = new
    
    def stub(self, iid):
        """
        Create a "stub" item that has IID already assigned and is (supposedly) present in DB,
        but properties (item.data) are not loaded yet. Should only be called by Registry.
        """
        itemclass = self.get_class()
        item = itemclass(category = self)
        # item = self.new()
        item.iid = iid
        return item

    def issubcat(self, category):
        """
        Return True if self is `category` or inherits from it, i.e.,
        if ID of `category` is present on a prototype chain(s) of self.
        """
        if self.id == category.id: return True
        for base in self.get_list('prototype'):
            if base.issubcat(category): return True
        return False

    @cached(ttl = 3600)
    def get_class(self):

        name = self.get('class_name')
        code = self.get('class_code')
        
        # TODO: check self.data for individual methods & templates to be treated as methods
        
        if code:
            symbols = {}
            code = dedent(code)
            exec(code, symbols)
            return symbols[name]
        
        assert name, f'no class_name defined for category {self}: {name}'
        
        from hyperweb.core.root import registry
        return registry.get_class(name)
        
    def get_item(self, iid):
        """
        Instantiate an Item (a stub) and seed it with IID (the IID being present in DB, presumably, not checked),
        but do NOT load remaining contents from DB (lazy loading).
        """
        return self.registry.get_item(iid = iid, category = self)
    
    def get_default(self, field):
        """Get default value of a field from category schema. Field.MISSING is returned if no default is configured."""
        # return self['schema'].get_default(field)
        field = self['fields'].get(field)
        return field.default if field else Field.MISSING        # TODO: use Item.MISSING instead of Field.MISSING

    #####  Handlers & templates  #####

    @handler('new')
    def _handler_new(self, request):
        """Web handler that creates a new item of this category based on `request` data."""
        
        item = self()
        data = item.data
        
        # retrieve attribute values from GET/POST and assign to `item`
        # POST & GET internally store multi-valued parameters (lists of values for each parameter)
        for attr, values in request.POST.lists():
            data.set(attr, *values)
        for attr, values in request.GET.lists():
            data.set(attr, *values)

        item.save()
        return html_escape(f"Item created: {item}")
        
    def encode_url(self, iid):
        """This method, together with decode_url(), can be customized in subclasses to provide
           a different way of representing IIDs inside URLs.
        """
        return str(iid)
    

#####################################################################################################################################################
#####
#####  INDEX
#####

class Index(Item):
    """
    Index of items of a specific category that allows fast item lookups and range scans
    by a predefined key. The key is an item property or a combination of properties.
    Each entry contains a value ("payload") consisting of a predefined subset of item properties.
    """
    

#####################################################################################################################################################
#####
#####  DATA VIEW
#####

# class View:  # Snap / Snapshot / Data
#     """
#     View of an item's data that provides convenient read access to particular fields
#     using dot notation instead of array indexing.
#     """
#
#     # modes of value access in Item.data, and suffixes appended to attribute names to indicate
#     # which (multiple) values of a given attribute to retrieve
#     _GET_MODES    = ('uniq', 'first', 'last', 'list')
#
#     # configuration parameters
#     _mode_separator = '__'
#     _default_mode   = 'first'
#     _default_miss   = Item.RAISE
#
#     # internal structures
#     _item       = None          # the underlying Item instance; enables access to methods and full data[]
#     _user       = None          # user profile / identification
#     # _route      = None          # the site's Route that this request came from
#     # _request    = None          # web request object
#
#     def __init__(self, item):
#         self._item = item
#
#     def __getattr__(self, name):
#         """
#         Call item.get() with appropriate arguments depending on whether `name` is a plain field name,
#         or does it contain a suffix indicating the mode of access (uniq, first, last, list).
#         """
#         field = name
#         mode  = self._default_mode
#
#         sep = self._mode_separator
#         if sep and sep in name:
#             field, mode = name.rsplit(sep, 1)
#             if mode not in self._GET_MODES:
#                 field = name
#                 mode  = self._default_mode
#
#         return self._item.get(field, self._default_miss, mode = mode)
#
#     def _uniq(self, field):
#         return self._item.get(field, self._default_miss, mode ='uniq')

    
#####################################################################################################################################################
#####
#####  Remarks
#####

# TODO:
# -

# ISSUES:
# -
