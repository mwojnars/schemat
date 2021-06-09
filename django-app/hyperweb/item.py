import re, threading
from pprint import pprint

from time import sleep
from bidict import bidict

from nifty.text import html_escape

from .config import ROOT_CID
from .errors import *
from .multidict import MultiDict
from .store import SimpleStore, CsvStore, JsonStore, YamlStore

from hypertag import HyperHTML

Data = MultiDict        # Data is just an alias for MultiDict class


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
    - templates
    - handlers
    - methods
    
    Item's class methods:
    - get_url()
    - insert(), update(), save()
    - load() ??
    - get(), get_list(), set()
    
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
    loaded   = False        # True if this item's data has been fully decoded from DB; for implementation of lazy loading of linked items
    
    handlers = None         # dict {handler_name: method} of all handlers (= public web methods)
                            # exposed by items of the current Item subclass
    templates = None        # dict of {endpoint: template} that stores Hypertag scripts to be rendered into HTML
                            # if a suitable handler is not found in `handlers`
    
    @property
    def id(self): return self.cid, self.iid
    
    # @id.setter
    # def id(self, id_):
    #     assert self.iid is None or self.iid == id_[1], 'changing IID of an existing item is forbidden'
    #     self.cid, self.iid = id_

    # @property
    # def data(self):
    #     return Data(self.data)
    
    # # names that must not be used for attributes inside data
    # __reserved__ = ['set', 'get', 'get_list', 'insert', 'update', 'save', 'get_url']
    
    def __init__(self):
        raise Exception('Item.__init__() is disabled, use Registry.get_item() instead')

    @classmethod
    def _raw(cls, id = None, category = None, registry = None, **fields):
        """
        Create an item that's potentially disconnected from registry/category (raw item)
        and set given `fields` in self.data. For internal use only.
        """
        item = cls.__new__(cls)                     # __init__() is disabled, must call __new__() instead
        item.data = Data()

        if id is not None:
            item.cid, item.iid = id
        if category is not None:
            item.category = category
            assert item.cid is None or category.iid is None or item.cid == category.iid, "item's CID is inconsistent with its category's IID"
        if registry is not None:
            item.registry = registry
            
        for field, value in fields.items():
            item.data[field] = value
        return item
        
    @classmethod
    def _new(cls, category, iid):
        """
        Create an instance of Item that has IID already assigned and is (supposedly) present in DB.
        Should only be called by Registry.
        """
        item = cls.__new__(cls)                     # __init__() is disabled, must call __new__() instead
        item.registry = category.registry
        item.category = category
        item.cid  = category.iid
        item.iid  = iid
        item.data = Data()                      # REFACTOR
        return item
        
    def __getitem__(self, field):
        return self.get(field, Item.RAISE)

    def __setitem__(self, field, value):
        return self.data.set(field, value)
        
    def get(self, field, default = None, category_default = True, mode = 'first'):
        """Get a value of `field` from self.data using data.get(), or from self.category's schema defaults
           if category_default=True. If the field is missing and has no default, `default` is returned,
           or KeyError is raised if default=RAISE.
        """
        self.prepare(field)
        
        if field in self.data:
            return self.data.get(field, mode = mode)
        
        if category_default:
            from .schema import Field
            cat_default = self.category.get_default(field)
            if cat_default is not Field.MISSING:
                return cat_default
            
        if default is Item.RAISE:
            raise KeyError(field)
        
        return default

    def uniq(self, field, default = None, category_default = True):
        return self.get(field, default, category_default, 'uniq')
        
    def first(self, field, default = None, category_default = True):
        return self.get(field, default, category_default, 'first')
        
    def last(self, field, default = None, category_default = True):
        return self.get(field, default, category_default, 'last')
        
    def list(self, field, copy_list = False):
        """Get a list of all values of an attribute from data. Shorthand for self.data.get_list()"""
        self.prepare(field)
        return self.data.get_list(field, copy_list)

    # get_list = list

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
        
        category = self.category.get('name', f'CID({self.cid})')
        name     = self.get('name', '')
        # cat = self.category
        # category = f'{cat.name}' if cat and hasattr(cat,'name') and cat.name else f'CID({self.cid})'
        # name     = f' {self.name}' if hasattr(self,'name') and self.name is not None else ''
        if len(name) > max_len:
            name = name[:max_len - 3] + '...'
        
        return f'<{category}:{self.iid} {name}>'
    
    # def current(self):
    #     """Look this item's ID up in the Registry and return its most recent instance; load from DB if no longer in the Registry."""
    #     return self.registry.get_item(self.id)
    
    def prepare(self, field):
        """Make sure that a given `field` is present in self.data; load it from DB if not."""
        if self.loaded or field in self.data: return
        self.load()        # load the entire item data; this does NOT guarantee that `field` is loaded, bcs it may be missing in DB
    
    def reload(self):
        return self.load(force = True)

    def load(self, record = None, force = False):
        """
        Load (decode) and store into self the entire data of this item as stored in its item row in DB - IF NOT LOADED YET.
        Setting force=True or passing a `record` enforces decoding even if `self` was already loaded.
        """
        assert self.iid is not None, 'load() must not be called for a newly created item with no IID'
        if self.loaded and not force and record is None: return self
        if record is None:
            record = self.registry.load_data(self.id)
        self._decode(record)
        return self
    
    def _decode(self, record):
        """Decode raw information from a DB `record` and store in `self`."""
        self.loaded = True                      # this must be set already here to avoid infinite recursion
        
        data = record.pop('data')
        
        for field, value in record.items():
            if value in (None, ''): continue
            setattr(self, field, value)
        
        # impute category; note the special case: the root Category item is a category for itself!
        cid, iid = self.id
        self.category = self if (cid == iid == ROOT_CID) else self.registry.get_category(cid)

        # convert data from JSON string to a struct
        if data:
            schema = self.category.get('schema')
            data = schema.from_json(data, self.registry)
            self.data.update(data)
        
        self._post_decode()

    def _post_decode(self):
        """Override this method in subclasses to provide additional initialization/decoding when an item is retrieved from DB."""
        
    def to_json(self):
        schema = self.category.get('schema')
        return schema.to_json(self.data, self.registry)
        
    def insert(self):
        """
        Insert this item as a new row in DB. Assign a new IID (self.iid) and return it.
        The item might have already been present in DB, but still a new copy is created.
        """
        self.registry.insert_item(self)
        # self.category._store.insert(self)
        # self.registry.save_item(self)
        
    def update(self, fields = None):
        """Update the contents of this item's row in DB."""
        # TODO: allow granular update of selected fields by making combined
        #       SELECT (of newest revision) + UPDATE (of selected fields WHERE revision=last_seen_revision)
        #  `fields` -- if None, all "dirty" fields are included
        #  `base_revision` (optional)
        #  `retries` -- max. no. of retries if UPDATE finds a different `revision` number than the initial SELECT pulled
        # Execution of this method can be delegated to the local node where `self` resides to minimize intra-network traffic (?)
        
        self.registry.update_item(self)
        # self.category._store.update(self)
        # self.registry.save_item(self)           # only needed for a hypothetical case when `self` has been overriden in the registry by another version of the same item

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
           endpoint designation and/or arguments to be passed to a handler function or a template.
        """
        return self.category.get_url_of(self, __endpoint, *args, **kwargs)
        
    def serve(self, request, endpoint, args):
        """
        Process a web request submitted to a given endpoint of `self` and return a response document.
        Endpoint can be implemented as a handler function/method, or a template.
        Handler functions are stored in a parent category object.
        """
        # TODO: parse `args` string and pass to the handler
        # TODO: route through a predefined pipeline of handlers
        
        # from django.template.loader import get_template
        # template = get_template((endpoint or 'template') + '.hy')
        # return template.render({'item': self}, request)
        
        # search for a handler method in handlers
        hdl = self.handlers.get(endpoint)
        if hdl is not None:
            return hdl(self, request)
        
        # search for a Hypertag script in templates
        template = self.category.get('templates', {}).get(endpoint)   #or self.templates.get(endpoint)
        if template is not None:
            return HyperHTML().render(template, view = View(self, request))

        raise InvalidHandler(f'Endpoint "{endpoint}" not found in {self} ({self.__class__})')
        
    def __getstate__(self):
        raise Exception("Item instance cannot be directly serialized, incorrect schema configuration")

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
    # _store  = YamlStore()              # DataStore used for reading/writing items of this category

    # def load_data(self, id):
    #     """Load item data from DB and return as a record (dict)."""
    #     print(f'load_data: loading item {id} in thread {threading.get_ident()} ', flush = True)
    #     return self._store.select(id)
    
    def get_item(self, iid):
        """
        Instantiate an Item (a stub) and seed it with IID (the IID being present in DB, presumably, not checked),
        but do NOT load remaining contents from DB (lazy loading).
        """
        return self.registry.get_item(iid = iid, category = self)
    
    def create_item(self):
        return self.registry.create_item(self)
    
    # def load_items(self):
    #     """
    #     Load all items of this category, ordered by IID, optionally limited to max. `limit` items with lowest IID.
    #     A generator.
    #     """
    #     records = self._store.select_all(self.iid)
    #     return self.registry.decode_items(records, self)
        
    def get_default(self, field):
        """Get default value of a field from category schema. Field.MISSING is returned if no default is configured."""
        return self['schema'].get_default(field)

    #####  Handlers & templates  #####

    @handler('new')
    def _handle_new(self, request):
        """Web handler that creates a new item of this category based on `request` data."""
        
        # data = Data()
        item = self.registry.create_item(self)
        data = item.data
        
        # retrieve attribute values from GET/POST and assign to `item`
        # POST & GET internally store multi-valued parameters (lists of values for each parameter)
        for attr, values in request.POST.lists():
            data.set(attr, *values)
        for attr, values in request.GET.lists():
            data.set(attr, *values)

        item.save()
        return html_escape(f"Item created: {item}")
        
    def get_url_of(self, item, __endpoint = None, *args, **kwargs):
        
        assert item.cid == self.iid
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
    
    # def decode_url(self, iid_str):
    #     """Convert an encoded IID representation found in a URL back to an <int>. Reverse operation to encode_url()."""
    #     return int(iid_str)
        
# # rules for detecting disallowed attribute names in category definitions
# STOP_ATTR = {
#     'special':      (lambda attr: attr[0] == '_'),
#     'reserved':     (lambda attr: attr in 'load insert update save'),
#     'multidict':    (lambda attr: attr.endswith(MULTI_SUFFIX)),
# }

# re_codename = re.compile(r'^[a-zA-Z][a-zA-Z0-9_-]*$')         # valid codename of a space or category


class RootCategory(Category):
    """Root category: a category for all other categories."""

    @classmethod
    def create_root(cls, registry):
        """Create an instance of the root category item."""

        from .schema import Object, String, Class, Dict, Boolean, Record, Field, Struct

        # schema_field  = Struct(Field, schema = Object(baseclass = Schema), default = Object(), multi = Boolean(), info = String())
        # schema_schema = Struct(Record, fields = Dict(String(), schema_field))
        # schema_schema = Struct(Record, fields = Dict(String(), Object(Field)), strict = Boolean())
        schema_schema = Object(Record)
        
        fields = {
            'schema':       schema_schema,
            'name':         String(),
            'info':         String(),
            'itemclass':    Class(),
            'templates':    Dict(String(), String()),
        }
        schema = Record(**fields)               # this schema is ONLY used as a type definition during loading of the root category item itself, and it gets overwritten later on
        
        root = cls.__new__(cls)                 # __init__() is disabled, do not call it
        root.registry = registry
        root.category = root                    # RootCategory is a category for itself
        root.cid   = ROOT_CID
        root.iid   = ROOT_CID
        root.data  = Data()
        root.set('schema', schema)              # will ultimately be overwritten with a schema loaded from DB, but is needed for the initial call to root.load(), where it's accessible thx to circular dependency root.category==root
        root.set('itemclass', Category)         # root category doesn't have a schema (not yet loaded); attributes must be set/decoded manually

        # root.load()
        # new_schema = root['schema']
        # print("RootCategory.schema:")
        # print(schema_schema.to_json(new_schema, registry, indent = 2))
        
        return root
        

#####################################################################################################################################################
#####
#####  SITE
#####

class Route:
    """
    Specification of a URL route: its base URL (protocol+domain), regex pattern for URL path matching,
    and a target application object.
    """
    base = None         # base URL: scheme (protocol) + domain, without trailing '/'
    path = None         # fixed prefix of URL paths after the domain part; should start with '/'
    app  = None         # Application that interprets the dynamic part of a URL and maps it bidirectionally to an item
    
    def __init__(self, **attrs):
        self.__dict__.update(attrs)
    
    def match(self, url):
        """Check if this route matches a given URL."""
        return url.startswith(self.base + self.path)
    
    def find(self, path, registry):
        """
        Find an item pointed to by a given URL path (no domain name, no endpoint, no GET arguments).
        Raise an exception if item not found or the path not recognized.
        Return (item, endpoint, args) tuple.
        """
        endpoint = args = ""

        if '?' in path:
            path, args = path.split('?', 1)
        
        if '/' in path:
            path, endpoint = path.rsplit('/', 1)

        try:
            space_category, item_id = path.split(':')
            space_name, category_name = space_category.split('.')
        except Exception as ex:
            print(ex)
            print('incorrect URL path:', path)
            raise
            
        # app = registry.get_item(tuple(self.app))
        # assert isinstance(app, Application)
        app = self.app
        
        space    = app.get_space(space_name)
        category = space.get_category(category_name)
        item     = category.get_item(int(item_id))
        
        return item, endpoint, args
        
        # cid = self._qualifiers[qualifier]
        # category = registry.get_category(cid)
        #
        # iid = category.decode_url(item_id)
        # return registry.get_item((cid, iid))

    def url(self, item):
        """Generate URL path of an `item` when accessed through this URL route."""
    

class Site(Item):
    """
    Site represents the entire website as seen by clients:
    - all (sub)domains
    - all (sub)applications
    - routing of all URLs
    """

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
    
    def _post_decode(self):         # TODO: refactor this out to avoid any item-specific post-processing and instance-level temporary variables

        # print('Site.routes:', self['routes'])

        self._qualifiers = bidict()
        
        for app in self.list('app'):
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
        
    def get_qualifier(self, category = None):
        """Get a qualifer (URL path) of a given category that should be put in URL to access this category's items by IID."""
        route = self['routes']['default']           # TODO: choice of route controlled by client
        # route.url(category)
        
        app = route.app
        for space_name, space in app['spaces'].items():
            for category_name, cat in space['categories'].items():
                if cat.id != category.id: continue
                qualifier = f"{space_name}.{category_name}"         # space-category qualifier of item IDs in URLs
                return qualifier
                # self._qualifiers[qualifier] = cat.iid
        
        # return self._qualifiers.inverse[category.iid]

    def handle(self, request, path):
        item, endpoint, args = self.route(request, path)
        return item.serve(request, endpoint, args)

    def route(self, request, path):
    
        url = request.build_absolute_uri()
        
        # find the first route that matches the `path`
        for route in self['routes'].values():
            if not route.match(url): continue
            return route.find(path, self.registry)
        
        raise Exception(f'route not found for "{path}" path')

    # def resolve(self, path):
    #     """Find an item pointed to by a given URL path (no domain name, no endpoint, no GET arguments)."""
    #
    #     # print(f'handler thread {threading.get_ident()}')
    #
    #     # below, `iid` can be a number, but this is NOT a strict requirement; interpretation of URL's IID part
    #     # is category-dependent and can be customized by Category subclasses
    #     try:
    #         qualifier, iid_str = path.split(':', 1)
    #     except Exception as ex:
    #         print(ex)
    #         print('incorrect URL path:', path)
    #         raise
    #
    #     reg = self.registry
    #
    #     cid = self._qualifiers[qualifier]
    #     category = reg.get_category(cid)
    #
    #     iid = category.decode_url(iid_str)
    #     return reg.get_item((cid, iid))

    def after_request(self, sender, **kwargs):
        """Cleanup and maintenance after a response has been sent, in the same thread."""

        print(f'after_request() in thread {threading.get_ident()}...', flush = True)
        self.registry.after_request(sender, **kwargs)
        # sleep(5)
        

class Application(Item):

    def get_space(self, name):
        return self['spaces'][name]

class Space(Item):
    
    def get_category(self, name):
        return self['categories'][name]
    

#####################################################################################################################################################
#####
#####  ITEM VIEW
#####

class View:
    """
    View of an item's data in the context of a particular web request.
    Provides convenient read access to `data` of an underlying item, as well as to parameters of the web request.
    """
    
    # modes of value access in Item.data, and suffixes appended to attribute names to indicate
    # which (multiple) values of a given attribute to retrieve
    _GET_MODES    = ('uniq', 'first', 'last', 'list')
    
    # configuration parameters
    _mode_separator = '__'
    _default_mode   = 'first'
    _default_miss   = Item.RAISE
    
    # internal structures
    _item       = None          # the underlying Item instance; enables access to methods and full data[]
    _user       = None          # user profile / identification
    _route      = None          # the site's Route where this request came through
    _request    = None          # web request object
    
    def __init__(self, item, request):
        self._item = item
        self._request = request
    
    def __getattr__(self, name):
        """
        Call __item__.get() with appropriate arguments depending on whether `name` is a plain field name,
        or does it contain a suffix indicating the mode of access (uniq, first, last, list).
        """
        field = name
        mode  = self._default_mode
        
        sep = self._mode_separator
        if sep and sep in name:
            field, mode = name.rsplit(sep, 1)
            if mode not in self._GET_MODES:
                field = name
                mode  = self._default_mode
        
        return self._item.get(field, self._default_miss, mode = mode)

    def _uniq(self, field):
        return self._item.get(field, self._default_miss, mode ='uniq')

    def url(self, target_item = None):
        """
        Generate URL of a target_item when accessed through self._app application;
        or URL of self._item if target_item=None.
        """
        if target_item is None: target_item = self._item
        return target_item.get_url()
        # return self._route.url(target_item)

    
#####################################################################################################################################################
#####
#####  Remarks
#####

# TODO:
# - JsonPickle: if a dict to be encoded contains "@" key, it gets serialized to a json dict that's incorrectly
#   interpreted as an object of a custom class during deserialization - security threat;
#   this cannot be fixed when using the standard `json` library (api is too narrow), only if the client
#   guarantees that "@" key never occurs in a dict to be encoded

# ISSUES:
# - strict typing in schema is necessary to properly serialize nested Item instances as references
