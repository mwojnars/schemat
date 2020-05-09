# -*- coding: utf-8 -*-
"""
Loaders: classes that provide name-based access to external resources, possibly with caching of post-processed resource objects.

@author:  Marcin Wojnarski
"""

import os, time, six


########################################################################################################################################################
###
###  BASE LOADER
###

class Loader(object):
    """Base class for loaders: classes that provide name-based access to external resources, possibly with caching.
    The cached object does NOT have to be the original resource object. Rather, it can be any post-processed version of the resource,
    such that all post-processing is avoided altogether when only a cached version is available.
    """
    
    def canonical(self, name, rel = None):
        """Returns full canonical name of the resource ('fullname'), as calculated from the (possibly relative) 'name' and 'rel'.
        'rel' (`relative to`) is an optional reference object - typically a name of another resource - that's used to properly resolve 'name' 
        in cases when it is a relative name, for example, when relative file paths are used.
        All other loader's methods take canonical names as arguments.
        """
        return name
        
    def load(self, fullname):
        """
        Loads a given resource from its original external location. Returns a pair: (resource, metadata),
        where 'metadata' is any loader-specific object that keeps extra information about the resource, as needed for cache management,
        and must be passed to subsequent cache() call when a post-processed resource object is going to be cached.
        """
        raise Exception("Resource not found: %s" % fullname)
        
    def get(self, fullname):
        "Return a cached copy of the resource, or None if the resource is missing or outdated. Caching is based on canonical names."
        # no caching by default
        return None
        
    def cache(self, fullname, obj, meta, dependencies = set()):
        """Store the loaded object in cache for future use, together with its metadata as returned by load()
        and a set of dependencies as tracked by the client (each dependency given as a canonical name)
        - for detection of dirty cached items. 'fullname' is the canonical name as returned by canonical() and load().
        """
        # no caching by default
        
    def reset(self, fullname = None):
        "Clear the whole cache if fullname=None, or remove just the resource 'fullname'. Do nothing if 'fullname' is not in cache."
        # no caching by default


class Cache(object):
    "The cache part of loaders implementation, inherited by subclasses."

    cached = None           # the dictionary of all cached objects and their metadata: fullname -> (obj, meta, dependencies)
                            # the type and contents of 'meta' is controlled by load() method,
                            # the type and contents of 'obj' is entirely up to the client code
    
    def __init__(self):
        self.cached = {}
    
    def get(self, fullname):
        if fullname in self.cached:
            if self.uptodate(fullname): 
                return self.cached[fullname][0]
            else:
                del self.cached[fullname]                       # remove from cache to avoid repeated uptodate checks
        return None
        
    def cache(self, fullname, obj, meta, dependencies = None):
        "If 'dependencies' are used by uptodate() in the subclass, they must always be passed here as a set, not None."
        self.cached[fullname] = (obj, meta, dependencies)
        
    def reset(self, fullname = None):
        if fullname is None: 
            self.cached = {}
        elif fullname in self.cached:
            del self.cached[fullname]

    def dependencies(self, fullname):
        """Walk the graph of dependencies with breadth-first search and retrieve a complete set of resources 
        that are (direct or indirect) dependencies of a given resource, including itself.
        If at some point we reach a resource that's missing in the cache or has None dependencies (=unknown),
        None is returned to indicate that dependencies can't be reliably computed (the resource is likely to be dirty).
        """
        out = set()                             # deps. whose children have already been processed
        queue = {fullname}
        
        while queue:
            name = queue.pop()
            out.add(name)
            _, _, deps = self.cached.get(name, (None, None, None))
            if deps is None: return None
            
            for candid in deps:
                if candid not in out: queue.add(candid)
            
        return out
            

    def uptodate(self, fullname):
        """A `virtual` method to be overriden in subclasses. Returns True if a given resource in the cache is still up to date 
        and can be safely returned by get() instead of loading it from the original external location."""
        raise NotImplementedError()

        
########################################################################################################################################################
###
###  CUSTOM LOADERS
###

class DictLoader(Loader):
    "Loads resources stored in a dict. For testing purposes."
    
    def __init__(self, resources = {}, **kwargs):
        "The mapping can be passed as a dict and/or via keyword arguments."
        self.resources = resources.copy()
        self.resources.update(kwargs)
        
    def load(self, fullname):
        return self.resources.get(fullname), None           # no caching, meta = None
    


class FileLoader(Cache, Loader):
    
    encoding = "utf-8" if six.PY2 else None

    root = None             # optional default 'rel' for computing canonical names in canonical(), when no other 'rel' is given
    
    def __init__(self, root = None, encoding = None):
        if root and root[-1] != os.sep:             # add trailing '/' to 'root', so that it's treated as a folder name, not file name
            root += os.sep
        self.root = root
        if encoding: self.encoding = encoding
        Cache.__init__(self)
    
    def canonical(self, name, rel = None):
        """
        Compute the filesystem-canonical (normalized & absolute) path of the resource.
        'rel': optional name of a file to be used as a reference (file in the `current folder`) for resolution of relative paths;
        only used when 'name' is a relative path, for absolute 'name' paths 'rel' has no effect.
        If 'rel' is needed but missing, self.root is used as a fallback.
        If 'name' starts with double-slash: "//", it is interpreted as a root-relative path and 'rel' is ignored altogether.
        Warning: if 'rel' is a folder, it MUST be terminated with a slash, otherwise the last component will be truncated.
        """
        if name[:2] == '//':                            # root-relative name? join with self.root
            name = self.root + name[2:]
        elif not os.path.isabs(name):                   # filesystem-relative name? join with 'rel' or self.root
            path = os.path.dirname(rel or self.root or '')
            name = os.path.join(path, name)
        fullname = os.path.realpath(name)
        return fullname
        
    def load(self, fullname):
        # To detect changes to the file on disk, we keep the current Unix time, time.time(),
        # and compare it later on with the file modification time returned by getmtime().
        # Warning: we assume that both times are in the same timezone! if this is not the case, errors may occur.
        # Using the getmtime() as a reference instead of time() is not possible, because this would not
        # let us resolve dependencies correctly.
        meta = time.time()                      
        doc = open(fullname).read()
        if self.encoding: doc = doc.decode(self.encoding)
        return doc, meta
        
    def uptodate(self, fullname):
        "Performs dependencies tracking. Checks if any of the dependencies, or the resource itself, has changed after the resource was loaded."
        deps = self.dependencies(fullname)              # includes the resource itself
        #print "ALL dependencies:", deps
        if deps is None: return False                   # dependencies can't be reliably calculated? the resource is likely outdated
        
        _, mtime, _ = self.cached.get(fullname, (None,None,None))
        if mtime is None: return False                  # this case is unlikely, rather only in multi-threaded execution (race conditions)
        
        try:
            for name in deps:                           # some dependency is newer on disk than the time when the resource was loaded? must refresh
                if os.path.getmtime(name) > mtime: return False
            return True
        
        except (KeyError, OSError):                     # some dependency is missing in cache or on disk? must refresh
            return False
        
    