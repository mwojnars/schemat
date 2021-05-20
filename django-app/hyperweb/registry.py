import threading

from .config import ROOT_CID, SITE_ID
from .cache import LRUCache
from .item import RootCategory


#####################################################################################################################################################
#####
#####  REGISTRY
#####

class Registry:
    """
    A registry of Item instances recently created or loaded from DB during current web request or previous ones.
    Registry makes sure there are no two different Item instances for the same item ID (no duplicates).
    When request processing wants to access or create an item, this must always be done through Site.get_item(),
    so that the item is checked in the Registry and taken from there if it already exists.
    De-duplication improves performance thanks to avoiding repeated json-decoding of the same item records.
    This is particularly important for Category items which are typically accessed multiple times during a single web request.
    WARNING: some duplicate items can still exist and be hanging around as references from other items - due to cache flushing,
    which removes items from the Registry but does NOT remove/update references from other items that are still kept in cache.
    Hence, you shall NEVER assume that two items of the same IID - even if both retrieved through the Registry -
    are the same objects or are identical. This also applies to Category objects referrenced by items through item.category.
    (TODO...)
    - Discarding of expired/excessive items is ONLY performed after request handling is finished
    (via django.core.signals.request_finished), which alleviates the problem of indirect duplicates, but means that
    the last request before item refresh operates on an already-expired item.
    """
    
    cache = None        # cached pairs of {ID: item}, with TTL configured on per-item basis
    
    def __init__(self):
        self.cache = LRUCache(maxsize = 1000, ttl = 3)
        self.bootstrap()
    
    def bootstrap(self):
        self._load_root()
        # print(f'Registry() created in thread {threading.get_ident()}')
    
    def get_item(self, id_ = None, cid = None, iid = None, category = None, load = True):
        """
        If load=True, the returned item is in __loaded__ state - this does NOT mean reloading,
        as the item data may have been loaded earlier.
        If load=False, the returned item usually contains only CID and IID (no data);
        this is not a strict rule, however, and if the item has been loaded or created before,
        by this or a previous request handler, the item can already be fully initialized.
        Hence, the caller should never assume that the returned item.data is missing.
        """
        if not id_:
            if category: cid = category.__iid__
            id_ = (cid, iid)
        else:
            (cid, iid) = id_
            
        if cid is None: raise Exception('missing CID')
        if iid is None: raise Exception('missing IID')
        
        # ID requested is already present in the registry? return the existing instance
        item = self.cache.get(id_)
        if item:
            if load: item._load()
            return item

        assert not cid == iid == ROOT_CID, 'root category should have been loaded during __init__() and be present in cache'

        # determine what itemclass to use for instantiation
        if not category:
            category = self.get_category(cid)
        itemclass = category.get('itemclass')                  # REFACTOR
        
        # create a new instance and insert to cache
        item = itemclass._create(category, iid)
        self._set(item)                            # _set() is called before item._load() to properly handle circular relationships between items
        if load: item._load()

        # print(f'Registry.get_item(): created item {id_} - {id(item)}')
        return item
    
    def get_lazy(self, *args, **kwargs):
        """Like get_item() but with load=False."""
        return self.get_item(*args, **kwargs, load = False)
    
    def get_category(self, cid):
        # assert cid is not None
        return self.get_item((ROOT_CID, cid))
    
    def get_site(self):
        return self.get_item(SITE_ID)
    
    def decode_items(self, records, category):
        """
        Given a sequence of raw DB `records` decode each of them and yield as an item.
        The items are saved in the registry and so they may override existing items.
        """
        itemclass = category.get('itemclass')
        for record in records:
            cid = record.pop('__cid__')
            iid = record.pop('__iid__')
            assert cid == category.__iid__

            if cid == iid == ROOT_CID:
                yield self.cache.get((cid, iid)) or self._load_root(record)
            else:
                item = itemclass._create(category, iid)
                self._set(item)
                item._load(record)
                yield item
        
    def save_item(self, item):
        """Called after a new item was saved to DB, to put its IID in the registry."""
        self._set(item)
        
    def _load_root(self, record = None):
        
        item = RootCategory._create(self)
        self._set(item, ttl = 0, protect = True)
        item._load(record)              # this loads the root data from DB if record=None
        # print(f'Registry.get_item(): created root category - {id(item)}')
        return item
        
    def _set(self, item, ttl = None, protect = False):
        """If ttl=None, default (positive) TTL of self.cache is used."""
        print(f'registry: creating item {item.__id__} in thread {threading.get_ident()} ', flush = True)
        self.cache.set(item.__id__, item, ttl, protect)

    def after_request(self, sender, **kwargs):
        """Cleanup and maintenance after a response has been sent, in the same thread."""
        self.cache.evict()
        

