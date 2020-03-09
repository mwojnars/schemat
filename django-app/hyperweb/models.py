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
        
        
class ItemManager(models.Manager):
    """
    """
    #def get_queryset(self):
    #   return ItemQuerySet(model=self.model, using=self._db, hints=self._hints)

    _item_columns      = 'cid iid data created updated'.split()
    _item_select_cols  = ','.join(_item_columns)
    _item_select       = f"SELECT {_item_select_cols} FROM hyper_items WHERE cid = %s AND iid = %s"

    def get(self, *args):
        """
        `args` contain `cid` and `iid`, given either as separate arguments (cid, iid), or a single 2-tuple argument (id).
        """
        cid, iid = args if len(args) == 2 else args[0]

        # select row from DB and convert to record (dict with field names)
        cur = db.cursor()
        cur.execute(self._item_select, (cid, iid))
        
        values = cur.fetchone()
        record = {f'__{key}__': val for key, val in zip(self._item_columns, values)}
        
        # combine (cid,iid) to a single ID; drop the former
        record['__id__'] = (record['__cid__'], record['__iid__'])
        del record['__cid__']
        del record['__iid__']
        
        return Item(**record)
   
    
class Item:
    
    # item fields & properties...
    
    __id__      = None      # (__cid__, __iid__) tuple that identifies this item; globally unique; primary key in DB
    __data__    = None      # raw data before/after conversion to/from object attributes, as a list of (attr-name, value) pairs
    __created__ = None      # datetime when this item was created in DB; no timezone
    __updated__ = None      # datetime when this item was last updated in DB; no timezone
    
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
    
        if self.__data__: self.__data__ = json.loads(self.__data__)
    


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


class Category(ItemType):
    """
    """
    
