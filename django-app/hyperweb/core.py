import re, json, importlib
from django.http import HttpRequest, HttpResponse

from .config import ROOT_CID
from .data import DataObject, onchange
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
        

class Item(DataObject, metaclass = MetaItem):
    
    # builtin attributes & properties, not user-editable ...
    __id__       = None         # (__cid__, __iid__) tuple that identifies this item; globally unique; primary key in DB
    __data__     = None         # raw data before/after conversion to/from object attributes, as a list of (attr-name, value) pairs
    __created__  = None         # datetime when this item was created in DB; no timezone
    __updated__  = None         # datetime when this item was last updated in DB; no timezone
    __category__ = None         # instance of Category this item belongs to

    @property
    def __cid__(self): return self.__id__[0]
    
    @property
    def __iid__(self): return self.__id__[1]
    
    # user-editable attributes & properties; can be missing in a particular item
    name         = None        # name of item; constraints on length and character set depend on category

        
    def __str__(self, max_len_name = 30):
        
        category = f'{self.__category__.name}' if self.__category__.name else f'CID({self.__cid__})'
        name     = f' {self.name}' if self.name is not None else ''
        if len(name) > max_len_name:
            name = name[:max_len_name-3] + '...'
        
        return f'<{category}:{self.__iid__}{name}>'
        
    
    @classmethod
    def __create__(cls, **attrs):
        """Create a new item with `attrs` attribute values, typically passed from a web form."""
        
        errors = []
        for attr, value in attrs.items():
            # validate `value`... (TODO)
            pass
        #if errors: raise InvalidValues(errors)
        
        item = cls()
        for attr, value in attrs.items():
            setattr(item, attr, value)
        return item
    
    @classmethod
    def __load__(cls, record):
        """Like __init__, but creates Item instance from an existing DB row."""
        
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
        data = self.__data__ = json.loads(self.__data__)
        
        if isinstance(data, dict):
            self.__dict__.update(data)
    
        elif isinstance(data, list):
            for entry in data:
                if not self._assert(isinstance(entry, list), f'Incorrect data format, expected list: {entry}'): continue
                if not self._assert(len(entry) == 2, f'Incorrect data format, expected 2-element list: {entry}'): continue
                attr, value = entry
                setattr(self, attr, value)
                
        else:
            self._assert(False, f'Incorrect data format, expected list or dict: {data}')
            
            
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
        hdl = self.__category__.__handlers__.get(handler, None)
        if hdl is None: raise InvalidHandler(f'Handler {handler} not found in {self.__category__}')
        return hdl(self, request)
        

ItemDoesNotExist.item_class = Item

        
#####################################################################################################################################################
#####
#####  CATEGORY
#####

class Items:

    category = None         # parent category this Items manager belongs to, as an instance of Category

    def __init__(self, category):
        self.category = category

    def all(self, limit = None):
        return self.category.all_items(limit)
    
    def first(self):
        return self.category.first_item()
    
    def new(self, *args, **kwargs):
        return self.category.new(*args, **kwargs)
    

class Category(Item):
    """
    A category serves as a class for items: defines their schema and functionality; but also as a manager that controls access to 
    and creation of new items within category.
    """

    __name__      = None        # code name of this category
    __itemclass__ = Item        # an Item subclass that most fully implements functionality of this category's items and should be used when instantiating items loaded from DB
    __handlers__  = None        # dict {handler_name: method} of all handlers (= public web methods) exposed by items of this category
    
    itemclass = Item
    
    bootstore = SimpleStore()   # data store to be used during startup
    store     = None            # data store to be used for items of this category, for regular access
    
    def __init__(self):
        super().__init__()
        self.store = SimpleStore()
        self.items = Items(self)
    
    @classmethod
    def __load__(cls, record = None, iid = None, name = None, itemclass = None):
        """Load from DB a Category object specified by category name, its class name, or IID."""
        
        if record is not None: return super().__load__(record)
        
        record = cls.bootstore.load_category(iid, name, itemclass)
        return cls.__load__(record)


    def _post_load(self):
        
        # find Python class that represents items of this category
        if isinstance(self.itemclass, str):
            if '.' in self.itemclass:
                path, classname = self.itemclass.rsplit('.', 1)
                module = importlib.import_module(path)
                self.__itemclass__ = getattr(module, classname)
            else:
                self.__itemclass__ = globals().get(self.itemclass)
        else:
            itemclass = globals().get(self.name)
            if itemclass and issubclass(itemclass, Item):
                self.__itemclass__ = itemclass
            
        # fill out the dict of handlers
        self.__handlers__ = {}
        for method in dir(self.__itemclass__):
            if callable(method) and hasattr(method, 'handler') and isinstance(method.handler, handler):
                name = method.handler.name
                if name in self.__handlers__:
                    raise DuplicateHandler(f'Duplicate name of a web handler, "{name}", in {self}')
                bound_method = method.__get__(self, Category)       # binding method to `self`
                self.__handlers__[name] = bound_method


    #####  Items in category  #####

    def load(self, iid):
        """Load from DB an item that belongs to the category represented by self."""
        
        record = self.store.load(self.__iid__, iid)
        return self.__itemclass__.__load__(record)
        
    def all_items(self, limit = None):
        """
        Load all items of this category, ordered by IID, optionally limited to max. `limit` items with lowest IID.
        Return an iterable, but not a list.
        """
        records = self.store.load_all(self.__iid__, limit)
        return map(self.__itemclass__.__load__, records)
        
    def first_item(self):
        
        items = list(self.all_items(limit = 1))
        if not items: raise self.__itemclass__.DoesNotExist()
        return items[0]

    def insert(self, item):
        self.store.insert(item)
        
    def update(self, item):
        self.store.update(item)


    def __call__(self, *args, **kwargs):
        """Create a new item of this category through a direct function call. For web-based item creation, see the new() handler."""
        return self.__itemclass__.__create__(*args, **kwargs)

    @handler
    def new(self, category_item, request):
        """Web handler that creates a new item of the category represented by `category_item`, based on `request` data."""
        
        # translate `request` into `args` / `kwargs`
        item = self.__call__() #*args, **kwargs)
        item.save()
        return f"Item created: {item}"
        
    @handler
    def __view__(self, item, request):
        """
        Default handler invoked to render a response to item request when no handler name was given.
        In category's __handlers__ dict, this method is saved under the None key.
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
        
        root_category = Category.__load__(iid = ROOT_CID)           # root Category is a category for itself, hence its IID == CID
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
        if hasattr(category, 'name'):
            self.cache[category.name] = category
        
        return category 
    

class Application(Item):
    pass

class Space(Item):
    pass
        
class Site(Item):
    
    re_codename = re.compile(r'^[a-zA-Z][a-zA-Z0-9_-]*$')         # valid codename of a space or category
    
    root = None             # the global Site object created during boot()
    
    apps = None             # list of Applications
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
        
        
#####################################################################################################################################################
#####
#####  GLOBALS
#####

site = Site.boot()

