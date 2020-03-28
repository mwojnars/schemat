"""
"""

import json
from django.db import connection as db


#####################################################################################################################################################
#####
#####  UTILITIES
#####

class ObjectDoesNotExist(Exception):
    """The requested object does not exist in DB."""
    
    item_class = None
    

#####################################################################################################################################################
#####
#####  BOOTSTRAP
#####

class Bootstrap:
    """
    Bootstrap only handles requests for core items (meta.*).
    """
    #def get_queryset(self):
    #   return ItemQuerySet(model=self.model, using=self._db, hints=self._hints)

    _category_cid = 0           # predefined CID of items that represent categories
    
    cid      = {"Category": _category_cid}      # dict of CID values for core categories: Category, Site, Application, Space, ... Initialized during __init__.
    category = {}                               # dict of Category instances for core categories, indexed by both names and CIDs
    
    site = None                 # the singleton Site instance, contains configuration for the site
    app  = None                 # the first Application instance for this site
    
    
    _columns      = 'cid iid data created updated'.split()
    _select_cols  = ','.join(_columns)
    _select       = f"SELECT {_select_cols} FROM hyper_items "
    _select_id    = _select + "WHERE cid = %s AND iid = %s"

    def __init__(self):
        
        # create name->CID, name->Category() and CID->Category() mappings for core categories
        for name in ["Category", "Site", "Application", "Space"]:
            self.category[name] = cat = self.get_category(name = name)  #Category.objects.get(name = name)
            self.cid[name] = cid = cat.__iid__
            self.category[cid] = cat
        
        # load Site and Application
        self.site = self.all_in_category("Site")[0]
        self.app  = self.get_item("Application", self.site.apps[0], item_class = Application)
        

    @classmethod
    def get_category(cls, iid = None, name = None):
        """
        Retrieve from DB a Category object specified by category name or IID.
        """
        cond = f"JSON_UNQUOTE(JSON_EXTRACT(data,'$.name')) = %s" if name else f"iid = %s"
        
        query = f"SELECT {cls._select_cols} FROM hyper_items WHERE cid = {cls.cid['Category']} AND {cond}"
        
        with db.cursor() as cur:
            cur.execute(query, [name or iid])
            return Category.from_row(cur.fetchone(), query_args = name or iid)
        
    def get_item(self, *args, item_class = None):
        """`args` contain `cid` and `iid`, given either as separate arguments (cid, iid), or a single 2-tuple argument (id)."""
        
        cid, iid = args if len(args) == 2 else args[0]
        
        if isinstance(cid, str):
            cid = self.cid[cid]
        item_class = item_class or Item

        # select row from DB and convert to record (dict with field names)
        with db.cursor() as cur:
            cur.execute(self._select_id, (cid, iid))
            return item_class.from_row(cur.fetchone(), query_args = (cid, iid))
        
    def all_in_category(self, cid, item_class = None):
        
        if isinstance(cid, str):
            name = cid
            cid = self.cid[name]
        else:
            name = None
            
        if item_class is None and cid in self.category:
            item_class = self.category[cid].__itemclass__
        item_class = item_class or Item
            
        query = self._select + f"WHERE cid = {cid} ORDER BY iid"
        with db.cursor() as cur:
            cur.execute(query)
            return [item_class.from_row(row) for row in cur.fetchall()]

    def get_categories(self):
        """
        Retrieve all category items from DB and return as a list of Category objects.
        These are all items with CID = cid["Category"].
        """
        return self.all_in_category("Category") #, Category)
        

#####################################################################################################################################################
#####
#####  ITEMS manager
#####

class Items:
    
    _columns      = 'cid iid data created updated'.split()
    _select_cols  = ','.join(_columns)
    
    def __init__(self, qualifier = None):
        self.qualifier = qualifier              # default space.category qualifier; if present, items can be retrieved by IID alone
    
    def get(self, iid = None, qualifier = None):
        """`qualifier` is an optional space.category string."""
        
        qualifier = qualifier or self.qualifier
        space, category = qualifier.split('.')
        
        # category retrieved from the application object
        cat = app.get_category(space, category)
        if not cat: return None
    
        return boot.get_item(cat.__iid__, int(iid))


class Categories(Items):
    
    cache = {}          # cached instances of Category items; indexed by space:name, as well as IID
    
    def get(self, iid = None, name = None):
        """
        Retrieve from DB a Category object specified by category name or IID.
        """
        cond = f"JSON_UNQUOTE(JSON_EXTRACT(data,'$.name')) = %s" if name else f"iid = %s"
        
        query = f"SELECT {self._select_cols} FROM hyper_items WHERE cid = {self.cid['Category']} AND {cond}"
        
        with db.cursor() as cur:
            cur.execute(query, [name or iid])
            return Category.from_row(cur.fetchone(), query_args = name or iid)
        

    
#####################################################################################################################################################
#####
#####  ITEM & META space
#####

class MetaItem(type):
    
    def __init__(cls, name, bases, dct):
        
        class DoesNotExist(ObjectDoesNotExist):
            item_class = cls
    
        cls.DoesNotExist = DoesNotExist
        cls.objects = Items()
        
    
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
    
    def __init__(self, **kwargs):        
        self.__set__(**kwargs)
        
    def __set__(self, **kwargs):

        for field, value in kwargs.items():
            if value in (None, ''): continue
            setattr(self, field, value)
    
        self._decode_data()
        
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


    @classmethod
    def from_row(cls, row, query_args = None):

        if row is None:
            ExClass = cls.DoesNotExist
            raise ExClass if query_args is None else ExClass(str(query_args))
        
        record = {f'__{key}__': val for key, val in zip(Items._columns, row)}
        
        # combine (cid,iid) to a single ID; drop the former
        record['__id__'] = (cid, iid) = (record['__cid__'], record['__iid__'])
        del record['__cid__']
        del record['__iid__']
        
        item = cls(**record)
        
        # impute __category__
        if cid == iid == Bootstrap.cid["Category"]:         # special case: the Category item is a category for itself
            item.__category__ = item
        else:
            item.__category__ = Bootstrap.category.get(cid) or Bootstrap.get_category(cid)
        
        return item


class Category(Item):

    __itemclass__ = Item        # an Item subclass that most fully implements functionality of this category's items and should be used when instantiating items loaded from DB
    
    items = None                # manager that retrieves from DB items of this category
    
    @classmethod
    def from_row(cls, row, query_args = None):
        
        item = super().from_row(row, query_args)
        
        name = item.__data__.get('name')            # 'name' attribute should exist for all categories
        if name in vars():
            item.__itemclass__ = vars()[name]
        
        return item
        

#####################################################################################################################################################
#####
#####  SYSTEM space
#####

class Site(Item):
    """
    """
    apps = None
    

class Application(Item):
    """
    """
    spaces = None
    
    def get_item(self, qualifier, iid):
        
        return
    
    def get_category(self, space, category):
        
        iid = self.spaces.get(space)
        space = boot.get_item("Space", iid, item_class = Space)
        # space = Space.objects.get(iid)
        if space is None: return None
    
        return space.get_category(category)

        
class Space(Item):
    """
    """
    categories = None
    
    def get_category(self, category):

        cat_iid  = self.categories.get(category)
        cat_item = boot.get_item("Category", cat_iid, item_class = Category)
        if cat_item is None: return None
        
        return cat_item
        
    
class Mapping(Item):
    """
    """


#####################################################################################################################################################
#####
#####  GLOBALS
#####

ObjectDoesNotExist.item_class = Item

boot = Bootstrap()
app  = boot.app

