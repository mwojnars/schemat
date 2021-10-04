import sys
from django.core.signals import request_finished
from django.dispatch import receiver

from .core.root import registry


#####################################################################################################################################################
#####
#####  GLOBAL INITIALIZATION
#####

def seed():
    """Create core items and store in DB. All existing items in DB are removed!!!"""
    print("Starting full RESET of items, core items will be created anew")
    from .core.items import catalog_wiki            # this creates all items and puts them in the registry's staging area
    registry.commit(ttl = 0, protect = True)        # this inserts items to DB and assigns IDs
    registry.set_site(catalog_wiki)

def boot():
    """Load core items from DB. Don't remove/overwrite any existing items."""
    registry.boot()

#####################################################################################################################################################

# db_reset = ('--db-reset' in sys.argv)
db_reset = True

if db_reset:    seed()
else:           boot()

print("registry initialized:", registry, flush = True)


#####################################################################################################################################################

# connect the after_request() method of `registry` with Django
@receiver(request_finished)
def after_request(sender, **kwargs):
    registry.after_request(sender, **kwargs)
    registry.stop_request()
