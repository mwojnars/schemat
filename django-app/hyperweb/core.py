import re, importlib
from django.http import HttpRequest, HttpResponse
from nifty.text import html_escape

from .config import ROOT_CID, MULTI_SUFFIX
from .data import Data
from .errors import *
from .store import SimpleStore


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
    __id__       = None         # (__cid__, __iid__) tuple that identifies this item; globally unique; primary key in DB
    __data__     = None         # MultiDict with values of object attributes; an attribute can have multiple values
    __created__  = None         # datetime when this item was created in DB; no timezone
    __updated__  = None         # datetime when this item was last updated in DB; no timezone
    __category__ = None         # instance of Category this item belongs to

    __handlers__ = None         # dict {handler_name: method} of all handlers (= public web methods) exposed by items of the current Item subclass

    @property
    def __cid__(self): return self.__id__[0]
    
    @property
    def __iid__(self): return self.__id__[1]
    
    # user-editable attributes & properties; can be missing in a particular item
    name         = None        # name of item; constraints on length and character set depend on category

    def __init__(self):
        self.__data__ = Data()

    def __getattribute__(self, name):
        
        # get special attributes from __dict__, not __data__
        if name[0] == '_':
            return object.__getattribute__(self, name)
        
        data = object.__getattribute__(self, '__data__')
        
        if MULTI_SUFFIX and name.endswith(MULTI_SUFFIX):
            listname = name[:-len(MULTI_SUFFIX)]
            return data.getlist(listname)
        
        if name in data:
            return data[name]
        
        # # TODO: search `name` in __category__'s default values
        # category = object.__getattribute__(self, '__category__')
        # if category:
        #     try:
        #         return category.get_default(name)
        #     except AttributeError:
        #         pass
        
        return object.__getattribute__(self, name)

    def __setattr__(self, name, value):
        
        # keep special attributes in __dict__, not __data__
        if name[0] == '_':
            object.__setattr__(self, name, value)
            return
        
        data = object.__getattribute__(self, '__data__')
        data[name] = value
        
    def __dir__(self):
        attrs = set(super().__dir__())
        attrs.update(self.__data__.keys())
        return attrs
        
    def __str__(self, max_len_name = 30):
        
        category = f'{self.__category__.name}' if self.__category__.name else f'CID({self.__cid__})'
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
        
        errors = []
        for attr, value in attrs.items():
            # validate `value`... (TODO)
            pass
        #if errors: raise InvalidValues(errors)
        
        item = cls()
        if _data is not None:
            item.__data__ = _data
            
        for attr, value in attrs.items():
            item.__data__[attr] = value
            
        return item
    
    @classmethod
    def __decode__(cls, record):
        """Creates an Item instance from an existing DB record."""
        
        # combine (cid,iid) to a single ID; drop the former
        record['__id__'] = (cid, iid) = (record['__cid__'], record['__iid__'])
        del record['__cid__']
        del record['__iid__']
        
        item = cls()

        for field, value in record.items():
            if value in (None, ''): continue
            setattr(item, field, value)
        
        # impute __category__; note the special case: the root Category item is a category for itself!
        cid, iid = item.__id__
        item.__category__ = item if (cid == iid == ROOT_CID) else Site.categories[cid]
        item._decode_data()
        
        item._post_load()
        #item.commit()
        
        return item

    def _post_load(self):
        """Override this method in subclasses to provide additional initialization/decoding when an item is retrieved from DB."""
        
    def _decode_data(self):
        """Convert __data__ from JSON string to a struct and then to object attributes."""
        
        if not self.__data__: return
        self.__data__ = Data.from_json(self.__data__, self.__category__.schema)
        
    def _assert(self, cond, message = ''):
        
        if cond: return
        print(f'WARNING in item {self.__id__}. {message}')

    def insert(self):
        """
        Insert this item as a new row in DB. Assign a new IID (self.__iid__) and return it.
        The item might have already been present in DB, but still a new copy is created.
        """
        self.__category__.insert(self)
        
    def update(self):
        """Update the contents of this item's row in DB."""
        self.__category__.update(self)

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
    _boot_store   = SimpleStore()   # data store used during startup
    _store        = None            # data store used for regular access to items of this category

    # public item attributes
    itemclass = Item    # an Item subclass that most fully implements functionality of this category's items and should be used when instantiating items loaded from DB
    schema    = None    # an instance of Schema containing a list of attributes allowed in this category and their Types
    
    def __init__(self):
        super().__init__()
        self._store = SimpleStore()
    
    @classmethod
    def __load__(cls, iid = None, name = None, itemclass = None):
        """Load from DB a Category object specified by category name, its class name, or IID."""
        
        record = cls._boot_store.load_category(iid, name, itemclass)
        return cls.__decode__(record)

    def _post_load(self):
        
        # find Python class that represents items of this category
        if isinstance(self.itemclass, str):
            if '.' in self.itemclass:
                path, classname = self.itemclass.rsplit('.', 1)
                module = importlib.import_module(path)
                self.itemclass = getattr(module, classname)
            else:
                self.itemclass = globals().get(self.itemclass)
        else:
            itemclass = globals().get(self.name)
            if itemclass and issubclass(itemclass, Item):
                self.itemclass = itemclass
            

    #####  Items in category  #####

    def load(self, iid):
        """Load from DB an item that belongs to the category represented by self."""
        
        record = self._store.load(self.__iid__, iid)
        return self.itemclass.__decode__(record)
        
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

    def insert(self, item):
        self._store.insert(item)
        
    def update(self, item):
        self._store.update(item)


    def __call__(self, *args, **kwargs):
        """Create a new item of this category through a direct function call. For web-based item creation, see the new() handler."""
        item = self.itemclass.__create__(*args, **kwargs)
        item.__id__ = (self.__iid__, None)
        item.__category__ = self
        return item

    @handler()
    def new(self, request):
        """Web handler that creates a new item of this category, based on `request` data."""
        
        data = Data()
        
        # retrieve attribute values from GET/POST
        # POST & GET internally store multi-valued parameters (lists of values for each parameter)
        for attr, values in request.POST.lists():
            data.set_values(attr, values)
        for attr, values in request.GET.lists():
            data.set_values(attr, values)

        item = self.__call__(data)
        item.save()
        return HttpResponse(html_escape(f"Item created: {item}"))
        
    @handler()
    def __view__(self, item, request):
        """
        Default handler invoked to render a response to item request when no handler name was given.
        Inside category's handlers dict, this method is saved under the None key.
        """
        

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
        
        root_category = Category.__load__(iid = ROOT_CID)       # root Category is a category for itself, hence its IID == CID
        self.cache = {"Category": root_category}
        
    def __getitem__(self, key):
        
        # try to get the item from cache
        category = self.cache.get(key)
        if category: return category
        
        iid = name = itemclass = None

        # not in cache? load from DB
        if isinstance(key, str):
            if '.' in key:  itemclass = key
            else:           name = key
        else:
            assert isinstance(key, int), key
            iid = key

        category = Category.__load__(iid = iid, name = name, itemclass = itemclass)
        
        # save in cache for later use
        self.cache[category.__iid__] = category

        assert category.name, key
        self.cache[category.name] = category

        # try:
        #     name = category.name
        # except AttributeError:
        #     name = None
        # if name:
        #     self.cache[category.name] = category

        return category 
    

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
    
    # schema = Schema(
    #     {
    #         'name': String,
    #         'app':  Type(Link, "An Application deployed in this Site"),
    #     },
    # )
    
    # item attributes...
    apps = None             # list of Applications
    
    # internal variables
    categories = None       # flat collection of all categories found in DB, as a class-global singleton instance of Categories; after boot(), it can be accessed as Site.categories
    descriptors = None      # {app-space-category descriptor: Category}

    @classmethod
    def boot(cls):
        """Create initial global Site object with attributes loaded from DB. Called once during startup."""
        
        categories = cls.categories = Categories()   
        Site = categories['Site']
        root = cls.root = Site.first_item()
        return root

    def _post_load(self):

        self._init_apps()
        self._init_descriptors()
               
    def _init_apps(self):
        """Convert IIDs of apps to Application objects."""
        
        Application = self.categories['Application']
        self.apps = [Application.load(iid) for iid in self.apps]
        
    def _init_descriptors(self):
        """Initialize self.descriptors based on self.apps."""

        Space = self.categories['Space']
        Category = self.categories['Category']
        
        self.descriptors = {}
        
        for app in self.apps:
            for space_name, space_iid in app.spaces.items():
                if not self.re_codename.match(space_name): raise InvalidName(f'Invalid code name "{space_name}" of a space with IID={space_iid}')
                space = Space.load(space_iid)
                
                for category_name, category_iid in space.categories.items():
                    if not self.re_codename.match(category_name): raise InvalidName(f'Invalid code name "{category_name}" of a category with IID={category_iid}')
                    category = Category.load(category_iid)
                    
                    descriptor = f"{space_name}.{category_name}"
                    self.descriptors[descriptor] = category
        
    
    def load(self, descriptor, app = None):
        
        qualifier, iid = descriptor.split(':')
        category = self.descriptors[qualifier]
        return category.load(int(iid))
        
        
