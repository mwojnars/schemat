from django.db import models
from django.db.models import BigIntegerField, DateTimeField
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
    def get_queryset(self):
       return ItemQuerySet(model=self.model, using=self._db, hints=self._hints)
   
    
#####################################################################################################################################################

class Item(Model):
    """
    Do NOT inherit from this class. Use ItemType as a base class instead whenever you need to create a specialized item class.
    
    Fields:
    - id (8 bytes) is composed of two parts: <2 upper bytes> encode the space-category ID, while <6 lower bytes> encode item ID within its category
    """
    objects = ItemManager()

    #####

    id = PositiveBigIntegerField(primary_key = True)         # no auto-increment! we need to increment manually to properly encode category ID inside
    
    #__data__ = JSONField(null = False)
    
    #__created__ = TimestampField(auto_now_add = True)
    #__updated__ = TimestampField(auto_now = True)            # only changed when __data__ change (not __stats__)
    
    #####
    
    def save(self, _all_fields = ['id', '__data__'], **kwargs):
        
        # ensure that __created__ and __updated__ fields are excluded from update - they should be set by DB not Django
        # WARNING: this enforces UPDATE even when an INSERT is requested ????
        update_fields = kwargs.pop('update_fields', _all_fields)
        
        super().save(update_fields = update_fields, **kwarg)
    

class ItemType(Item):
    """
    Subclass this class instead of Item whenever you need to create a new specialized item class.
    """

    class Meta:
        proxy = True            # to avoid creating a new table by Django for every subclass


class Category(ItemType):
    """
    """
    
