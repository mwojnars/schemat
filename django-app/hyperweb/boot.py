### UNUSED...

from django.core.signals import request_finished
from django.dispatch import receiver

from .core.root import registry


#####################################################################################################################################################
#####
#####  GLOBAL REGISTRY
#####

seed_items = True

if seed_items:                                          # create core items and store in DB
    from .core.boot import core_items
    registry.seed(core_items)
else:                                                   # load core items from DB
    registry.boot()


#####################################################################################################################################################

# connect the after_request() method of `registry` with Django
@receiver(request_finished)
def after_request(sender, **kwargs):
    registry.after_request(sender, **kwargs)
    registry.stop_request()
