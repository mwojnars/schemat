import threading
from collections import defaultdict

from .config import ROOT_CID, SITE_ID
from .cache import LRUCache
from .item import RootCategory, Site
from .store import SimpleStore, CsvStore, JsonStore, YamlStore


#####################################################################################################################################################
#####
#####  REGISTRY
#####

class Registry:
    """
    A registry of Item instances recently created or loaded from DB during current web request or previous ones.
    Managing the pool of items through the entire execution of an application:
      - transfering items to/from DB storage(s) and through the cache
      - tracking changes
      - creating new items
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
    
    store = YamlStore()         # DataStore where items are read from and saved to
    cache = None                # cached pairs of {ID: item}, with TTL configured on per-item basis
    
    site_id = None
    
    def __init__(self):
        self.cache = LRUCache(maxsize = 1000, ttl = 3)
    
    def boot(self, core_items = None):
        self.store.load()
        self._load_root()
        self.site_id = SITE_ID
        # print(f'Registry() booted in thread {threading.get_ident()}')
        
    def seed(self, core_items):
        """
        Seed the DB and this registry with a list of initial "core" items.
        The items are treated as newly created ones and get inserted to DB as such,
        where they get assigned IDs along the way.
        
        The items should have empty IDs, which will be assigned here by the registry:
        CIDs are taken from each item's category, while IIDs are assigned using
        consecutive numbers within a category. The root category must be the first item on the list.
        """
        site = None
        next_iid = defaultdict(lambda: 1)           # all IIDs start from 1, except for the root category
        
        for i, item in enumerate(core_items):
            item.registry = self
            
            if i == 0:
                assert isinstance(item, RootCategory), "root category must be the first item on the list"
                assert ROOT_CID < 1
                item.cid = item.iid = ROOT_CID
            else:
                # item.cid = cid = item.category.iid
                # item.iid = next_iid[cid]
                # assert cid is not None
                # next_iid[cid] += 1
                if isinstance(item, Site):
                    site = item
                
        self.store.insert_many(core_items)
        for item in core_items:
            self._set(item, ttl = 0, protect = True)

        assert site is not None, "Site item not found among core items"
        self.site_id = site.id
        

    def get_item(self, id = None, cid = None, iid = None, category = None, load = True):
        """
        If load=True, the returned item is in __loaded__ state - this does NOT mean reloading,
        as the item data may have been loaded earlier.
        If load=False, the returned item usually contains only CID and IID (no data);
        this is not a strict rule, however, and if the item has been loaded or created before,
        by this or a previous request handler, the item can already be fully initialized.
        Hence, the caller should never assume that the returned item.data is missing.
        """
        if not id:
            if category: cid = category.iid
            id = (cid, iid)
        else:
            id = (cid, iid) = tuple(id)
            
        if cid is None: raise Exception('missing CID')
        if iid is None: raise Exception('missing IID')
        
        # ID requested is already present in the registry? return the existing instance
        item = self.cache.get(id)
        if item:
            if load: item.load()
            return item

        assert not cid == iid == ROOT_CID, 'root category should have been loaded during __init__() and be present in cache'

        if not category:
            category = self.get_category(cid)

        # create a new stub in a given `category` and insert to cache; then load full item data
        item = category.stub(iid)
        self._set(item)                     # _set() is called before item.load() to properly handle circular relationships between items
        if load: item.load()

        # print(f'Registry.get_item(): created item {id_} - {id(item)}')
        return item
    
    def get_lazy(self, *args, **kwargs):
        """Like get_item() but with load=False."""
        return self.get_item(*args, **kwargs, load = False)
    
    def get_category(self, cid):
        # assert cid is not None
        return self.get_item((ROOT_CID, cid))
    
    def get_site(self):
        site = self.get_item(self.site_id)
        assert isinstance(site, Site), f'incorrect class of a site item ({type(site)}), possibly wrong site_id ({self.site_id})'
        return site
    
    def decode_items(self, records, category):
        """
        Given a sequence of raw DB `records` decode each of them and yield as an item.
        The items are saved in the registry and so they may override existing items.
        """
        for record in records:
            cid = record.pop('cid')
            iid = record.pop('iid')
            assert cid == category.iid

            if cid == iid == ROOT_CID:
                yield self.cache.get((cid, iid)) or self._load_root(record)
            else:
                item = category.stub(iid)
                self._set(item)
                item.load(record)
                yield item
        
    def _load_root(self, record = None):
        
        root = RootCategory.create_root(self)
        self._set(root, ttl = 0, protect = True)
        root.load(record)              # this loads the root data from DB if record=None
        # print(f'Registry.get_item(): created root category - {id(root)}')
        return root
        
    def load_data(self, id):
        """Load item data from DB and return as a record (dict)."""
        print(f'load_data: loading item {id} in thread {threading.get_ident()} ', flush = True)
        return self.store.select(id)
    
    def load_items(self, category):
        """Load from DB all items of a given category, ordered by IID. A generator."""
        records = self.store.select_all(category.iid)
        return self.decode_items(records, category)
        
    def insert_item(self, item):
        """
        Insert `item` as a new entry in DB. Create a new IID and assign to `item.iid`,
        which must have been None before insertion.
        """
        assert item.iid is None
        self.store.insert(item)
        assert item.iid is not None
        self._set(item)

    def update_item(self, item):
        """Update the contents of the item's data in DB."""
        self.store.update(item)
        self._set(item)             # only needed in a hypothetical case when `item` has been overriden in the registry by another version of the same item

    def _set(self, item, ttl = None, protect = False):
        """If ttl=None, default (positive) TTL of self.cache is used."""
        print(f'registry: creating item {item.id} in thread {threading.get_ident()} ', flush = True)
        self.cache.set(item.id, item, ttl, protect)

    def after_request(self, sender, **kwargs):
        """Cleanup and maintenance after a response has been sent, in the same thread."""
        self.cache.evict()
        

