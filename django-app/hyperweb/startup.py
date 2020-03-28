import re, json
from django.db import connection as db

#####################################################################################################################################################

class ItemDoesNotExist(Exception):
    """The requested object does not exist in DB."""
    item_class = None

class InvalidName(Exception): pass


class onchange:
    """Decorator that marks a given Item method as depending on a given set (tuple) of trigger attributes."""
    def __init__(self, *triggers):
        self.triggers = set(triggers)
        
    def __call__(self, method):
        method.triggers = self.triggers
        return method
    

class SQL:
    
    _item_columns       = 'cid iid data created updated'.split()
    _item_select_cols   = ','.join(_item_columns)
    _item_select        = f"SELECT {_item_select_cols} FROM hyper_items "
    _item_select_by_id  = _item_select + "WHERE cid = %s AND iid = %s"
    

#####################################################################################################################################################

class MetaItem(type):
    
    def __init__(cls, name, bases, dct):
        
        class DoesNotExist(ItemDoesNotExist):
            item_class = cls
    
        cls.DoesNotExist = DoesNotExist
        

class Item(object, metaclass = MetaItem):
    
    # item fields & properties...
    __id__       = None         # (__cid__, __iid__) tuple that identifies this item; globally unique; primary key in DB
    __data__     = None         # raw data before/after conversion to/from object attributes, as a list of (attr-name, value) pairs
    __created__  = None         # datetime when this item was created in DB; no timezone
    __updated__  = None         # datetime when this item was last updated in DB; no timezone
    __category__ = None         # instance of Category this item belongs to
        
    @property
    def __cid__(self): return self.__id__[0]
    
    @property
    def __iid__(self): return self.__id__[1]
    
    # class-level functionality...
    
    def __init__(self):        
        self.__changed__ = set()
        
    @classmethod
    def __load__(cls, row, query_args = None):
        """Like __init__, but creates Item instance from an existing DB row."""
        
        if row is None: raise cls.DoesNotExist(*((query_args,) if query_args is not None else ()))
        
        record = {f'__{key}__': val for key, val in zip(SQL._item_columns, row)}
        
        # combine (cid,iid) to a single ID; drop the former
        record['__id__'] = (cid, iid) = (record['__cid__'], record['__iid__'])
        del record['__cid__']
        del record['__iid__']
        
        item = cls()

        for field, value in record.items():
            if value in (None, ''): continue
            setattr(item, field, value)
        
        item._post_load()
        #self._commit()
        
        return item


    def _post_load(self):

        # impute __category__; note the special case: the root Category item is a category for itself!
        cid, iid = self.__id__
        self.__category__ = self if (cid == iid == Categories.CID) else Site.categories[cid]

        self._decode_data()
        
        
    @onchange('__data__')
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


    ### propagation of attribute value changes, to compute derived attributes and perform conditional actions
    
    __changed__  = None     # set of attrs assigned since the last _commit(); does NOT include structural attributes if only their nested elements have changed; includes non-modifying assignments
    __actions__  = None     # list of action methods, i.e., those annotated with @onchange; filled out by metaclass based on method annotations added by @onchange decorator
    __incommit__ = False    # flag to prevent multiple _commit() being executed one inside another
    
    def __setattr__(self, name, value):
        
        if name != '__changed__': self.__changed__.add(name)
        object.__setattr__(self, name, value)
    
    def _commit(self, max_iter = None):
        """Internal commit that marks the end of attribute changes and triggers propagation of values to other (derived) attrs & actions."""
        
        if self.__incommit__: return
        self.__incommit__ = True
        iteration = 0
        
        # propagation
        while True:
            if not self.__changed__ or None != max_iter <= iteration: break
            changed = self.__changed__
            self.__changed__ = set()
            
            for action in self.__actions__:
                triggers = action.triggers
                if not triggers or (triggers & changed):        # call action() if at least 1 attribute it depends on has changed; or there are no triggers defined (= any change triggers the action)
                    action()
            iteration += 1
        
        self.__incommit__ = False
        

ItemDoesNotExist.item_class = Item

        
#####################################################################################################################################################

class Items:

    category = None         # instance of Category this Items manager belongs to

    def __init__(self, category):
        self.category = category

    def all(self, limit = None):
        pass
    
    def first(self):
        return self.all(limit = 1)[0]
    

class Category(Item):

    __itemclass__ = Item        # an Item subclass that most fully implements functionality of this category's items and should be used when instantiating items loaded from DB

    def _post_load(self):

        super()._post_load()
        
        # find Python class that represents items of this category
        name = self.__data__.get('name')            # 'name' attribute should exist in all category items
        itemclass = globals().get(name)
        if itemclass and issubclass(itemclass, Item):
            self.__itemclass__ = itemclass

    @classmethod
    def __load__(cls, row = None, iid = None, name = None, query_args = None):
        """Load from DB a Category object specified by category name or IID."""
        
        if row is not None: return super().__load__(row, query_args = query_args)
        
        cond  = f"JSON_UNQUOTE(JSON_EXTRACT(data,'$.name')) = %s" if name else f"iid = %s"
        query = f"SELECT {SQL._item_select_cols} FROM hyper_items WHERE cid = {Categories.CID} AND {cond}"
        arg   = [name or iid]
        
        with db.cursor() as cur:
            cur.execute(query, arg)
            row = cur.fetchone()
            return cls.__load__(row, query_args = arg)

    def get_item(self, iid):
        """Load from DB an item that belongs to the category represented by self."""
        
        id = (self.__iid__, iid)
        
        # select row from DB and convert to record (dict with field names)
        with db.cursor() as cur:
            cur.execute(SQL._item_select_by_id, id)
            row = cur.fetchone()
            return self.__itemclass__.__load__(row, query_args = id)
    
    def all_items(self, limit = None):
        
        query = SQL._item_select + f"WHERE cid = {self.__iid__} ORDER BY iid"
        if limit is not None:
            query += f" LIMIT {limit}"
            
        with db.cursor() as cur:
            cur.execute(query)
            return [self.__itemclass__.__load__(row) for row in cur.fetchall()]        
    
    def first_item(self):
        
        items = self.all_items(limit = 1)
        if not items: raise self.__itemclass__.DoesNotExist()
        return items[0]


#####################################################################################################################################################

class Categories:
    """
    Flat collection of all categories found in DB, accessible by their names and CIDs (category's IID). Provides caching.
    """    
    CID = 0             # predefined CID of items that represent categories

    cache = None
    
    def __init__(self):
        
        root_category = Category.__load__(iid = self.CID)           # root Category is a category for itself, hence its IID == CID
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

        category = Category.__load__(iid = iid, name = name)
        
        # save in cache for later use
        self.cache[category.__iid__] = category
        if hasattr(category, 'name'):
            self.cache[category.name] = category
        
        return category 
    
        
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

        super()._post_load()
        self._init_apps()
        self._init_descriptors()
               
    def _init_apps(self):
        """Convert IIDs of apps to Application objects."""
        
        Application = self.categories['Application']
        self.apps = [Application.get_item(iid) for iid in self.apps]
        
    def _init_descriptors(self):
        """Initialize self.descriptors based on self.apps."""

        Space = self.categories['Space']
        Category = self.categories['Category']
        
        self.descriptors = {}
        
        for app in self.apps:
            for space_name, space_iid in app.spaces.items():
                if not self.re_codename.match(space_name): raise InvalidName(f'Invalid code name "{space_name}" of a space with IID={space_iid}')
                space = Space.get_item(space_iid)
                
                for category_name, category_iid in space.categories.items():
                    if not self.re_codename.match(category_name): raise InvalidName(f'Invalid code name "{category_name}" of a category with IID={category_iid}')
                    category = Category.get_item(category_iid)
                    
                    descriptor = f"{space_name}.{category_name}"
                    self.descriptors[descriptor] = category
        
    
    def load(self, descriptor, app = None):
        
        qualifier, iid = descriptor.split(':')
        category = self.descriptors[qualifier]
        return category.get_item(int(iid))
        
        
#####################################################################################################################################################
#####
#####  GLOBALS
#####

site = Site.boot()

