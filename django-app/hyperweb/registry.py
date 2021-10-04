import builtins, threading
from types import FunctionType, BuiltinFunctionType

from .config import ROOT_CID
from .cache import LRUCache
from .item import Category
from .store import SimpleStore, CsvStore, JsonStore, YamlStore


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
    STARTUP_SITE = 'startup_site'       # this property of the root category will be used to read/store the current site for startup
    
    store = None                # DataStore where items are read from and saved to
    cache = None                # cached pairs of {ID: item}, with TTL configured on per-item basis
    
    site_id = None
    
    # properties for accessing core global items: root, site, ...
    # these items are not stored as attributes to avoid issues with caching (when an item is reloaded)
    @property
    def root(self): return self.get_item((ROOT_CID, ROOT_CID))
    @property
    def site(self): return self.get_item(self.site_id)
    @property
    def files(self): return self.site['filesystem']

    classpath   = None          # collection (Classpath) of globally available python objects and classes
                                # for serialization and in-item dependencies

    staging     = None          # list of modified or newly created items that will be updated/inserted to DB
                                # on next commit(); the items will be commited to DB in the SAME order as in this list;
                                # if a staged item is already in cache, it can't be purged there until committed, TODO
    
    autocommit  = True          # if True, commit() is called before returning a reponse from handle_request()
                                # and at the end of stop_request()
    
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
        self.cache = LRUCache(maxsize = 1000, ttl = 3)
        self.store = YamlStore()
        self.staging = []
        
    def init_classpath(self):
        """
        Initialization of self.classpath.
        To preserve a correct order of creation of core items,
        this method must be separated out from __init__ and called explicitly
        by client code (boot.py) after the global `registry` is created.
        """
        def issubtype(basetype):
            return lambda obj: isinstance(obj, type) and issubclass(obj, basetype)

        # the instructions below create items and categories in the background; this must be done
        # in a strictly defined order, and for this reason, the ordering of instructions cannot be changed
        
        PATH_CORE = "hyperweb.core"
        self.classpath = Classpath()
        self.classpath.add_module(builtins)

        import hyperweb.multidict
        self.classpath.add_module(hyperweb.multidict, symbols = "MultiDict")
        
        import hyperweb.schema
        self.classpath.add_module(hyperweb.schema)                  # schemma.type ? schematt.type

        import hyperweb.item
        self.classpath.add_module(hyperweb.item, PATH_CORE)         # schemma.item ?

        import hyperweb.core.classes
        self.classpath.add_module(hyperweb.core.classes, PATH_CORE, accept = issubtype(hyperweb.item.Item))
    
    def boot(self):
        self.store.load()
        root = self.load_root()
        site = root.get(self.STARTUP_SITE)
        self.site_id = site.id
        
    def load_root(self, record = None):
        """
        Create and initialize the root category; load its data from DB (if record=None)
        or from a preloaded db `record`.
        """
        root = self.create_root()
        root.load(record, force = True)
        return root
        
    def create_root(self):
        """
        Create the root Category object, ID=(0,0). If `data` is provided,
        the properties are initialized from `data`, the object is bound through bind(),
        marked as loaded, and staged for insertion to DB. Otherwise, the object is left uninitialized.
        """
        # from .core.root import root_fields
        from .core.root import root_data

        # root.data will ultimately be overwritten with data from DB, but is needed for the initial
        # call to root.load(), where it's accessible thx to circular dependency root.category==root
        root = Category(data = root_data) #{'fields': root_fields})
        root.registry = self
        root.category = root                    # root category is a category for itself
        root.cid = ROOT_CID
        root.iid = ROOT_CID
        
        self._set(root, ttl = 0, protect = True)
        
        # if data is not None:
        # root.seed(data)
        root.bind()
        
        # print(f'Registry.get_item(): created root category - {id(root)}')
        return root
        
    def set_site(self, site):
        
        from .core.classes import Site
        from .core.categories import Site_
        # Site_ = site['filesystem'].search('system/Site')
        assert site.has_id()
        assert isinstance(site, Site)
        assert site.isinstance(Site_)
        self.site_id = site.id
        
        self.root.set(self.STARTUP_SITE, site)
        self.update_item(self.root)
        
        # self.stage(self.root)
        # self.commit()

    def get_category(self, cid):
        # assert cid is not None
        cat = self.get_item((ROOT_CID, cid))
        assert isinstance(cat, Category), f"not a Category object: {cat}"
        return cat
    
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
    
    def load_record(self, id):
        """Load item record from DB and return as a dict; contains cid, iid, data etc."""
        # print(f'load_record: loading item {id} in thread {threading.get_ident()} ', flush = True)
        return self.store.select(id)
    
    def load_items(self, category):
        """Load from DB all items of a given category, ordered by IID. A generator."""
        records = self.store.select_all(category.iid)
        return self.decode_items(records, category)
        
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
                yield self.cache.get((cid, iid)) or self.load_root(record)
            else:
                item = category.stub(iid)
                self._set(item)
                item.load(record)
                yield item
        
    def _set(self, item, ttl = None, protect = False):
        """Add `item` to internal cache. If ttl=None, default (positive) TTL is used."""
        # print(f'registry: creating item {item.id} in thread {threading.get_ident()} ', flush = True)
        self.cache.set(item.id, item, ttl, protect)

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
    ###  Item creation & update
    ###

    def stage(self, item):
        """
        Add an updated or newly created `item` to the staging area.
        For updates, this typically should be called BEFORE modifying an item,
        so that its refresh in cache is prevented during modifications (TODO).
        """
        # assert force or not item.has_id()
        # if item.has_id():
        #     check that this ID is not yet in staging; if present, check it's the same python object and skip
        self.staging.append(item)
        
    def commit(self, **kwargs):
        """Insert staged items to DB and purge the staging area."""
        if not self.staging: return
        
        # TODO: if ID is present for an item, make an update, not insert
        self.store.insert_many(self.staging)
        for item in self.staging:
            # if item.has_id(): continue          # item got already inserted in the meantime
            self._set(item, **kwargs)
        self.staging = []
        
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
        request.url  = request.build_absolute_uri()
        request.site = site = self.site
        self.start_request(request)

        response = site.handle(request)
        if self.autocommit: self.commit()
        
        # after "return" below, self.after_request() and self.stop_request() are executed
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
        # print(f'after_request() in thread {threading.get_ident()}...', flush = True)
        self.cache.evict()
        # sleep(5)

    def stop_request(self):
        assert self.current_request is not None, 'trying to stop a request when none was started'
        if self.autocommit: self.commit()
        self.current_request = None
        
