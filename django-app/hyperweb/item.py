import re, threading
from time import sleep
from bidict import bidict

from nifty.text import html_escape

from .config import ROOT_CID, MULTI_SUFFIX
from .data import Data
from .errors import *
from .store import SimpleStore, CsvStore, JsonStore
from .types import Object, String
from .schema import Schema

from hypertag import HyperHTML

#####################################################################################################################################################

class handler:
    """
    Decorator of Item methods that marks a given method as a handler of web requests: wsgi, asgi...
    Only the methods decorated with @handler can be assigned to URLs and called by the view processing function.
    If name=None, the name of handler is the same as method's.
    Special method __view__ is mapped to handler's name=None.
    """
    def __init__(self, name = None):
        if callable(name): raise Exception("Incorrect use of @handler: missing ()")
        self.name = name
        
    def __call__(self, method):
        method.handler = self
        if method.__name__ != '__view__':
            self.name = self.name or method.__name__
        return method

class _RAISE_:
    """A token used to indicate that an exception should be raised if an attribute value is not found."""

# # shorthand for use inside Item.__getattribute__()
# _get_ = object.__getattribute__


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
        for attr in dir(cls):
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
    
    Item's category metadata:
    - views
    - handlers
    - methods
    
    Item's class methods:
    - get_url()
    - insert(), update(), save()
    - load() ??
    - get(), getlist(), set()
    
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
    - draft: newly created object, not linked with a record in DB (= IID is missing); may be inserted to DB to create a new record, or be filled with an existing record from DB
    - dirty: has local modifications that may deviate from the contents of the corresponding DB record
    - stub/dummy/short/frame: IID is present, but no data loaded yet (lazy loading)
    - loaded:
    
    Mapping an internal Item to an ItemView for read-only access in views and handlers:
    - itemview.FIELD       -->  item.data.get_first(FIELD)
    - itemview.FIELD_list  -->  item.data.get_list(FIELD)
    - itemview._get_first(FIELD), _get_list()
    
    BaseItem,Core,Seed... -- when loading a category NAME (iid XXX), a subclass NAME_XXX is dynamically created for its items
    - method() --
    - METHOD() -- calls METHOD of NAME_XXX
    ItemView
    - _base    -- ref to the base item; enables access to methods and full data[]
    """
    
    # builtin instance attributes & properties, not user-editable ...
    __cid__      = None         # CID (Category ID) of this item
    iid      = None         # IID (Item ID within category) of this item
                                # ... the (CID,IID) tuple is a globally unique ID of an item and a primary key in DB
    data     = None         # MultiDict with values of object attributes; an attribute can have multiple values
    
    category = None         # parent category of this item, as an instance of Category
    registry = None         # Registry that manages access to this item
    loaded   = False        # True if this item's data has been fully decoded from DB; for implementation of lazy loading of linked items
    
    handlers = None         # dict {handler_name: method} of all handlers (= public web methods)
                            # exposed by items of the current Item subclass
    views    = None         # similar to handlers, but stores Hypertag scripts (<str>) instead of methods;
                            # if a handler is not found in handlers, a script is looked up in views
                            # and compiled to HTML through Hypertag
    
    @property
    def __id__(self): return self.__cid__, self.iid
    
    @__id__.setter
    def __id__(self, id_):
        assert self.iid is None or self.iid == id_[1], 'changing IID of an existing item is forbidden'
        self.__cid__, self.iid = id_

    # @property
    # def data(self):
    #     return Data(self.data)
    
    # # names that must not be used for attributes inside data
    # __reserved__ = ['set', 'get', 'getlist', 'insert', 'update', 'save', 'get_url']
    
    def __init__(self):
        raise Exception('Item.__init__() is disabled, use Registry.get_item() instead')

    @classmethod
    def _create(cls, category, iid):
        """
        Create an instance of an item that has iid already assigned and is supposedly present in DB.
        Should only be called by Registry.
        """
        item = cls.__new__(cls)                     # __init__() is disabled, do not call it
        item.registry = category.registry
        item.category = category
        item.__cid__  = category.iid
        item.iid  = iid
        item.data = Data()                      # REFACTOR
        return item
        
    @classmethod
    def _new(cls, category):
        """Create a new item, one that's not yet in DB and has no iid assigned. Should only be called by Registry."""
        return cls._create(category, None)
        
    def _get_current(self):
        """Look this item's ID up in the Registry and return its most recent instance; load from DB if no longer in the Registry."""
        return self.registry.get_item(self.__id__)

    # def __getattr__(self, name):
    #     """
    #         Calls either get() or getlist(), depending on whether MULTI_SUFFIX is present in `name`.
    #         __getattr__() is a fallback for regular attribute access, so it gets called ONLY when the attribute
    #         has NOT been found in the object's __dict__ or in a parent class (!)
    #     """
    #     if MULTI_SUFFIX and name.endswith(MULTI_SUFFIX):
    #         basename = name[:-len(MULTI_SUFFIX)]
    #         return self.getlist(basename)
    #     return self.get(name)

    # def get(self, name):
    #
    #     # if self.data is None:
    #     #     self._load()
    #
    #     if name in self.data:                   # get `name` from data if present there
    #         return self.data[name]
    #
    #     # TODO: search `name` in category's default values
    #     value, found = self.category.get_default(name)
    #     if found: return value
    #
    #     raise AttributeError(name)
    
    def get(self, name, default = _RAISE_):
        """Get attribute value from:
           - self.data OR
           - self.category's schema defaults OR
           - self.__class__'s class-level defaults.
           If `name` is not found, `default` is returned if present, or AttributeError raised otherwise.
        """
        try:
            if not (self.loaded or name in self.data):
                self._load()
            return self.data[name]
        except KeyError: pass

        # # TODO: search `name` in category's default values
        # category = _get_(self, 'category')
        # if category:
        #     try:
        #         return category.get_default(name)
        #     except AttributeError: pass

        try:
            return getattr(self.__class__, name)
        except AttributeError: pass

        if default is _RAISE_:
            raise AttributeError(name)
        return default

    def getlist(self, name, default = None, copy_list = False):
        """Get a list of all values of an attribute from data. Shorthand for self.data.get_list()"""
        if not (self.loaded or name in self.data):
            self._load()
        return self.data.get_list(name, default, copy_list)

    def set(self, key, *values):
        """
        Assign `values` to a given key in data. This can be used instead of __setattr__ when the key looks
        like a private attr and would be assigned to __dict__ otherwise; or when mutliple values have to be assigned.
        """
        self.data.set(key, *values)

    # def __setattr__(self, name, value):
    #     """Assigns a singleton `value` to a given name in data; or to __dict__ if `name` is a private attr."""
    #
    #     # store private attributes in __dict__, not data
    #     if name[0] == '_':
    #         object.__setattr__(self, name, value)
    #     else:
    #         self.data[name] = value
    #     # data = object.__getattribute__(self, 'data')
    #     # data[name] = value
    
    def __dir__(self):
        attrs = set(super().__dir__())
        attrs.update(self.data.keys())
        return attrs
        
    def __repr__(self, max_len_name = 30):
        
        cat = self.category
        category = f'{cat.name}' if cat and hasattr(cat,'name') and cat.name else f'CID({self.__cid__})'
        name     = f' {self.name}' if hasattr(self,'name') and self.name is not None else ''
        if len(name) > max_len_name:
            name = name[:max_len_name-3] + '...'
        
        return f'<{category}:{self.iid}{name}>'
    
    def _load(self, record = None, force = False):
        """
        Load (decode) and store into self the entire data of this item as stored in its item row in DB - IF NOT LOADED YET.
        Setting force=True or passing a `record` enforces decoding even if `self` was already loaded.
        """
        assert self.iid is not None, '_load() must not be called for a newly created item with no IID'
        if self.loaded and not force and record is None: return self
        if record is None:
            record = self.category.load_data(self.__id__)
        self._decode(record)
        return self
    
    def _reload(self):
        return self._load(force = True)

    def _decode(self, record):
        """Decode raw information from a DB `record` and store in `self`."""
        self.loaded = True                      # this must be set already here to avoid infinite recursion
        
        data = record.pop('data')
        
        for field, value in record.items():
            if value in (None, ''): continue
            setattr(self, field, value)
        
        # impute category; note the special case: the root Category item is a category for itself!
        cid, iid = self.__id__
        self.category = self if (cid == iid == ROOT_CID) else self.registry.get_category(cid)

        # convert data from JSON string to a struct
        if data:
            schema = self.category.get('schema')
            data = schema.decode_json(data)
            self.data.update(data)
        
        self._post_decode()

    def _post_decode(self):
        """Override this method in subclasses to provide additional initialization/decoding when an item is retrieved from DB."""
        
    def _to_json(self):
        schema = self.category.get('schema')
        return schema.encode_json(self.data)
        
    def insert(self):
        """
        Insert this item as a new row in DB. Assign a new IID (self.iid) and return it.
        The item might have already been present in DB, but still a new copy is created.
        """
        self.category._store.insert(self)
        self.registry.save_item(self)
        
    def update(self, fields = None):
        """Update the contents of this item's row in DB."""
        # TODO: allow granular update of selected fields by making combined
        #       SELECT (of newest revision) + UPDATE (of selected fields WHERE revision=last_seen_revision)
        #  `fields` -- if None, all "dirty" fields are included
        #  `base_revision` (optional)
        #  `retries` -- max. no. of retries if UPDATE finds a different `revision` number than the initial SELECT pulled
        # Execution of this method can be delegated to the local node where `self` resides to minimize intra-network traffic (?)
        
        self.category._store.update(self)
        self.registry.save_item(self)           # only needed for a hypothetical case when `self` has been overriden in the registry by another version of the same item

    def save(self):
        """
        Save this item to DB. This means either an update of an existing DB row (if iid is already present),
        or an insert of a new row (iid is assigned and can be retrieved from self.iid).
        """
        if self.iid is None:
            self.insert()
        else:
            self.update()

    def get_url(self, __endpoint = None, *args, **kwargs):
        """Return canonical URL of this item, possibly extended with a non-default
           endpoint designation and/or arguments to be passed to a handler function or a view template.
        """
        return self.category.get_url_of(self, __endpoint, *args, **kwargs)
        
    def __handle__(self, request, endpoint = None):
        """
        Route a web request to a given endpoint.
        Endpoint can be implemented as a handler function/method, or a view template.
        Handler functions are stored in a parent category object.
        """
        # TODO: route through a predefined pipeline of handlers
        
        # from django.template.loader import get_template
        # template = get_template((endpoint or 'view') + '.hy')
        # return template.render({'item': self}, request)
        
        # search for a Hypertag script in views
        view = self.views.get(endpoint, None)
        if view is not None:
            return HyperHTML().render(view, item = self)

        # no view found; search for a handler method in handlers
        hdl = self.handlers.get(endpoint, None)
        if hdl is not None:
            return hdl(self, request)
        
        raise InvalidHandler(f'Endpoint "{endpoint}" not found in {self} ({self.__class__})')
        
    _default_view = \
    """
        context $item
        
        style !
            body { font: 20px/30px 'Quattrocento Sans', "Helvetica Neue", Helvetica, Arial, sans-serif; }
            h1 { font-size: 26px; line-height: 34px }
            .catlink { font-size: 14px; margin-top: -20px }
        
        % category
            p .catlink
                a href=$item.category.get_url() | {item.category.get('name')? or item.category}
                | ($item.__cid__,$item.iid)
            
        html
            $name = item.get('name')? or str(item)
            head
                title | {name}
            body
                h1  | {name}
                category
                #p  | ID {item.__id__}
                h2  | Attributes
                ul
                    for attr, value in item.data.items()
                        li
                            b | {attr}:
                            . | {str(value)}
    """
    
    views = {
        None: _default_view,
    }


ItemDoesNotExist.item_class = Item


#####################################################################################################################################################
#####
#####  CATEGORY
#####

class Category(Item):
    """
    A category serves as a class for items: defines their schema and functionality; but also as a manager that controls access to
    and creation of new items within category.
    """
    _store  = JsonStore()              # DataStore used for reading/writing items of this category


    def load_data(self, id):
        """Load item data from DB and return as a record (dict)."""
        print(f'load_data: loading item {id} in thread {threading.get_ident()} ', flush = True)
        return self._store.select(id)
    
    def new_item(self):
        """"""
        return self.itemclass._new(self)
        
    def get_item(self, iid):
        """
        Instantiate an Item (a stub) and seed it with IID (the IID being present in DB, presumably, not checked),
        but do NOT load remaining contents from DB (lazy loading).
        """
        return self.registry.get_item(iid = iid, category = self)
    
    def load_items(self):
        """
        Load all items of this category, ordered by IID, optionally limited to max. `limit` items with lowest IID.
        A generator.
        """
        records = self._store.select_all(self.iid)
        return self.registry.decode_items(records, self)
        

    #####  Handlers & views  #####

    @handler('new')
    def _handle_new(self, request):
        """Web handler that creates a new item of this category based on `request` data."""
        
        # data = Data()
        item = self.new_item()
        data = item.data
        
        # retrieve attribute values from GET/POST and assign to `item`
        # POST & GET internally store multi-valued parameters (lists of values for each parameter)
        for attr, values in request.POST.lists():
            data.set(attr, *values)
        for attr, values in request.GET.lists():
            data.set(attr, *values)

        item.save()
        return html_escape(f"Item created: {item}")
        
    _default_view = \
    """
        context $item as cat
        
        html
            $name = cat.get('name')? or str(cat)
            head
                title | {name ' -' }? category #{cat.iid}
            body
                h1
                    try
                        i | $name
                        . | -
                    | category #{cat.iid}
                p
                    . | Items in category
                    i | $name:
                table
                    for item in cat.load_items()
                        tr
                            td / #{item.iid} &nbsp;
                            td : a href=$item.get_url()
                                | {item.get('name')? or item}
    """
    
    views = {
        None: _default_view,
    }

    def get_url_of(self, item, __endpoint = None, *args, **kwargs):
        
        assert item.__cid__ == self.iid
        site_ = self.registry.get_site()

        base_url  = site_.get('base_url')
        qualifier = site_.get_qualifier(self)
        iid       = self.encode_url(item.iid)
        # print(f'category {self.iid} {id(self)}, qualifier {qualifier} {self._qualifier}')
        
        url = f'{base_url}/{qualifier}:{iid}'
        if __endpoint: url += f'/{__endpoint}'
        
        return url
    
    def encode_url(self, iid):
        """This method, together with decode_url(), can be customized in subclasses to provide
           a different way of representing IIDs inside URLs.
        """
        return str(iid)
    
    def decode_url(self, iid_str):
        """Convert an encoded IID representation found in a URL back to an <int>. Reverse operation to encode_url()."""
        return int(iid_str)
        
        
class RootCategory(Category):
    """Root category: a category for all other categories."""

    @classmethod
    def _create(cls, registry):
        """Create an instance of an item that has iid assigned and is supposedly present in DB. Should only be called by Registry."""
        
        schema = Schema()
        schema.fields = {
            'schema':   Object(Schema),
            'name':     String(),
            'info':     String(),
        }
        
        item = cls.__new__(cls)                 # __init__() is disabled, do not call it
        item.registry = registry
        item.category = item                # RootCategory is a category for itself
        item.__cid__   = ROOT_CID
        item.iid   = ROOT_CID
        item.data  = Data()
        item.set('schema', schema)
        item.set('itemclass', Category)         # root category doesn't have a schema (not yet loaded); attributes must be set/decoded manually
        return item
        

#####################################################################################################################################################
#####
#####  SITE
#####

class Application(Item): pass
class Space(Item): pass

class Site(Item):
    """
    A Site is responsible for two things:
    - bootstrapping the application(s)
    - managing the pool of items through the entire execution of an application:
      - transfering items to/from DB storage(s) and through the cache
      - tracking changes
      - creating new items
    
    The global `site` object is created in hyperweb/__init__.py and can be imported with:
      from hyperweb import site
      
    There should be only 1 thread that processes requests and accesses `site` after initialization.
    """

    re_codename = re.compile(r'^[a-zA-Z][a-zA-Z0-9_-]*$')         # valid codename of a space or category

    # internal variables
    
    _qualifiers = None      # bidirectional mapping (bidict) of app-space-category qualifiers to CID values,
                            # for URL routing and URL generation; some categories may be excluded from routing
                            # (no public visibility), yet they're still accessible through get_category()

    # # Site class is special in that it holds distinct Registry instances for each processing thread.
    # # This is to ensure each thread operates on separate item objects to avoid interference
    # # when two threads modify same-ID items concurrently.
    # _thread_local = threading.local()
    #
    # @property
    # def registry(self):
    #     reg = getattr(self._thread_local, 'registry', None)
    #     if reg is None:
    #         reg = self._thread_local.registry = Registry()
    #     return reg
    #
    # @registry.setter
    # def registry(self, reg):
    #     self._thread_local.registry = reg
    
    def _post_decode(self):

        self._qualifiers = bidict()
        
        for app in self.getlist('app'):
            for space_name, space in app.get('spaces').items():
                for category_name, category in space.get('categories').items():
                    
                    qualifier = f"{space_name}.{category_name}"         # space-category qualifier of item IDs in URLs
                    self._qualifiers[qualifier] = category.iid

    def get_category(self, cid):
        """Retrieve a category through the Registry that belongs to the current thread."""
        return self.registry.get_category(cid)
    
    def get_item(self, *args, **kwargs):
        """Retrieve an item through the Registry that belongs to the current thread."""
        return self.registry.get_item(*args, **kwargs)
        
    def get_qualifier(self, category = None, cid = None):
        """Get a qualifer of a given category that should be put in URL to access this category's items by IID."""
        if cid is None: cid = category.iid
        return self._qualifiers.inverse[cid]

    def get_from_url(self, descriptor):
        
        # print(f'handler thread {threading.get_ident()}')
        
        # below, `iid` can be a number, but this is NOT a strict requirement; interpretation of URL's IID part
        # is category-dependent and can be customized by Category subclasses
        try:
            qualifier, iid_str = descriptor.split(':', 1)
        except Exception as ex:
            print(ex)
            print('incorrect descriptor in URL:', descriptor)
            raise
            
        reg = self.registry
        
        cid = self._qualifiers[qualifier]
        category = reg.get_category(cid)
        
        iid = category.decode_url(iid_str)
        return reg.get_item((cid, iid))

    def after_request(self, sender, **kwargs):
        """Cleanup and maintenance after a response has been sent, in the same thread."""

        print(f'after_request() in thread {threading.get_ident()}...', flush = True)
        self.registry.after_request(sender, **kwargs)
        # sleep(5)

        
