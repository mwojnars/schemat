import re
from django.http import HttpRequest, HttpResponse
from nifty.text import html_escape

from .config import ROOT_CID, MULTI_SUFFIX
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
    
    __site__     = None         # Site instance that loaded this item
    __category__ = None         # parent category of this item, as an instance of Category
    __loaded__   = False        # True if this item's data has been fully loaded from DB; for implementation of lazy loading of linked items
    
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
    
    def __init__(self, **attrs):
        """None values in `attrs` are IGNORED when copying `attrs` to self."""
        
        self.__data__ = Data()
        
        # user-editable attributes & properties; can be missing in a particular item
        self.name = None        # name of item; constraints on length and character set depend on category
        
        for attr, value in attrs.items():
            if value is not None: setattr(self, attr, value)
        
        # impute __cid__ to/from __category__
        if self.__category__ and self.__cid__ is not None:
            assert self.__cid__ == self.__category__.__iid__
        elif self.__category__:
            self.__cid__ = self.__category__.__iid__
        elif self.__cid__:
            self.__category__ = self.__site__.get_category(self.__cid__)


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
    def __create__(cls, _data = None, **attrs):
        """
        Create a new item initialized with `attrs` attribute values, typically passed from a web form;
        or with an instance of Data (_data) to initialize attributes directly with a MultiDict.
        """
        item = cls()
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
        self.__decode__(record, item = self)
        return self
    

    @classmethod
    def __decode__(cls, record, item = None, loaded = True):
        """
        Decode fields from a DB `record` into item's attributes; or into a new instance
        of <cls> if `item` is None. Return the resulting item.
        If loaded=True, the resulting item is marked as fully loaded (__loaded__).
        """
        item = item or cls()
        item.__loaded__ = loaded
        
        data = record.pop('__data__')

        for field, value in record.items():
            if value in (None, ''): continue
            setattr(item, field, value)
        
        # impute __category__; note the special case: the root Category item is a category for itself!
        cid, iid = item.__id__
        item.__category__ = item if (cid == iid == ROOT_CID) else Site.get_category(cid)

        # convert __data__ from JSON string to a struct
        if data:
            schema = item.__category__.schema
            data = schema.decode_json(data)
            # print(f"__decode__ in {item}, data:", data.asdict_first())
            item.__data__.update(data)
        
        item._post_decode()
        #item.commit()
        
        return item

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
        
        raise InvalidHandler(f'Endpoint "{endpoint}" not found in {self} ({self.__class__})')  #handlers: {self.__handlers__}
        
    # @handler()
    # def __view__(self, request):
    #     """
    #     Default handler invoked to render a response to item request when no handler name was given.
    #     Inside category's handlers dict, this method is saved under the None key.
    #     """
    #     return HypertagHTML(item = self).render(self._view_item_)
    
    _default_view = \
    """
        import $item
        html
            head
                title | Item ID {item.__id__}
            body
                h1 | {item.name? or item} -- ID {item.__id__}
                ul
                    for attr, value in item.__data__.items()
                        li / <b>{attr}</b>: {value}
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
    
    # internal attributes
    _boot_store = SimpleStore()     # data store used during startup for accessing category-items
    _store      = None              # data store used for regular access to items of this category
    _qualifier  = None              # qualifier of this category for use inside URLs; assigned by Site upon loading
    
    def __init__(self, **attrs):
        attrs['__cid__'] = ROOT_CID
        super().__init__(**attrs)
        self._store = SimpleStore()

        # public attributes of a category
        self.schema = Schema()          # a Schema that puts constraints on attribute names and values allowed in this category
        
    def _is_root(self):
        return self.__iid__ == ROOT_CID
        
    def __load__(self):
        self.__loaded__ = True                      # this must be set already here to avoid infinite recursion

        # root Category doesn't have a schema, yet; attributes must be set or decoded manually
        if self._is_root():
            self.itemclass = Category
        else:
            self.itemclass = Item       # an Item subclass that most fully implements functionality of this category's items and should be used when instantiating items loaded from DB
        
        record = self._boot_store.load_category(self.__iid__, self.name)
        self.__decode__(record, item = self)
        
        return self

    #####  Items in category (low-level interface that does NOT scale)  #####
    
    def new_item(self, *args, **kwargs):
        """Create a new item of this category, one that's not yet in DB. For web-based item creation, see the new() handler."""
        item = self.itemclass.__create__(*args, **kwargs)
        item.__id__ = (self.__iid__, None)
        item.__category__ = self
        return item

    def get_item(self, iid):
        """
        Instantiate an Item and seed it with IID (the IID being present in DB, presumably),
        but do NOT load remaining contents from DB (lazy loading).
        """
        return self.itemclass(__category__ = self, __iid__ = iid)

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
        return map(self.itemclass.__decode__, records)
        
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
        
        base_url  = self.__site__.base_url
        qualifier = self._qualifier
        iid       = self._iid_encode(item.__iid__)
        print(f'category {self.__iid__} {id(self)}, qualifier {qualifier} {self._qualifier}')
        
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
        
        

#####################################################################################################################################################
#####
#####  SITE
#####

class Categories:
    """
    Flat collection of all categories found in DB, accessible by their names and CIDs (category's IID). Provides caching.
    """    
    cache = None        # dict of Category instances; each category is present under both its name AND its IID
    
    def __init__(self):
        
        self.cache = {}
        # root = Category(__iid__ = ROOT_CID).__load__()        # root Category is a category for itself, hence its IID == CID
        # self.cache = {"Category": root}
        
    def __getitem__(self, iid):
        
        # try to get the item from cache
        category = self.cache.get(iid)
        if category: return category
        
        category = Category(__iid__ = iid).__load__()

        # save in cache for later use and return
        return self.setdefault(category)

    def setdefault(self, category):
        return self.cache.setdefault(category.__iid__, category)
    
    get = __getitem__


class Application(Item):
    pass

class Space(Item):
    pass
        
class Site(Item):
    """
    The global `site` object is created in hyperweb/__init__.py and can be imported with:
      from hyperweb import site
    """
    
    re_codename = re.compile(r'^[a-zA-Z][a-zA-Z0-9_-]*$')         # valid codename of a space or category
    
    root = None             # the global Site object created during boot()
    
    # internal variables
    _categories = None      # flat collection of all categories found in DB, as a class-global singleton instance of Categories;
                            # after boot(), it can be accessed through Site.get_category()
    _qualifiers = None      # mapping (dict) of app-space-category qualifiers to Category objects

    @classmethod
    def boot(cls):
        """Create initial global Site object with attributes loaded from DB. Called once during startup."""
        
        cls._categories = categories = Categories()
        # Site = categories['Site']
        Site = Category(name = 'Site').__load__()
        Site = categories.setdefault(Site)
        root = cls.root = Site.first_item()
        return root

    def _post_decode(self):

        self._qualifiers = {}
        
        for app in self.app_list:
            for space_name, space in app.spaces.items():
                for category_name, category in space.categories.items():
                    category = self._categories.setdefault(category)     # store category in self._categories if not yet there
                    # if category._is_root():
                    #     category = self._categories.root                # don't duplicate root Category but use the global one instead
                    qualifier = f"{space_name}.{category_name}"         # space-category qualifier of item IDs in URLs
                    category._qualifier = qualifier
                    self._qualifiers[qualifier] = category
                    print(f'initialized category {qualifier}, {category._qualifier} - {id(category)}')

    @classmethod
    def get_category(cls, cid):
        return cls._categories.get(cid)

    def load(self, descriptor, app = None):
    
        # below, `iid` can be a number, but this is NOT a strict requirement; interpretation of URL's IID part
        # is category-dependent and can be customized by Category subclasses
        qualifier, iid = descriptor.split(':', 1)
        category = self._qualifiers[qualifier]
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

site = Item.__site__ = Site.boot()          # for now, we assume the global Site object is the site of all items

# print("categories:", Site.categories.cache)
# print("Category.schema: ", Field._json.dumps(site._categories['Category'].schema))
# print("Site.schema:     ", Field._json.dumps(site.__category__.schema))
