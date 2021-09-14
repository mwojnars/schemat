### UNUSED...

from django.http import HttpRequest, HttpResponse
from django.core.signals import request_finished
from django.dispatch import receiver

from .registry import Registry
from .core import core_items


#####################################################################################################################################################
#####
#####  GLOBALS
#####

@receiver(request_finished)
def after_request(sender, **kwargs):
    site = get_registry().site
    site.after_request(sender, **kwargs)
    # print(f'after_request() in thread {threading.get_ident()} start...')
    # sleep(5)
    # print(f'after_request() in thread {threading.get_ident()} ...stop')

# print(f'main thread {threading.get_ident()}')


#####################################################################################################################################################

# registry = Registry()
# registry.seed(core_items)
# # registry.boot()

# root = registry.get_item((0,0))
# site = registry.get_site()
# print("Category.schema: ", root.schema.dump_json())
# print("Site.schema:     ", Field._json.dumps(site.category.schema))

#####################################################################################################################################################

# registry = None         # will be initialized on the first web request thru get_registry() below


def get_registry():
    # global registry
    # if registry is None:
    #     registry = Registry()
    #     registry.seed(core_items)
    #     # registry.boot()
    return registry

registry = Registry()
registry.seed(core_items)
# registry.boot()

