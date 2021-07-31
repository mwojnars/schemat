import re, threading, types, json
from textwrap import dedent
from urllib.parse import urlencode

from nifty.text import html_escape

from hypertag.core.runtime import HyLoader, PyLoader, join_path
from hypertag import HyperHTML

from .config import ROOT_CID
from .errors import *
from .multidict import MultiDict
from .cache import LRUCache
from .serialize import import_

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
    
    def has_id(self): return self.cid is not None and self.iid is not None
    
    # # names that must not be used for attributes inside data
    # __reserved__ = ['set', 'get', 'get_list', 'insert', 'update', 'save', 'get_url']
    
    def __init__(self, __category__ = None, __loaded__ = True, **fields):
        """
        Create a new item that's not yet in DB (no IID).
        Assign `fields` into self.data. The item is assumed to be "loaded".
        """
        self.data = Data()
        self.loaded = __loaded__
        
        if __category__ is not None:
            self.category = __category__
            self.registry = __category__.registry           # this can be None
            self.cid      = __category__.iid
        
        for field, value in fields.items():
            self.data[field] = value

    # @classmethod
    # def _stub(cls, category, iid):
    #     """
    #     Create a "stub" item that has IID already assigned and is (supposedly) present in DB,
    #     but data fields are not loaded yet. Should only be called by Registry.
    #     """
    #     item = cls(category)
    #     item.iid = iid
    #     return item
        
    def __contains__(self, field):
        return field in self.data
        
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
            from .schema import Field                       # TODO: refactor Field.MISSING -> Item.MISSING
            cat_default = self.category.get_default(field)
            if cat_default is not Field.MISSING:
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
        if name: name = ' ' + name
        
        return f'<{category}:{self.iid}{name}>'
    
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
            fields = self.category.get('fields')        # specification of fields {field_name: schema}
            data   = fields.from_json(data, self.registry)
            self.data.update(data)
        
    #     self._post_decode()
    #
    # def _post_decode(self):
    #     """Override this method in subclasses to provide additional initialization/decoding when an item is retrieved from DB."""
        
    # def on_load(self, fields):
    #     """Post-processing performed right after raw data have been loaded from DB, decoded from JSON, and saved to self.data."""
    #
    # def on_change(self, fields):
    #     """Post-processing performed right after new values of `fields` have been written to `data`."""
    
    def to_json(self):
        fields = self.category.get('fields')        # specification of fields {field_name: schema}
        return fields.to_json(self.data, self.registry)
        
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

    # def serve(self, request):
    #     """
    #     Process a web request submitted to a given endpoint of `self` and return a response document.
    #     Endpoint can be implemented as a handler function/method, or a template.
    #     Handler functions are stored in a parent category object.
    #     URL query parameters are passed inside request.GET, e.g., q=request.GET.get('q','')
    #     """
    #     # TODO: parse `args` string and pass to the handler
    #     # TODO: route through a predefined pipeline of handlers
    #
    #     endpoint = request.endpoint
    #
    #     # from django.template.loader import get_template
    #     # template = get_template((endpoint or 'template') + '.hy')
    #     # return template.render({'item': self}, request)
    #
    #     # search for a handler method in handlers
    #     hdl = self.handlers.get(endpoint)
    #     if hdl is not None:
    #         request.item = self
    #         return hdl(self, request)
    #
    #     # search for a Hypertag script in templates
    #     template = self.category.get('templates', {}).get(endpoint)   #or self.templates.get(endpoint)
    #
    #     if template is not None:
    #         return self.render(template, request)
    #
    #     raise InvalidHandler(f'Endpoint "{endpoint}" not found in {self} ({self.__class__})')
    
    def get_handler(self, endpoint, default_endpoint = '_view_'):
        
        # search for a handler function/template in category's endpoints
        endpoints = self.category.get('endpoints', {})
        handler = endpoints.get(endpoint)
        if not handler: raise Exception("page not found")

        # handler is a Hypertag script that has to be rendered through Item.render() ?
        if isinstance(handler, str):
            def render(request):
                template = handler
                return self.render(template, request)
            return render
        
        # handler is a regular (bound) python method of the item? return unchanged; it should accept `request` as its only arg
        if isinstance(handler, types.MethodType):
            return handler
        
    def render(self, template, request):
        """Render a given template script as a response to a given request."""
        
        app  = request.app
        site = request.site
        directory = site['directory']
        request.item = self

        context = dict(item = self, data = View(self), category = self.category, request = request,
                       app = app, directory = directory)
        
        loaders  = [HyItemLoader(app, directory), PyLoader]     # PyLoader is needed to load Python built-ins
        hypertag = HyperHTML(loaders)
        # TODO: revise how cache inside loaders is used; check if `hypertag` can be reused across requests?

        # print('template:')
        # print(template)
        return hypertag.render(template, **context)
        
    def __getstate__(self):
        raise Exception("Item instance cannot be directly serialized, incorrect schema configuration")

    def get_schema(self, field_name):
        """
        Look up this item's category definition to retrieve a schema of a given field.
        When called on a category object, this method returns a schema pulled from the ROOT category,
        not from this one (!).
        """
        schema = None
        fields = self.category.get('fields', {})

        if field_name in fields:
            schema = fields[field_name].schema
        if schema is None:
            from hyperweb.schema import object_schema               # TODO: refactor to remove a local import
            schema = object_schema
        
        return schema


ItemDoesNotExist.item_class = Item


class HyItemLoader(HyLoader):
    """
    Loader of Hypertag scripts that searches the site's directory instead of local disk.
    Supported import paths:
    
    - .folder.module
    - ...folder.module
    - folder.module -- folder is searched for starting from "search paths" (/system /apps/APP)
      or from the "anchor folder" of the referrer (parent folder of the top-level package)
    - from /apps/XYZ/src/pkg1.pkg2.module import ...  -- the last "/" indicates the anchor folder
      from ../../dir/pkg1.pkg2.module import ...
    """
    
    PATH_SYSTEM = '/system'
    
    def __init__(self, app, directory):
        super(HyItemLoader, self).__init__()
        self.app = app
        self.directory = directory
        
    def load(self, path, referrer, runtime):
        """`referrer` is a Module that should have been loaded by this loader."""
        
        item, location = self._find_item(path, referrer)
        if item is None: return None

        assert 'code' in item
        assert item.category.get('name') == 'Code'
        
        script = item['code']
        # print('script loaded:\n', script)
        
        # # relative import path is always resolved relative to the referrer's location
        # if path[:1] == '.':
        #     location = join_path(referrer.location, path)
        #
        # # absolute import path is resolved relative to search paths
        # else:
        #     search_paths = [
        #         self.app['folder'],
        #         self.PATH_SYSTEM,
        #     ]

        module = self.cache[location] = runtime.translate(script, location)
        module.location = location

        return module
        
    def _find_item(self, path, referrer):
        
        # try the original `path` as location
        try:
            item = self.directory.open(path)
            return item, path
        except Exception: pass
        
        # try appending .hy extension to `path`
        if not path.lower().endswith(self.SCRIPT_EXTENSION):
            location = path + self.SCRIPT_EXTENSION
            try:
                item = self.directory.open(location)
                return item, location
            except Exception: pass
            
        return None, None
    

#####################################################################################################################################################
#####
#####  CATEGORY
#####

class Category(Item):
    """
    A category serves as a class for items: defines their schema and functionality; but also as a manager that controls access to
    and creation of new items within category.
    """
    
    def new(self, __loaded__ = True, **fields):
        """Create a new raw item of this category, not yet in Registry and without self.registry explicitly set."""
        itemclass = self.get_class()
        return itemclass(self, __loaded__, **fields)
    
    __call__ = new
    
    def stub(self, iid):
        """
        Create a "stub" item that has IID already assigned and is (supposedly) present in DB,
        but data fields are not loaded yet. Should only be called by Registry.
        """
        item = self.new(__loaded__ = False)
        item.iid = iid
        return item
        
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
        return import_(name)
        
    def get_item(self, iid):
        """
        Instantiate an Item (a stub) and seed it with IID (the IID being present in DB, presumably, not checked),
        but do NOT load remaining contents from DB (lazy loading).
        """
        return self.registry.get_item(iid = iid, category = self)
    
    def get_default(self, field):
        """Get default value of a field from category schema. Field.MISSING is returned if no default is configured."""
        # return self['schema'].get_default(field)
        from .schema import Field                       # TODO: refactor, use Item.MISSING instead of Field.MISSING
        field = self['fields'].get(field)
        return field.default if field else Field.MISSING

    #####  Handlers & templates  #####

    @handler('new')
    def _handle_new(self, request):
        """Web handler that creates a new item of this category based on `request` data."""
        
        item = self()       #self.registry.create_item(self)
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
    
    @classmethod
    def create_root(cls, registry):
        """Create an instance of the root category item."""

        from .core import root_fields
        
        root = cls(__loaded__ = False)
        root.registry = registry
        root.category = root                    # root category is a category for itself
        root.cid = ROOT_CID
        root.iid = ROOT_CID
        root['fields'] = root_fields     # will ultimately be overwritten with fields loaded from DB, but is needed for the initial call to root.load(), where it's accessible thx to circular dependency root.category==root
        return root
        

#####################################################################################################################################################
#####
#####  SITE
#####

# class Route:
#     """
#     Specification of a URL route: its base URL (protocol+domain), regex pattern for URL path matching,
#     and a target application object.
#     """
#     base = None         # base URL: scheme (protocol) + domain, without trailing '/'
#     path = None         # fixed prefix of URL paths after the domain part; should start with '/'
#     app  = None         # Application that interprets the dynamic part of a URL and maps it bidirectionally to an item
#
#     def __init__(self, **attrs):
#         self.__dict__.update(attrs)
    
    # def match(self, url):
    #     """Check if this route matches a given URL."""
    #     return url.startswith(self.base + self.path)
    #
    # def find(self, path, registry):
    #     """
    #     Find an item pointed to by a given URL path (no domain name, no endpoint, no GET arguments).
    #     Raise an exception if item not found or the path not recognized.
    #     Return (item, endpoint, args) tuple.
    #     """
    #     endpoint = args = ""
    #
    #     if '?' in path:
    #         path, args = path.split('?', 1)
    #
    #     if '/' in path:
    #         path, endpoint = path.rsplit('/', 1)
    #
    #     try:
    #         space_category, item_id = path.split(':')
    #         space_name, category_name = space_category.split('.')
    #     except Exception as ex:
    #         print(ex)
    #         print('incorrect URL path:', path)
    #         raise
    #
    #     space    = self.app.get_space(space_name)
    #     category = space.get_category(category_name)
    #     item     = category.get_item(int(item_id))
    #
    #     return item, endpoint, args
    #
    # def url(self, __item__, __endpoint__ = None, **params):
    #     """
    #     Get URL of `item` when accessed through this URL route, possibly extended with a non-default
    #     endpoint designation and/or arguments to be passed to a handler function or a template.
    #     """
    #     category = __item__.category
    #     path = self._qualifier(category)
    #     iid  = category.encode_url(__item__.iid)
    #     url  = f'{self.base}/{path}:{iid}'
    #     if __endpoint__: url += f'/{__endpoint__}'
    #     return url
    #
    # # route(item) is equivalent to route.url(item):
    # __call__ = url
    #
    # @cached(ttl = 10)
    # def _qualifier(self, category):
    #     """Get a qualifer (URL path) of a given category that should be put in URL to access this category's items by IID."""
    #     for space_name, space in self.app['spaces'].items():
    #         for category_name, cat in space['categories'].items():
    #             if cat.id != category.id: continue
    #             return f"{space_name}.{category_name}"         # space-category qualifier of item IDs in URLs
    #
    #     raise Exception(f"no URL pattern exists for the requested category: {category}")
    

# class Space(Item):
#
#     def get_category(self, name):
#         return self['categories'][name]

class Application(Item):
    """An application implements a mapping of URL paths to item methods, and the way back."""

    def get_space(self, name):
        return self['spaces'][name]

    def handle(self, request):
        """
        Find an item pointed to by a given request and call its serve() method to render response.
        Raise an exception if item not found or the path not recognized.
        """
        # choose the right URL scheme resolver to use
        if self.get('url_scheme') == 'raw':
            resolve = self._handle_raw
        else:
            resolve = self._handle_spaces
        return resolve(request)

    def url(self, __item__, __endpoint__ = None, **args):
        """
        Get the URL of `__item__` as assigned by this application, possibly extended with a non-default
        endpoint designation and/or arguments to be passed to a handler function or a template.
        """
        if self.get('url_scheme') == 'raw':
            f = self._url_raw
        else:
            f = self._url_spaces
        return f(__item__, __endpoint__, **args)
        
    def _handle_raw(self, request):
        """
        The 'raw' scheme of parsing URLs. Provides URLs for *all* items in the system, hence it should
        only be used for an Admin application.
        `path` should have a form of: CID,IID
        """
        path, endpoint = self._split_endpoint(request.ipath)
        cid, iid = map(int, path.split(','))
        item = self.registry.get_item((cid, iid))
        
        request.endpoint = endpoint
        
        handler = item.get_handler(endpoint)     # translate `endpoint` to a function that will actually process the request
        return handler(request)
        # return item.serve(request)
        
    def _handle_spaces(self, request):
        """
        Handle requests identified by standard URL paths of the form:
          <space_name>.<category_name>:<item_iid>/endpoint
        """
        path, endpoint = self._split_endpoint(request.ipath)

        # decode names of space and category
        try:
            space_category, item_id = path.split(':')
            space_name, category_name = space_category.split('.')
        except Exception as ex:
            print(ex)
            print('incorrect URL path:', path)
            raise
            
        # map space-category names and the iid to items
        space    = self['spaces'][space_name]
        category = space.get_category(category_name)
        item     = category.get_item(int(item_id))
        
        request.endpoint = endpoint
        
        handler = item.get_handler(endpoint)     # translate `endpoint` to a function that will actually process the request
        return handler(request)
        # return item.serve(request)

    def _url_raw(self, __item__, __endpoint__ = None, **args):
        
        assert __item__.has_id()
        cid, iid = __item__.id
        url = f'{cid},{iid}'
        return self._set_endpoint(url, __endpoint__, args)
        
    def _url_spaces(self, __item__, __endpoint__ = None, **args):
        category = __item__.category
        path = self._qualifier(category)
        base = self['base_url']
        iid  = category.encode_url(__item__.iid)
        url  = f'{base}/{path}:{iid}'
        return self._set_endpoint(url, __endpoint__, args)
    
    @cached(ttl = 10)
    def _qualifier(self, category):
        """Get a qualifer (URL path) of a given category that should be put in URL to access this category's items by IID."""
        for space_name, space in self['spaces'].items():
            for category_name, cat in space['categories'].items():
                if cat.id != category.id: continue
                return f"{space_name}.{category_name}"         # space-category qualifier of item IDs in URLs
        
        raise Exception(f"no URL pattern exists for the requested category: {category}")
    
    def _split_endpoint(self, path):
        """Decode /endpoint from the URL path."""
        
        endpoint = ""
        if '?' in path:
            path, args = path.split('?', 1)
        if '/' in path:
            path, endpoint = path.rsplit('/', 1)
        
        return path, endpoint
    
    def _set_endpoint(self, url, endpoint, args):
        
        if endpoint: url += f'/{endpoint}'
        if args: url += f'?{urlencode(args)}'
        return url
    

class Site(Item):
    """
    Site represents the entire website as seen by clients:
    - all (sub)domains
    - all (sub)applications
    - routing of all URLs
    """

    # _qualifiers = None      # bidirectional mapping (bidict) of app-space-category qualifiers to CID values,
    #                         # for URL routing and URL generation; some categories may be excluded from routing
    #                         # (no public visibility), yet they're still accessible through get_category()

    # def _post_decode(self):
    #
    #     # print('Site.routes:', self['routes'])
    #
    #     self._qualifiers = bidict()
    #
    #     for app in self.list('app'):
    #         for space_name, space in app.get('spaces').items():
    #             for category_name, category in space.get('categories').items():
    #
    #                 qualifier = f"{space_name}.{category_name}"         # space-category qualifier of item IDs in URLs
    #                 self._qualifiers[qualifier] = category.iid

    def get_category(self, cid):
        """Retrieve a category through the Registry that belongs to the current thread."""
        return self.registry.get_category(cid)
    
    def get_item(self, *args, **kwargs):
        """Retrieve an item through the Registry that belongs to the current thread."""
        return self.registry.get_item(*args, **kwargs)
        
    def handle(self, request):
        """
        The site extends the `request` here in handle() with `route`, `app`, and `path` attributes,
        for the use in downstream processing functions.
        """
        route, ipath, app = self.find_app(request)
        
        request.route = route
        request.ipath = ipath
        request.app   = app
        
        return app.handle(request)
    
    def find_app(self, request):
        """Find the first application in data['apps'] that matches the URL `path`."""
        
        url = request.build_absolute_uri()
        for route, app in self['apps'].items():
            base = app['base_url']
            if url.startswith(base):
                path = url[len(base):]
                return route, path, app
        
        raise Exception(f'page not found: {url}')

    # def handle_(self, request, path):
    #     route = self.find_route(request, path)
    #     item, endpoint, args = route.find(path, self.registry)
    #     return item.serve(route, request, endpoint, args)
    #
    # def find_route(self, request, path):
    #     """Find the first route that matches the URL `path`."""
    #
    #     url = request.build_absolute_uri()
    #     for route in self['routes'].values():
    #         if route.match(url): return route
    #
    #     raise Exception(f'route not found for "{path}" path')

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
        

class Directory(Item):
    """"""
    
    def exists(self, path):
        """Check whether a given path exists in this folder."""
    
    def open(self, path):
        """
        Load an item identified by a given `path`.
        The search is performed recursively in this directory and subdirectories (TODO).
        """
        return self.data['items'][path]

class File(Item):

    def read(self):
        return self.data['content']
        

#####################################################################################################################################################
#####
#####  ITEM VIEW
#####

class View:  # Snap / Snapshot / Data
    """
    View of an item's data that provides convenient read access to particular fields
    using dot notation instead of array indexing.
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
    # _route      = None          # the site's Route that this request came from
    # _request    = None          # web request object
    
    def __init__(self, item):
        self._item = item
    
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

    # def url(self, __target_item__ = None, __endpoint__ = None, **params):
    #     """
    #     Generate URL of a target_item when accessed through self._app application;
    #     or URL of self._item if target_item=None.
    #     """
    #     if __target_item__ is None: __target_item__ = self._item
    #     return self._route.url(__target_item__, __endpoint__, **params)

    
#####################################################################################################################################################
#####
#####  Remarks
#####

# TODO:
# -

# ISSUES:
# -
