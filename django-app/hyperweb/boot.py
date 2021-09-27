from django.core.signals import request_finished
from django.dispatch import receiver

from .core.root import registry


#####################################################################################################################################################
#####
#####  GLOBAL REGISTRY
#####

seed_items = True

if seed_items:
    # create core items and store in DB
    from .core.items import *                       # this creates all items and puts them in the registry's staging area
    registry.commit(ttl = 0, protect = True)        # this inserts items to DB and assigns IDs
    registry.set_site(catalog_wiki)
    
    # from .core.boot import core_items
    # registry.seed(core_items)

else:
    # load core items from DB
    registry.boot()

print("registry initialized:", registry, flush = True)


#####################################################################################################################################################

# connect the after_request() method of `registry` with Django
@receiver(request_finished)
def after_request(sender, **kwargs):
    registry.after_request(sender, **kwargs)
    registry.stop_request()
