import re, threading
from time import sleep
from cachetools import TTLCache
from bidict import bidict

from django.http import HttpRequest, HttpResponse
from django.core.signals import request_finished
from django.dispatch import receiver

from nifty.text import html_escape

from .config import ROOT_CID, SITE_CID, SITE_IID, MULTI_SUFFIX
from .data import Data
from .errors import *
from .store import SimpleStore
from .schema import Schema
from .document import Document

from hypertag.core.run_html import HypertagHTML

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
        cls.__handlers__ = handlers = {}
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
    
    # builtin instance attributes & properties, not user-editable ...
    __cid__      = None         # __cid__ (Category ID) of this item
    __iid__      = None         # __iid__ (Item ID within category) of this item
                                # ... the (CID,IID) tuple is a globally unique ID of an item and a primary key in DB
    __data__     = None         # MultiDict with values of object attributes; an attribute can have multiple values
    __created__  = None         # datetime when this item was created in DB; no timezone
    __updated__  = None         # datetime when this item was last updated in DB; no timezone
    
    __category__ = None         # parent category of this item, as an instance of Category
    __registry__ = None         # Registry that manages access to this item
    __loaded__   = False        # True if this item's data has been fully decoded from DB; for implementation of lazy loading of linked items
    
    __handlers__ = None         # dict {handler_name: method} of all handlers (= public web methods)
                                # exposed by items of the current Item subclass
    __views__    = None         # similar to __handlers__, but stores Hypertag scripts (<str>) instead of methods;
                                # if a handler is not found in __handlers__, a script is looked up in __views__
                                # and compiled to HTML through Hypertag
    
    @property
    def __id__(self): return self.__cid__, self.__iid__
    
    @__id__.setter
    def __id__(self, id): self.__cid__, self.__iid__ = id

    # @property
    # def data(self):
    #     return Data(self.__data__)
    
    # names that must not be used for attributes inside __data__
    __reserved__ = ['set', 'get', 'getlist', 'insert', 'update', 'save', 'url']
    
    def __init__(self, __registry__, **attrs):
        """None values in `attrs` are IGNORED when copying `attrs` to self."""
        
        self.__registry__ = __registry__
        self.__data__ = Data()          # REFACTOR
        
        # user-editable attributes & properties; can be missing in a particular item
        self.name = None        # name of item; constraints on length and character set depend on category
        
        for attr, value in attrs.items():
            if value is not None: setattr(self, attr, value)
        
        # impute __cid__ and __category__
        if self.__category__ and self.__cid__ is not None:
            assert self.__cid__ == self.__category__.__iid__
        elif self.__category__:
            self.__cid__ = self.__category__.__iid__
        elif self.__cid__ is not None:
        # else:
            self.__category__ = __registry__.get_category(self.__cid__)
        # assert self.__category__ is not None

    def _get_current(self):
        """Look this item's ID up in the Registry and return its most recent instance; load from DB if no longer in the Registry."""
        return self.__registry__.get_item(self.__id__)

    def __getattr__(self, name):
        """
            Calls either get() or getlist(), depending on whether MULTI_SUFFIX is present in `name`.
            __getattr__() is a fallback for regular attribute access, so it gets called ONLY when the attribute
            has NOT been found in the object's __dict__ or in a parent class (!)
        """
        if MULTI_SUFFIX and name.endswith(MULTI_SUFFIX):
            basename = name[:-len(MULTI_SUFFIX)]
            return self.getlist(basename)
        return self.get(name)

    def get(self, name, default = _RAISE_):
        """Get attribute value from:
           - self.__data__ OR
           - self.__category__'s schema defaults OR
           - self.__class__'s class-level defaults.
           If `name` is not found, `default` is returned if present, or AttributeError raised otherwise.
        """
        try:
            if not (self.__loaded__ or name in self.__data__):
                self.__load__()
            return self.__data__[name]
        except KeyError: pass
        
        # # TODO: search `name` in __category__'s default values
        # category = _get_(self, '__category__')
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
        """Get a list of all values of an attribute from __data__. Shorthand for self.__data__.get_multi()"""
        if not (self.__loaded__ or name in self.__data__):
            self.__load__()
        return self.__data__.get_multi(name, default, copy_list)

    def set(self, key, *values):
        """
        Assign `values` to a given key in __data__. This can be used instead of __setattr__ when the key looks
        like a private attr and would be assigned to __dict__ otherwise; or when mutliple values have to be assigned.
        """
        self.__data__.set(key, *values)

    def __setattr__(self, name, value):
        """Assigns a singleton `value` to a given name in __data__; or to __dict__ if `name` is a private attr."""
        
        # store private attributes in __dict__, not __data__
        if name[0] == '_':
            object.__setattr__(self, name, value)
        else:
            self.__data__[name] = value
        # data = object.__getattribute__(self, '__data__')
        # data[name] = value
        
    def __dir__(self):
        attrs = set(super().__dir__())
        attrs.update(self.__data__.keys())
        return attrs
        
    def __repr__(self, max_len_name = 30):
        
        cat = self.__category__
        category = f'{cat.name}' if cat and cat.name else f'CID({self.__cid__})'
        name     = f' {self.name}' if self.name is not None else ''
        if len(name) > max_len_name:
            name = name[:max_len_name-3] + '...'
        
        return f'<{category}:{self.__iid__}{name}>'
    
    @classmethod
    def _create(cls, __registry__, category):
        """Called by Registry to create a new instance."""
        item = cls(__registry__)
        item.__category__ = category
        item.__cid__ = item.__category__.__iid__
        return item
        
    @classmethod
    def __create__(cls, __registry__, _data = None, **attrs):
        """
        Create a new item initialized with `attrs` attribute values, typically passed from a web form;
        or with an instance of Data (_data) to initialize attributes directly with a MultiDict.
        """
        item = cls(__registry__)
        if _data is not None:
            item.__data__ = _data
            
        for attr, value in attrs.items():
            item.__data__[attr] = value
            
        return item
    
    def __load__(self):
        """
        Load into self the entire data of this item as stored in its item row in DB.
        The row is found using any information that's currently available in self, typically the __id__.
        This method can be called at any point in time, not necessarily during initialization.
        Importantly, __load__() call can be delayed until a value of a missing (not loaded) attribute
        is requested (lazy loading).
        """
        self.__loaded__ = True                      # this must be set already here to avoid infinite recursion
        store = self.__category__._store
        record = store.load(self.__id__)
        self.__decode__(record)
        return self
    

    def __decode__(self, record, loaded = True):
        """
        Decode fields from a DB `record` into item's attributes; or into a new instance
        of <cls> if `item` is None. Return the resulting item.
        If loaded=True, the resulting item is marked as fully loaded (__loaded__).
        """
        # item = item or cls(__registry__)
        item = self
        item.__loaded__ = loaded
        
        data = record.pop('__data__')
        
        for field, value in record.items():
            if value in (None, ''): continue
            setattr(item, field, value)
        
        # impute __category__; note the special case: the root Category item is a category for itself!
        cid, iid = item.__id__
        item.__category__ = item if (cid == iid == ROOT_CID) else self.__registry__.get_category(cid)

        # convert __data__ from JSON string to a struct
        if data:
            schema = item.__category__.schema
            data = schema.decode_json(data)
            item.__data__.update(data)
        
        item._post_decode()
        #item.commit()

    def __handle__(self, request, endpoint = None):
        """
        Route a web request to a given endpoint.
        Endpoint can be implemented as a handler function/method, or a view template.
        Handler functions are stored in a parent category object.
        """
        # TODO: route through a predefined pipeline of handlers
        
        # search for a Hypertag script in __views__
        view = self.__views__.get(endpoint, None)
        if view is not None:
            return HypertagHTML(item = self).render(view)

        # no view found; search for a handler method in __handlers__
        hdl = self.__handlers__.get(endpoint, None)
        if hdl is not None:
            return hdl(self, request)
        
        raise InvalidHandler(f'Endpoint "{endpoint}" not found in {self} ({self.__class__})')
        
    _default_view = \
    """
        import $item
        % aCategory
            a href=$item.__category__.url() | {item.__category__.name? or item.__category__}
            -- TODO: aCategory should be inserted in inline mode to avoid spaces around parentheses (...)
            
        html
            head
                title | {item.name? or item}
            body
                h1
                    | {item.name? or item} (
                    aCategory
                    | ) -- ID {item.__id__}
                p
                    | Category:
                    aCategory
                h2  | Attributes
                ul
                    for attr, value in item.__data__.items()
                        li
                            b | {attr}:
                            . | {value}
    """
    
    __views__ = {
        None: _default_view,
    }

    # """
    # from catalog.web import header, footer
    # % __view__ item:
    #     header
    #     / $item.header()
    #     for (name, value), class in alternate(item.data.items(), 'odd', 'even'):
    #         field, something = item.get_field(name), something_else
    #         tr .$class
    #             td | $name
    #             td | $field.render(value)
    #             td / ala ma kota
    #     footer
    # """

    def _post_decode(self):
        """Override this method in subclasses to provide additional initialization/decoding when an item is retrieved from DB."""
        
    def _to_json(self):
        schema = self.__category__.get('schema')
        return schema.encode_json(self.__data__)
        
    def insert(self):
        """
        Insert this item as a new row in DB. Assign a new IID (self.__iid__) and return it.
        The item might have already been present in DB, but still a new copy is created.
        """
        self.__category__._store.insert(self)
        
    def update(self):
        """Update the contents of this item's row in DB."""
        self.__category__._store.update(self)

    def save(self):
        """
        Save this item to DB. This means either an update of an existing DB row (if __iid__ is already present),
        or an insert of a new row (iid is assigned then and returned).
        """
        if self.__iid__ is None:
            return self.insert()
        else:
            self.update()
            return None

    def url(self, __endpoint = None, *args, **kwargs):
        """Return canonical URL of this item, possibly extended with a non-default
           endpoint designation and/or arguments to be passed to a handler function or a view template.
        """
        return self.__category__.url_of(self, __endpoint, *args, **kwargs)
        

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
    __cid__ = ROOT_CID
    
    # internal attributes
    _boot_store = SimpleStore()     # data store used during startup for accessing category-items
    _store      = None              # data store used for regular access to items of this category

    def __init__(self, __registry__, __iid__ = None, **attrs):
        if __iid__ is not None: self.__iid__ = __iid__
        
        if self._is_root():
            self.__category__ = self
        else:
        # if self.__category__ is None:
            self.__category__ = __registry__.get_category(ROOT_CID)
            
        super(Category, self).__init__(__registry__, **attrs)
        
        self._store = SimpleStore()

        # public attributes of a category
        self.schema    = Schema()       # a Schema that puts constraints on attribute names and values allowed in this category
        self.itemclass = Item           # an Item subclass that most fully implements functionality of this category's items and should be used when instantiating items loaded from DB
        
        if self._is_root():
            self.itemclass = Category   # root Category doesn't have a schema, yet; attributes must be set/decoded manually
            # print('in Category.__init__ of root')
            
        # print(f'Category.__init__(), created new category {self} - {id(self)}')

    def _is_root(self):
        return self.__iid__ == ROOT_CID
        
    def _bootload(self):
        self.__loaded__ = True                      # this must be set already here to avoid infinite recursion
        record = self._boot_store.bootload_category(name = self.name)
        self.__decode__(record)
        return self

    #####  Items in category (low-level interface that does NOT scale)  #####
    
    def new_item(self, *args, **kwargs):
        """Create a new item of this category, one that's not yet in DB. For web-based item creation, see the new() handler."""
        item = self.itemclass.__create__(self.__registry__, *args, **kwargs)
        item.__id__ = (self.__iid__, None)
        item.__category__ = self
        return item

    def get_item(self, iid):
        """
        Instantiate an Item (a stub) and seed it with IID (the IID being present in DB, presumably, not checked),
        but do NOT load remaining contents from DB (lazy loading).
        """
        return self.__registry__.get_item(iid = iid, category = self)
    
    def load(self, iid_str):
        """Load from DB an item that belongs to the category represented by self."""

        iid = self._iid_decode(iid_str)
        return self.get_item(iid).__load__()
        
    def all_items(self, limit = None):
        """
        Load all items of this category, ordered by IID, optionally limited to max. `limit` items with lowest IID.
        Return an iterable, not a list.
        """
        records = self._store.load_all(self.__iid__, limit)
        for record in records:
            item = self.itemclass(self.__registry__)
            item.__decode__(record)
            yield item
        
    def first_item(self):
        
        items = list(self.all_items(limit = 1))
        if not items: raise self.itemclass.DoesNotExist()
        return items[0]

    #####  Handlers & views  #####

    @handler('new')
    def _handle_new(self, request):
        """Web handler that creates a new item of this category based on `request` data."""
        
        data = Data()
        
        # retrieve attribute values from GET/POST
        # POST & GET internally store multi-valued parameters (lists of values for each parameter)
        for attr, values in request.POST.lists():
            data.set(attr, *values)
        for attr, values in request.GET.lists():
            data.set(attr, *values)

        item = self.new_item(data)
        item.save()
        return HttpResponse(html_escape(f"Item created: {item}"))
        
    _default_view = \
    """
        import $item as cat
        html
            head
                title | {cat.name ' -' }? category #{cat.__iid__}
            body
                h1
                    try
                        i | {cat.name}
                        . | -
                    | category #{cat.__iid__}
                p
                    . | Items in category
                    i | {cat.name}:
                table
                    for item in cat.all_items()
                        tr
                            td / #{item.__iid__} &nbsp;
                            td : a href=$item.url()
                                | {item.name? or item}
    """
    
    __views__ = {
        None: _default_view,
    }

    def url_of(self, item, __endpoint = None, *args, **kwargs):
        
        assert item.__cid__ == self.__iid__
        
        base_url  = site.base_url
        qualifier = site.get_qualifier(self)
        iid       = self._iid_encode(item.__iid__)
        # print(f'category {self.__iid__} {id(self)}, qualifier {qualifier} {self._qualifier}')
        
        url = f'{base_url}/{qualifier}:{iid}'
        if __endpoint: url += f'/{__endpoint}'
            
        return url
    
    def _iid_encode(self, iid):
        """This method, together with _iid_decode(), can be customized in subclasses to provide
           a different way of representing IIDs inside URLs.
        """
        return str(iid)
    
    def _iid_decode(self, iid_str):
        """Convert an encoded IID representation found in a URL back to an <int>. Reverse operation to _iid_encode()."""
        return int(iid_str)
        
        
class RootCategory(Category):
    """Root category: a category for all other categories."""

    __iid__ = ROOT_CID

    def __init__(self, __registry__):

        # print('RootCategory.__init__ start')
        self.__category__ = self
        
        super(RootCategory, self).__init__(__registry__)
        
        self.name      = 'Category'
        self.itemclass = Category       # root Category doesn't have a schema, yet; attributes must be set/decoded manually
        # print('RootCategory.__init__ stop')

    # def __init__(self, **attrs):
    #     super(RootCategory, self).__init__(**attrs)
    #     self.itemclass = Category
    #     self.schema = Schema()
    #     # self.schema.fields = {"schema": None, "itemclass": None}
    #     # "schema": {"@": "$Object", "class_": {"=": "$Schema", "@": "!type"}, "strict": true}
    #     # "itemclass": {"@": "$Class"}


#####################################################################################################################################################
#####
#####  SITE
#####

class Application(Item): pass
class Space(Item): pass

class TTLCacheX(TTLCache):
    """
    Extended version of cachetools.TTLCache:
    - __init__ accepts maxsize=None
    - explicit set(key, val, ttl, protect=False) accepts explicit per-item TTL value that can differ from the global one supplied to __init__
      - if ttl=None the item never expires
      - if protect=True the item never gets evicted from cache, neither due to expiration nor LRU
    - explicit flush(maxsize=...) to truncate the cache and discard expired/excessive items to match the desired maxsize
    """

class Registry:
    """
    A registry of Item instances recently created or loaded from DB during current web request or previous ones.
    Registry makes sure there are no two different Item instances for the same item ID (no duplicates).
    When request processing wants to access or create an item, this must always be done through Site.get_item(),
    so that the item is checked in the Registry and taken from there if it already exists.
    De-duplication improves performance thanks to avoiding repeated json-decoding of the same item records.
    This is particularly important for Category items which are typically accessed multiple times during a single web request.
    WARNING: some duplicate items can still exist and be hanging around as references from other items - due to cache flushing,
    which removes items from the Registry but does NOT remove/update references from other items that are still kept in cache.
    Hence, you shall NEVER assume that two items of the same IID - even if both retrieved through the Registry -
    are the same objects or are identical. This also applies to Category objects referrenced by items through __category__.
    (TODO...)
    - Discarding of expired/excessive items is ONLY performed after request handling is finished
    (via django.core.signals.request_finished), which alleviates the problem of indirect duplicates.
    - In a multi-threaded web app, or when sub-threads are spawned during request handling, each thread must have its own Registry (!)
    """
    
    items = None        # cache (TTLCache) containing {ID: item_instance} pairs
    
    def __init__(self):
        self.items = TTLCache(1000000, 1000000)     # TODO: use customized subclass of Cache; only prune entries after web requests; protect RootCategory
        # print(f'Registry() created in thread {threading.get_ident()}')
    
    def new_item(self, category = None, cid = None):
        
        if not category: category = self.get_category(cid)
        itemclass = category.itemclass
        return itemclass._create(self, __cid__ = cid)
        
    
    def get_item(self, id_ = None, cid = None, iid = None, category = None, load = True):
        """
        If `load` is False, the returned item usually contains only __cid__ and __iid__ (no data).
        This is not a strict rule, however, and if the item has been loaded or created before,
        by this or a previous request handler, the item can already be fully initialized.
        Hence, the caller should never assume that the returned item's __data__ is missing.
        """
        if not id_:
            if category: cid = category.__iid__
            id_ = (cid, iid)
        else:
            (cid, iid) = id_
            
        if cid is None: raise Exception('missing CID')
        if iid is None: raise Exception('missing IID')
        
        # ID requested is already present in the registry? return the existing instance
        item = self.items.get(id_)
        if item: return item
        
        # special handling for the root Category
        if cid == iid == ROOT_CID:
            item = RootCategory(self)._bootload()           # TODO: move to __init__ and mark this entry as protected to avoid removal
            self._set(id_, item)
            # print(f'Registry.get_item(): created root category - {id(item)}')
            return item
        
        # determine what itemclass to use for instantiation
        if not category:
            category = self.get_category(cid)
        itemclass = category.itemclass                  # REFACTOR

        # create a new instance and insert to cache
        item = itemclass(self, __cid__ = cid, __iid__ = iid)
        # item = itemclass._create(__cid__ = cid, __iid__ = iid)
        if load: item.__load__()
        self._set(id_, item)

        # print(f'Registry.get_item(): created item {id_} - {id(item)}')
        return item
    
    def get_lazy(self, *args, **kwargs):
        """Like get_item() but with load=False."""
        return self.get_item(*args, **kwargs, load = False)
    
    def get_category(self, cid):
        # assert cid is not None
        return self.get_item((ROOT_CID, cid))

    def _set(self, id_, item):
    
        item.__registry__ = self
        self.items[id_] = item


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
    """

    re_codename = re.compile(r'^[a-zA-Z][a-zA-Z0-9_-]*$')         # valid codename of a space or category

    # internal variables
    
    _qualifiers = None      # bidirectional mapping (bidict) of app-space-category qualifiers to CID values,
                            # for URL routing and URL generation; some categories may be excluded from routing
                            # (no public visibility), yet they're still accessible through get_category()

    # Site class is special in that it holds distinct Registry instances for each processing thread.
    # This is to ensure each thread operates on separate item objects to avoid interference
    # when two threads modify same-ID items concurrently.
    _thread_local = threading.local()

    @property
    def __registry__(self):
        reg = getattr(self._thread_local, '__registry__', None)
        if reg is None:
            reg = self._thread_local.__registry__ = Registry()
        return reg

    @__registry__.setter
    def __registry__(self, reg):
        self._thread_local.__registry__ = reg
    
    def _post_decode(self):

        self._qualifiers = bidict()
        
        for app in self.app_list:
            for space_name, space in app.spaces.items():
                for category_name, category in space.categories.items():
                    
                    # category = self._categories.setdefault(category.__iid__, category)     # store category in self._categories if not yet there
                    qualifier = f"{space_name}.{category_name}"         # space-category qualifier of item IDs in URLs
                    self._qualifiers[qualifier] = category.__iid__
                    # print(f'initialized category {qualifier}, {category._qualifier} - {id(category)}')

    def get_category(self, cid):
        """Retrieve a category through the Registry that belongs to the current thread."""
        return self.__registry__.get_category(cid)
    
    def get_item(self, *args, **kwargs):
        """Retrieve an item through the Registry that belongs to the current thread."""
        return self.__registry__.get_item(*args, **kwargs)
        
    def get_qualifier(self, category = None, cid = None):
        """Get a qualifer of a given category that should be put in URL to access this category's items by IID."""
        if cid is None: cid = category.__iid__
        return self._qualifiers.inverse[cid]

    def load(self, descriptor):
        
        # print(f'handler thread {threading.get_ident()}')
        
        # below, `iid` can be a number, but this is NOT a strict requirement; interpretation of URL's IID part
        # is category-dependent and can be customized by Category subclasses
        try:
            qualifier, iid = descriptor.split(':', 1)
        except Exception as ex:
            print(ex)
            print('incorrect descriptor:', descriptor)
            raise
            
        cid = self._qualifiers[qualifier]
        category = self.get_category(cid)
        return category.load(iid)
        
        
#####################################################################################################################################################

"""
Schema...

Category:
"schema": {
    "fields": {
        "itemclass": {"@": "$Class"},
        "schema": {"class_": {"=": "$Schema", "@": "!type"}, "strict": true, "@": "$Object"}
    },
    "@": "$Schema"
}

Site:
"schema": {"fields": {"app": {"cid": 2, "@": "$Link"}}}

Application:
"schema": {"fields": {"spaces": {"keys": {"@": "$String"}, "values": {"cid": 3, "@": "$Link"}, "@": "$Dict"}}}

Space:
"schema": {"fields": {"categories": {"keys": {"@": "$String"}, "values": {"cid": 0, "@": "$Link"}, "@": "$Dict"}}}

"""

#####################################################################################################################################################
#####
#####  GLOBALS
#####

@receiver(request_finished)
def after_request(sender, **kwargs):
    print(f'after_request() in thread {threading.get_ident()} start...')
    sleep(5)
    print(f'after_request() in thread {threading.get_ident()} ...stop')

print(f'main thread {threading.get_ident()}')

#####################################################################################################################################################

site = Registry().get_lazy(cid = SITE_CID, iid = SITE_IID)
site.__load__()

# print("Category.schema: ", Field._json.dumps(site._categories['Category'].schema))
# print("Site.schema:     ", Field._json.dumps(site.__category__.schema))


# TODO:
# - remove Item.__init__
# - refactor Item.__loaded__
