### UNUSED...

from django.core.signals import request_finished
from django.dispatch import receiver

from .registry import Registry


#####################################################################################################################################################
#####
#####  GLOBAL REGISTRY
#####

registry = Registry()
registry.init_classpath()

# create or load core items
from .core.boot import core_items
registry.seed(core_items)     #registry.boot()

# connect the after_request() method of `registry` with Django
@receiver(request_finished)
def after_request(sender, **kwargs):
    registry.after_request(sender, **kwargs)
    registry.stop_request()
