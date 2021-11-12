import builtins, threading
from types import FunctionType, BuiltinFunctionType

from .config import ROOT_CID
from .cache import LRUCache
from .item import Category, RootCategory
from .db import YamlDB


#####################################################################################################################################################
#####
#####  CLASSPATH
#####

class Classpath:
    """
    Two-way registry of global python objects and their dotted module paths x.y.z
    for use inside JSON dumps and in-item source code. "Virtual packages".
    Provides two mappings:
    
    1) path -> object (forward mapping), for loading and importing objects; holds all types of objects;
    2) object -> path (inverse mapping), for serialization; only holds classes and functions.
    """

    forward = None          # dict of objects indexed by paths: (path -> object)
    inverse = None          # dict of paths indexed by objects: (object -> path)
    
    def __init__(self):
        self.forward = {}
        self.inverse = {}
    
    def __getitem__(self, path):
        """Return an object pointed to by a given path."""
        return self.forward[path]
        
    def __setitem__(self, path, obj):
        """
        Assign `obj` to a given path. Create an inverse mapping if `obj` is a class or function.
        Override an existing object if already present.
        """
        self.forward[path] = obj
        if self._is_class_func(obj):
            self.inverse[obj] = path            # create inverse mapping for classes and functions

    def get_path(self, obj):
        """
        Return canonical path of a given class or function, `obj`.
        If `obj` was added multiple times under different names (paths),
        the most recently assigned path is returned.
        """
        return self.inverse[obj]
        
    def add(self, path, *unnamed, **named):
        """
        Add objects to a given package `path` under provided names if in `named`,
        or under their original names (obj.__name__) if in `unnamed`.
        """
        for obj in unnamed:
            name = obj.__name__
            if not name: raise Exception(f"missing __name__ of an unnamed object being added to Classpath at path '{path}': {obj}")
            self[f'{path}.{name}'] = obj
        for name, obj in named.items():
            self[f'{path}.{name}'] = obj
       
    def add_module(self, module, path = None, symbols = None, accept = None,
                   exclude_private = True, exclude_variables = True, exclude_imported = True):
        """
        Add symbols from `module` to a given package `path` (module's python path if None).
        If `symbols` is None, all symbols found in the module are added, excluding:
        1) symbols whose name starts with underscore "_", if exclude_private=True;
        2) variables (i.e., not classes, not functions), if exclude_variables=True;
        3) classes/functions imported from other modules as determined by their __module__, if exclude_imported=True;
        4) symbols that point to objects whose accept(obj) is false, if `accept` function is defined.
        """
        modname = module.__name__
        if not path: path = modname
        if isinstance(symbols, str): symbols = symbols.split()
        elif symbols is None:
            def imported(_name):
                _obj = getattr(module, _name)
                return self._is_class_func(_obj) and getattr(_obj, '__module__', None) != modname
            
            symbols = dir(module)
            if exclude_private:   symbols = [s for s in symbols if s[:1] != '_']
            if exclude_variables: symbols = [s for s in symbols if self._is_class_func(getattr(module, s))]
            if exclude_imported:  symbols = [s for s in symbols if not imported(s)]
            
        for name in symbols:
            obj = getattr(module, name)
            if accept and not accept(obj): continue
            self[f'{path}.{name}'] = obj
        
    @staticmethod
    def _is_class_func(obj):
        return isinstance(obj, (type, FunctionType, BuiltinFunctionType))
        

#####################################################################################################################################################

class StagingArea:
    """"""
    

#####################################################################################################################################################
#####
#####  REGISTRY
#####

class Registry:
    """
    Hyperweb's runtime environment: global objects; request processing; access to and caching of items.
    
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
    WARNING: some duplicate items can still exist and be hanging around as references from other items - due to cache refresh,
    which removes items from the Registry but does NOT remove/update references from other items that are still kept in cache.
    Hence, you shall NEVER assume that two items of the same IID - even if both retrieved through the Registry -
    are the same objects or are identical. This also applies to Category objects referrenced by items through item.category.
    (TODO...)
    - Discarding of expired/excessive items is ONLY performed after request handling is finished
    (via django.core.signals.request_finished), which alleviates the problem of indirect duplicates, but means that
    the last request before item refresh operates on an already-expired item.
    """
    STARTUP_SITE = 'startup_site'       # this property of the root category stores the current site, for startup boot()
    
    db    = None            # Database where all items and other data are permanently stored
    cache = None            # cached pairs of {ID: item}, with TTL configured on per-item basis
    
    root    = None          # permanent reference to a singleton root Category object, kept here instead of cache
    site_id = None          # `site` is a property (below), not attribute, to avoid issues with caching (when an item is reloaded)
    
    @property
    def site(self): return self.get_item(self.site_id)
    @property
    def files(self): return self.site['filesystem']

    classpath   = None          # collection (Classpath) of globally available python objects and classes
                                # for serialization and in-item dependencies

    staging     = None          # list of modified or newly created items that will be updated/inserted to DB
                                # on next commit(); the items will be commited to DB in the SAME order as in this list;
                                # if a staged item is already in cache, it can't be purged there until committed (TODO)
    staging_ids = None          # dict of items with a non-empty ID that have already been added to `staging`,
                                # to avoid repeated insertion of the same item twice and to verify its identity (newborn items excluded)
    
    # autocommit  = True          # if True, commit() is called before returning a reponse from handle_request()
    #                             # and at the end of stop_request()
    
    current_request = None      # the currently processed web request; is set at the beginning
                                # of request processing and cleared at the end

    @property
    def current_app(self):                  # returns Application that's a target of current request; None if no current_request
        req = self.current_request
        return req.app if req is not None else None
    
    ####################################
    ###
    ###  Initialization & basic access
    ###

    def __init__(self):
        self.cache = LRUCache(maxsize = 1000, ttl = 3)      # TODO: remove support for protected items in cache, no longer needed
        self.db = YamlDB()
        self.staging = []
        self.staging_ids = {}
        
    def init_classpath(self):
        """
        Initialize self.classpath.
        To preserve a correct order of creation of core items, this method must called separately
        from __init__() when creating the global `registry`.
        """
        def issubtype(basetype):
            return lambda obj: isinstance(obj, type) and issubclass(obj, basetype)
        
        # the instructions below create items and categories in the background; this must be done
        # in a strictly defined order, and for this reason, the ordering of instructions cannot be changed
        
        PATH_CORE  = "hyperweb.core"
        PATH_TYPES = "hyperweb.types"
        
        self.classpath = Classpath()
        # self.classpath.add_module(builtins)
        
        import hyperweb.multidict
        self.classpath.add_module(hyperweb.multidict, PATH_CORE, symbols = "MultiDict")
        
        import hyperweb.schema
        self.classpath.add_module(hyperweb.schema, PATH_TYPES)          # schematt.types ?  schemat.types
        
        import hyperweb.item
        self.classpath.add_module(hyperweb.item, PATH_CORE)             # schemma.item ?

        import hyperweb.core.classes
        self.classpath.add_module(hyperweb.core.classes, PATH_CORE, accept = issubtype(hyperweb.item.Item))
    
    def boot(self):
        
        self.db.load()
        self.root = self.create_root()
        self.site_id = self.root[self.STARTUP_SITE]
        
    def create_root(self, load = True):
        """
        Create the RootCategory object, ID=(0,0). If `data` is provided,
        the properties are initialized from `data`, the object is bound through bind(),
        marked as loaded, and staged for insertion to DB. Otherwise, the object is left uninitialized.
        """
        self.root = root = RootCategory(self, load)
        if not load:                        # root created anew? self.db must be used directly (no stage/commit), because
            self.db.insert(root)            # ...self.root already has an ID and it would get "updated" rather than inserted!
        return root
        
    def set_site(self, site):
        
        from .core.classes import Site
        from .core.categories import Site_
        # Site_ = site['filesystem'].search('system/Site')
        assert site.has_id()
        assert isinstance(site, Site)
        assert site.isinstance(Site_)
        self.site_id = site.id
        
        self.root[self.STARTUP_SITE] = list(site.id)        # plain ID (not object) is stored to avoid circular dependency when loading RootCategory
        self.commit(self.root)
        
    def load_record(self, id):
        """Load item record from DB and return as a dict with cid, iid, data etc."""
        
        # TODO: in the future, make a checkpoint here to verify user's permissions to access a given item.
        return self.db.select(id)
    
    def get_category(self, cid):
        cat = self.get_item((ROOT_CID, cid))
        assert isinstance(cat, Category), f"not a Category object: {cat}"
        return cat
    
    def get_item(self, id, load = False):
        """
        If load=True, the returned item's data (properties) are loaded - this does NOT mean reloading,
        as the item data may have been loaded earlier.
        If load=False, the returned item is a "stub": only contains CID and IID (no data);
        this is not a strict rule, however, and if the item has been loaded or created before,
        by this or a previous request handler, the item can already be fully initialized.
        Hence, the caller should never assume that the returned item.data is missing.
        `id` should be a tuple (cid,iid).
        """
        id = (cid, iid) = tuple(id)
        
        if cid is None: raise Exception('missing CID')
        if iid is None: raise Exception('missing IID')
        if cid == iid == ROOT_CID:
            return self.root

        # ID requested is already present in cache? return the cached instance
        item = self.cache.get(id)
        if not item:
            # create a stub of an item and insert to cache, then load item data - these two steps are
            # separated to ensure proper handling of circular relationships between items
            item = self.create_stub(id)

        if load: item.load()
        return item
        
    # def get_essential(self, id):
    #     """Get item by `id` and load only essential properties, for display in a list of items etc."""
    
    def create_stub(self, id, category = None):
        """Create a "stub" item (no data) with a given ID and insert to cache."""
        cid, iid = id
        category = category or self.get_category(cid)       # TODO: pick a proper REVISION of the category, by version id
        itemclass = category.get_class()
        item = itemclass(category = category)
        item.iid = iid
        self.cache.set(id, item)  # ttl = None
        return item
    
    def scan_category(self, category):
        """Load from DB all items of a given category, ordered by IID. A generator."""
        records = self.db.scan_category(category.iid)
        for record in records:
            cid = record['cid']
            iid = record['iid']
            assert category is None or cid == category.iid

            if cid == iid == ROOT_CID:
                yield self.root
            else:
                # item = category.stub(iid)
                item = self.create_stub((cid, iid), category)
                item.load(data_json = record['data'])
                yield item
        
    def get_path(self, cls):
        """
        Return a dotted module path of a given class or function as stored in a global Classpath.
        In the future, each application may have its own distinct Classpath.
        """
        return self.classpath.get_path(cls)
        
    def get_class(self, path):
        """Get a global object - class or function from a virtual package (Classpath) - pointed to by a given path."""
        return self.classpath[path]
    
    def read(self, path):
        """Shortcut for registry.files.read(path)"""
        return self.files.read(path)
    
    ####################################
    ###
    ###  DB modifications
    ###

    def stage(self, item):
        """
        Add an updated or newly created `item` to the staging area.
        For updates, this typically should be called BEFORE modifying an item,
        so that its refresh in cache is prevented during modifications (TODO).
        """
        has_id = item.has_id()
        if has_id and item.id in self.staging_ids:          # do NOT insert the same item twice (NOT checked for newborn items)
            assert item is self.staging_ids[item.id]        # make sure the identity of `item` hasn't changed - this should be ...
            return                                          # guaranteed by the way how Cache and Registry work (single-threaded; cache eviction only after request)

        self.staging.append(item)
        if has_id: self.staging_ids[item.id] = item
        
    def commit(self, *items):
        """Insert/update all staged items (self.staging) in DB and purge the staging area. Append `items` before that."""
        for item in items: self.stage(item)
        if not self.staging: return

        # assert cache validity: the items to be updated must not have been substituted in cache in the meantime
        for item in self.staging:
            incache = self.cache.get(item.id)
            if not incache: continue
            assert item is incache, f"item instance substituted in cache while being modified: {item}, instances {id(item)} vs {id(incache)}"

        self.db.upsert_many(self.staging)
        self.staging_ids = {}
        self.staging = []
        
        
    ####################################
    ###
    ###  Request handling
    ###
    
    def handle_request(self, request):
        """
        During request processing, some additional non-standard attributes are assigned in `request`
        to carry Hyperweb-specific information for downstream processing functions:
        - request.url   = original absolute URL of the request
        - request.site  = Site that received the request (this overrides the Django's meaning of this attribute)
        - request.app   = leaf Application object this request is addressed to
        - request.item  = target item that's responsible for actual handling of this request
        - request.endpoint = name of endpoint (item's method or template) as extracted from the URL
        - request.user  = User item representing the current user who issued the request (overrides Django's value ??)
        - request.state = app-specific temporary data that's written during routing (handle()) and can be used for
                          response generation when a specific app's method is called, most typically url_path()

        X request.base_url = URL prefix that preceeds descriptor of the target item, used during URL generation
        """
        # request.url   = request.build_absolute_uri()
        request.site  = site = self.site
        request.state = None
        
        self.start_request(request)
        
        response = site.handle(request)
        self.commit()           # auto-commit is performed here, not in after_request(), to catch and display any possible DB failures
        
        # after "return" below, self.after_request(), and self.stop_request() are executed
        # in an action fired on Django's <request_finished> signal, see boot.py for details
        return response
    
    def start_request(self, request):
        assert self.current_request is None, 'trying to start a new request when another one is still open'
        self.current_request = request
        
    def after_request(self, sender, **kwargs):
        """
        Cleanup, maintenance, and long-running post-request tasks after a response has been sent, in the same thread.
        The `request` property is still available, but no additional response can be produced.
        """

    def stop_request(self):
        # print(f'after_request() in thread {threading.get_ident()}...', flush = True)
        assert self.current_request is not None, 'trying to stop a request when none was started'

        self.commit()
        self.cache.evict()
        # sleep(5)

        self.current_request = None
        
