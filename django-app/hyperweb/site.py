from django.http import HttpRequest, HttpResponse
from django.core.signals import request_finished
from django.dispatch import receiver

from .registry import Registry


#####################################################################################################################################################
#####
#####  GLOBALS
#####

@receiver(request_finished)
def after_request(sender, **kwargs):
    site = registry.get_site()
    site.after_request(sender, **kwargs)
    # print(f'after_request() in thread {threading.get_ident()} start...')
    # sleep(5)
    # print(f'after_request() in thread {threading.get_ident()} ...stop')

# print(f'main thread {threading.get_ident()}')


#####################################################################################################################################################

registry = Registry()
registry.bootstrap()

# print('root:', root)
# print('root.schema:', root.schema.fields)

# root = registry.get_item((0,0))
# site = registry.get_site()
#
# print("Category.schema: ", root.schema.to_json())
# print("Site.schema:     ", Field._json.dumps(site.category.schema))

