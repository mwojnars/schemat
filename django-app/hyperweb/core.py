import re
from django.http import HttpRequest, HttpResponse
from nifty.text import html_escape

from .config import ROOT_CID, MULTI_SUFFIX
from .data import Data
from .errors import *
from .store import SimpleStore
from .schema import Schema
from .document import Document


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
    __category__ = None         # instance of Category this item belongs to
    __loaded__   = False        # True if this item's data has been fully loaded from DB; for implementation of lazy loading of linked items
    
    __handlers__ = None         # dict {handler_name: method} of all handlers (= public web methods) exposed by items of the current Item subclass
    
    @property
    def __id__(self): return self.__cid__, self.__iid__
    
    @__id__.setter
    def __id__(self, id): self.__cid__, self.__iid__ = id

    # @property
    # def data(self):
    #     return Data(self.__data__)
    
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
            self.__category__ = site.get_category(self.__cid__)


    def __getattr__(self, name):
        """Calls either get() or getlist(), depending on whether MULTI_SUFFIX is present in `name`."""
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
        """Get a list of all values of an attribute from __data__. Shorthand for self.__data__.getlist()"""
        if not (self.__loaded__ or name in self.__data__):
            self.__load__()
        return self.__data__.getlist(name, default, copy_list)

    def set(self, name, value):
        """Assigns a singleton `value` to a given name in __data__, also when `name` looks like a private attr."""
        self.__data__[name] = value

    def setlist(self, name, values):
        """Assigns a list of 0+ `values` to a given name in __data__."""
        self.__data__.setlist(name, values)

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
        item.__category__ = item if (cid == iid == ROOT_CID) else Site._categories[cid]

        # convert __data__ from JSON string to a struct
        if data:
            schema = item.__category__.schema
            data = schema.decode_json(data)
            # print(f"__decode__ in {item}, data:", data.dict_first())
            item.__data__.update(data)
        
        item._post_decode()
        #item.commit()
        
        return item

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
        
    def __handle__(self, request, handler):
        """
        Route a web request to a handler function/method of a given name. Handler functions are stored in a parent category object.
        """
        hdl = self.__handlers__.get(handler, None)
        if hdl is None: raise InvalidHandler(f'Handler "{handler}" not found in {self} ({self.__class__}), handlers: {self.__handlers__}')
        return hdl(self, request)
        
    @handler()
    def __view__(self, request):
        """
        Default handler invoked to render a response to item request when no handler name was given.
        Inside category's handlers dict, this method is saved under the None key.
        """
        h = html_escape

        # attrs = [f"<li><b>{attr}</b>: {values}</li>" for attr, values in self.__data__.items_all()]
        # attrs = '\n'.join(attrs)
        
        doc = Document()
        doc << f"<h1>{h(str(self))} -- ID {self.__id__}</h1>"
        doc << f"<ul>"
        for attr, values in self.__data__.items_all():
            doc << f"<li><b>{attr}</b>: {values}</li>"
        doc << f"</ul>"
        
        doc << hyml(
            """
            h1 | {item} -- ID {item.__id__}
            ul
                for attr, values in item.__data__.items_all()
                    li / <b>{attr}</b>: {values}
                    
            -- embedding of a widget: method __embed__(doc) is called instead of __str__
            -- __embed__() returns contents to insert here, but also may modify `doc`: add contents to other zones, create zones
            widget
            """,
            context = {'item': self}
        )
        
        return doc
        
        # return f"""
        #     <h1>{h(str(self))} -- ID {self.__id__}</h1>
        #     <ul>{attrs}</ul>
        # """
    
    """
    from catalog.web import header, footer
    
    % __view__ item:
        header
        / $item.header()
        for (name, value), class in alternate(item.data.items(), 'odd', 'even'):
            field = item.get_field(name)
            tr .$class
                td | $name
                td | $field.render(value)
                td / ala ma kota
        footer
    
    """

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
    _boot_store   = SimpleStore()       # data store used during startup for accessing category-items
    _store        = None                # data store used for regular access to items of this category
    
    def __init__(self, **attrs):
        attrs['__cid__'] = ROOT_CID
        super().__init__(**attrs)
        self._store = SimpleStore()

        # public attributes of a category
        self.schema = Schema()          # a Schema that puts constraints on attribute names and values allowed in this category

    def __load__(self):
        self.__loaded__ = True                      # this must be set already here to avoid infinite recursion

        # root Category doesn't have a schema, yet; attributes must be set or decoded manually
        if self.__iid__ == ROOT_CID:
            self.itemclass = Category
        else:
            self.itemclass = Item       # an Item subclass that most fully implements functionality of this category's items and should be used when instantiating items loaded from DB
        
        record = self._boot_store.load_category(self.__iid__, self.name)
        self.__decode__(record, item = self)
        
        return self

    #####  Items in category  #####
    
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

    def load(self, iid):
        """Load from DB an item that belongs to the category represented by self."""

        return self.get_item(iid).__load__()
        
    def all_items(self, limit = None):
        """
        Load all items of this category, ordered by IID, optionally limited to max. `limit` items with lowest IID.
        Return an iterable, but not a list.
        """
        records = self._store.load_all(self.__iid__, limit)
        return map(self.itemclass.__decode__, records)
        
    def first_item(self):
        
        items = list(self.all_items(limit = 1))
        if not items: raise self.itemclass.DoesNotExist()
        return items[0]

    @handler('new')
    def _handle_new(self, request):
        """Web handler that creates a new item of this category based on `request` data."""
        
        data = Data()
        
        # retrieve attribute values from GET/POST
        # POST & GET internally store multi-valued parameters (lists of values for each parameter)
        for attr, values in request.POST.lists():
            data.setlist(attr, values)
        for attr, values in request.GET.lists():
            data.setlist(attr, values)

        item = self.new_item(data)
        item.save()
        return HttpResponse(html_escape(f"Item created: {item}"))
        

#####################################################################################################################################################
#####
#####  SITE
#####

class Categories:
    """
    Flat collection of all categories found in DB, accessible by their names and CIDs (category's IID). Provides caching.
    """    
    cache = None
    
    def __init__(self):
        
        root_category = Category(__iid__ = ROOT_CID).__load__()     # root Category is a category for itself, hence its IID == CID
        self.cache = {"Category": root_category}
        
    def __getitem__(self, key):
        
        # try to get the item from cache
        category = self.cache.get(key)
        if category: return category
        
        iid = name = None

        # not in cache? load from DB
        if isinstance(key, str):
            name = key
        else:
            assert isinstance(key, int), key
            iid = key

        category = Category(__iid__ = iid, name = name).__load__()
        
        # save in cache for later use
        self.cache[category.__iid__] = category

        assert category.name, key
        self.cache[category.name] = category

        return category 
    
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
    _categories = None       # flat collection of all categories found in DB, as a class-global singleton instance of Categories; after boot(), it can be accessed as Site.categories
    _descriptors = None      # {app-space-category descriptor: Category}

    @classmethod
    def boot(cls):
        """Create initial global Site object with attributes loaded from DB. Called once during startup."""
        
        categories = cls._categories = Categories()
        Site = categories['Site']
        root = cls.root = Site.first_item()
        return root

    def _post_decode(self):

        self._descriptors = {}
        
        for app in self.app_list:
            for space_name, space in app.spaces.items():
                for category_name, category in space.categories.items():
                    descriptor = f"{space_name}.{category_name}"
                    self._descriptors[descriptor] = category

    def get_category(self, cid):
        return self._categories.get(cid)

    def load(self, descriptor, app = None):
        
        qualifier, iid = descriptor.split(':')
        category = self._descriptors[qualifier]
        return category.load(int(iid))
        
        
        
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

site = Site.boot()

# print("categories:", Site.categories.cache)
# print("Category.schema: ", Field._json.dumps(site._categories['Category'].schema))
# print("Site.schema:     ", Field._json.dumps(site.__category__.schema))
