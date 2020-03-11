import json

from django.db import models, connection as db
from django.db.models import CharField, DateTimeField, BigIntegerField, PositiveSmallIntegerField
from django_mysql.models import Model, JSONField

from .forcedfields import TimestampField


#####################################################################################################################################################

class PositiveBigIntegerField(BigIntegerField):
    
    description = "Big (8 byte) positive integer"
    MAX_POSBIGINT = 18446744073709551615
    
    #def get_internal_type(self):
        #return "PositiveBigIntegerField"

    def db_type(self, connection):
        """
        Returns MySQL-specific column data type. Make additional checks
        to support other backends.
        """
        return 'BIGINT UNSIGNED'

    def formfield(self, **kwargs):
        defaults = {'min_value': 0,
                    'max_value': MAX_POSBIGINT}
        defaults.update(kwargs)
        return super(PositiveBigIntegerField, self).formfield(**defaults)


#####################################################################################################################################################

class ItemQuerySet(models.QuerySet):
    """
    """
    def delete(self, **kwargs):
        super().delete(**kwargs)
        
        
def fetchall(cursor):
    """Return all rows from a cursor as a dict"""
    columns = [col[0] for col in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]

        
class ItemManager(models.Manager):
    """
    """
    #def get_queryset(self):
    #   return ItemQuerySet(model=self.model, using=self._db, hints=self._hints)

    _category_cid = 0       # CID of items that represent categories
    
    
    _item_columns      = 'cid iid data created updated'.split()
    _item_select_cols  = ','.join(_item_columns)
    _item_select       = f"SELECT {_item_select_cols} FROM hyper_items WHERE cid = %s AND iid = %s"

    def get(self, *args):
        """
        `args` contain `cid` and `iid`, given either as separate arguments (cid, iid), or a single 2-tuple argument (id).
        """
        cid, iid = args if len(args) == 2 else args[0]
        
        if isinstance(cid, str):
            cid = self.category_by_name(cid)

        # select row from DB and convert to record (dict with field names)
        with db.cursor() as cur:
            cur.execute(self._item_select, (cid, iid))
            return self._as_object(cur.fetchone())
        
        
    def _as_object(self, item_row, item_class = None, columns = _item_columns):
        
        if item_row is None: return None
        
        record = {f'__{key}__': val for key, val in zip(columns, item_row)}
        
        # combine (cid,iid) to a single ID; drop the former
        record['__id__'] = (cid, iid) = (record['__cid__'], record['__iid__'])
        del record['__cid__']
        del record['__iid__']
        
        item_class = item_class or Item 
        item = item_class(**record)
        
        # impute __category__
        if cid == iid == self._category_cid:        # special case: the Category item is a category for itself
            item.__category__ = item
        else:
            item.__category__ = self.get_category(cid)
        
        return item
   
   
    def get_category(self, iid = None, name = None):
        """
        Retrieve from DB a Category object specified by category name or IID.
        Important: `name` should be all lower-case, otherwise it won't match!
        """
        cond = f"LOWER(JSON_UNQUOTE(JSON_EXTRACT(data,'$.name'))) = %s" if name else f"iid = %s"
        
        query = f"SELECT {self._item_select_cols} FROM hyper_items WHERE cid = {self._category_cid} AND {cond}"
        
        with db.cursor() as cur:
            cur.execute(query, [name or iid])
            return self._as_object(cur.fetchone(), Category)
        
        
    def _list_categories(self):
        """Retrieve all category items from DB and return as a list of Category objects."""
        
        # select category items from DB, these are all items having CID = _category_cid value
        with db.cursor() as cur:
            cur.execute(f"SELECT {self._item_select_cols} FROM hyper_items WHERE cid = {self._category_cid}")
            return [self._as_object(row, Category) for row in cur.fetchall()]
    
    
class Item:
    
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
    
    objects = ItemManager()
    
    def __init__(self, **kwargs):

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


class Category(Item):
    """
    """
    

#####################################################################################################################################################

class Item_Django(Model):
    """
    Do NOT inherit from this class. Use ItemType as a base class instead whenever you need to create a specialized item class.
    """

    gid = CharField(max_length = 50, primary_key = True)      # artificial unique PK created as a string "{cid}:{iid}" that represents (cid,iid) tuple
    
    cid = PositiveBigIntegerField()
    iid = PositiveBigIntegerField()
    data = JSONField(null = False)

    #id = PositiveBigIntegerField(primary_key = True)         # no auto-increment! we need to increment manually to properly encode category ID inside
    
    #__data__ = JSONField(null = False)
    
    #__created__ = TimestampField(auto_now_add = True)
    #__updated__ = TimestampField(auto_now = True)            # only changed when __data__ change (not __stats__)
    
    #####
    
    #def save(self, _all_fields = ['id', '__data__'], **kwargs):
    #    
    #    # ensure that __created__ and __updated__ fields are excluded from update - they should be set by DB not Django
    #    # WARNING: this enforces UPDATE even when an INSERT is requested ????
    #    update_fields = kwargs.pop('update_fields', _all_fields)
    #    
    #    super().save(update_fields = update_fields, **kwarg)
    

class ItemType(Item_Django):
    """
    Subclass this class instead of Item whenever you need to create a new specialized item class.
    """

    class Meta:
        proxy = True            # to avoid creating a new table by Django for every subclass


