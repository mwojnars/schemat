import mimetypes
from urllib.parse import urlencode
from django.http import FileResponse, Http404
from django.shortcuts import redirect

from hypertag.core.runtime import HyLoader, PyLoader
from hypertag import HyperHTML

from hyperweb.item import Item, handler, cached
#from schematt.item import Item, handler, cached
#from schemat.item import Item, handler, cached

#####################################################################################################################################################

class HyItemLoader(HyLoader):
    """
    Loader of Hypertag scripts that searches the site's directory instead of local disk. Used by Site class.
    Supported import paths:
    - .folder.module
    - ...folder.module
    - folder.module -- folder is searched for starting from "search paths" (/system /apps/APP)
      or from the "anchor folder" of the referrer (parent folder of the top-level package)
    - from /apps/XYZ/src/pkg1.pkg2.module import ...  -- the last "/" indicates the anchor folder
      from ../../dir/pkg1.pkg2.module import ...
    """
    PATH_SYSTEM = '/system'
    
    def __init__(self, filesystem):
        super(HyItemLoader, self).__init__()
        self.filesystem = filesystem            # currently, a Folder item
        
    def load(self, path, referrer, runtime):
        """`referrer` is a Module that should have been loaded by this loader."""
        
        item, location = self._find_item(path, referrer)
        if item is None: return None
        assert 'File' in item.category.get('name')
        
        script = item.read()    #item['content']
        # print('script loaded:\n', script)
        
        # # relative import path is always resolved relative to the referrer's location
        # if path[:1] == '.':
        #     location = join_path(referrer.location, path)
        #
        # # absolute import path is resolved relative to search paths
        # else:
        #     search_paths = [
        #         self.app['folder'],
        #         self.PATH_SYSTEM,
        #     ]

        module = self.cache[location] = runtime.translate(script, location)
        module.location = location

        return module
        
    def _find_item(self, path, referrer):
        
        # try the original `path` as location
        try:
            item = self.filesystem.search(path)
            return item, path
        except Exception: pass
        
        # try appending .hy extension to `path`
        if not path.lower().endswith(self.SCRIPT_EXTENSION):
            location = path + self.SCRIPT_EXTENSION
            try:
                item = self.filesystem.search(location)
                return item, location
            except Exception: pass
            
        return None, None
    

#####################################################################################################################################################
#####
#####  SITE
#####

class Site(Item):
    """
    Global configuration of all applications that comprise this website, with URL routing etc.
    """
    
    @property
    @cached(ttl = 60)
    def hypertag(self):
        """Return a HyperHTML runtime with customized loaders to search through an internal filesystem of items."""
        files = self.get('filesystem')
        loaders = [HyItemLoader(files), PyLoader]       # PyLoader is needed to load Python built-ins
        return HyperHTML(loaders)
        
    # def bind(self):
    #     self._qualifiers = bidict()
    #     for app in self.get_list('app'):
    #         for space_name, space in app.get('spaces').items():
    #             for category_name, category in space.get('categories').items():
    #                 qualifier = f"{space_name}.{category_name}"         # space-category qualifier of item IDs in URLs
    #                 self._qualifiers[qualifier] = category.iid

    # def get_category(self, cid):
    #     """Retrieve a category through the Registry that belongs to the current thread."""
    #     return self.registry.get_category(cid)
    
    # def get_item(self, *args, **kwargs):
    #     """Retrieve an item through the Registry that belongs to the current thread."""
    #     return self.registry.get_item(*args, **kwargs)
    
    def ajax_url(self):
        """Absolute base URL for AJAX calls originating at a client UI."""
        return self['base_url'] + '/ajax'

    def get_url(self, item, route = '', relative = False, no_base = False, params = None):
        """Return an absolute or relative URL of `item` as assigned by the application anchored at `route`."""
        app  = self['application']
        base = self['base_url']
        
        # relative URL
        path = app.url_path(item, route, relative = relative, params = params)
        if relative: return path
        
        #if path[:1] != '/': path = '/' + path
        path = '/' + path
        if no_base: return path                         # absolute URL without base

        if base[-1:] == '/': base = base[:-1]
        return base + path                              # absolute URL with base
    
    def handle(self, request):
        """Forward the request to a root application configured in the `app` property."""
        app = self['application']
        return app.handle(request, request.path)

        # url  = request.url
        # app  = self['application']
        # base = self['base_url']
        # if base[-1:] == '/': base = base[:-1]           # truncate the trailing '/'
        #
        # path = url[len(base):]                          # path starts with '/', or is an empty string!
        #
        # if not url.startswith(base): raise Exception(f'page not found: {url}')
        #
        # # request.base_url = base
        # return app.handle(request, path)


#####################################################################################################################################################
#####
#####  APPLICATIONS
#####

class Application(Item):
    """
    An application implements a mapping of URL paths to item methods, and the way back.
    Some application classes may support nested applications.
    INFO what characters are allowed in URLs: https://stackoverflow.com/a/36667242/1202674
    """
    SEP_ROUTE    = '/'      # separator of route segments in URL, each segment corresponds to another (sub)application
    SEP_ENDPOINT = '@'
    
    def handle(self, request, path):
        """
        Handle a web `request` in a way identified by a given URL `path`:
        find an item pointed to by `path` and call its serve() to render response.
        Raise an exception if item not found or the path not recognized.
        `path` is a part of the URL after application's base URL that typically identifies an item
        and its endpoint within this application; does NOT include a query string.
        Parent applications should ensure that whenever a sub-application's handle() is called,
        the leading SEP_ROUTE separator is preserved in its `path`, so that the sub-application
        can differentiate between URLs of the form ".../PARENT/" and ".../PARENT".
        """
        raise NotImplementedError()

    def url_path(self, item, route = '', relative = True, endpoint = None, params = None):
        """
        Generate URL path (URL fragment after route) for `item`, possibly extended with a non-default
        endpoint designation and/or arguments to be passed to a handler function or a template.
        If relative=True, the path is relative to a given application `route`; otherwise,
        it is absolute, i.e., includes segments for all intermediate applications;
        the path does NOT have a leading separator, or it has a different meaning -
        in any case, a leading separator should be appended by caller if needed.
        """
        raise NotImplementedError()
    
    def _split_endpoint(self, path):
        """Decode @endpoint from the URL path."""
        
        endpoint = ""
        if '?' in path:
            path, args = path.split('?', 1)
        if self.SEP_ENDPOINT in path:
            path, endpoint = path.rsplit(self.SEP_ENDPOINT, 1)
        
        return path, endpoint
    
    def _set_endpoint(self, url, endpoint, params):
        
        if endpoint: url += f'{self.SEP_ENDPOINT}{endpoint}'
        if params: url += f'?{urlencode(params)}'
        return url
    
    
class AppRoot(Application):
    """A set of sub-applications, each bound to a different URL prefix."""
    
    def _route(self, path):
        """
        Make one step forward along a URL `path`. Return the extracted route segment (step),
        the associated application object, and the remaining subpath.
        """
        lead = 0

        # consume leading '/' (lead=1) when it's followed by text, but treat it as terminal
        # and preserve in a returned subpath otherwise
        if path.startswith(self.SEP_ROUTE):
            lead = (len(path) >= 2)
            step = path[1:].split(self.SEP_ROUTE, 1)[0]
        else:
            step = path.split(self.SEP_ROUTE, 1)[0]
        
        apps = self['apps']
        app  = apps.get(step, None)
        
        if step and app:                       # non-default (named) route can be followed with / in path
            return step, app, path[lead+len(step):]
        
        if '' in apps:                          # default (unnamed) route has special format, no "/"
            return '', apps[''], path
        
        raise Exception(f'URL path not found: {path}')
    
    def handle(self, request, path):
        """
        Find an application in self['apps'] that matches the requested URL path and call its handle().
        `path` can be an empty string; if non-empty, it starts with SEP_ROUTE character.
        """
        
        route, app, path = self._route(path)
        
        # # request-dependent global function that converts leaf application's local URL path to an absolute URL by passing it up through the current route
        # request.route = lambda path_: f"{base}{route}/{path_}"
        # request.base_url += route + self.SEP_ROUTE
        
        return app.handle(request, path)
    
    def url_path(self, item, route = '', relative = True, endpoint = None, params = None):
        
        step, app, path = self._route(route)
        subpath = app.url_path(item, path, relative = relative)
        if relative: return subpath                                     # path relative to `route`
        # if subpath[:1] == '/': subpath = subpath[1:]
        return self.SEP_ROUTE.join(filter(None, [step, subpath]))       # absolute path, empty segments excluded
        # if relative or not step: return subpath                         # step can be '' (default route)
        # if subpath and subpath[:1] != '/': subpath = '/' + subpath
        # return step + subpath                                           # nothing is appended if subpath was originally empty
        
        
        
class AppAdmin(Application):
    """Admin interface. All items are accessible through the 'raw' routing pattern: .../CID:IID """
    
    def _find_item(self, path, request):
        """Extract CID, IID, endpoint from a raw URL of the form CID:IID@endpoint, return CID and IID, save endpoint to request."""
        try:
            path, request.endpoint = self._split_endpoint(path[1:])
            cid, iid = map(int, path.split(':'))
        except Exception as ex:
            raise Exception(f'URL path not found: {path}')

        return self.registry.get_item((cid, iid))

    def handle(self, request, path):
        
        item = self._find_item(path, request)
        return item.serve(request, self)
        
    def url_path(self, item, route = '', relative = True, endpoint = None, params = None):
        assert item.has_id()
        cid, iid = item.id
        url = f'{cid}:{iid}'
        return self._set_endpoint(url, endpoint, params)
        
class AppAjax(AppAdmin):
    
    def handle(self, request, path):
        item = self._find_item(path, request)
        request.endpoint = "json"
        return item.serve(request, self)
        
class AppFiles(Application):
    """
    Filesystem application. Folders and files are accessible through the hierarchical
    "file path" routing pattern: .../dir1/dir2/file.txt
    """
    def handle(self, request, path):
        if not path.startswith('/'): return redirect(request.path + '/')

        # TODO: make sure that special symbols, e.g. "$", are forbidden in file paths
        filepath, request.endpoint = self._split_endpoint(path[1:])
        request.state = {'filepath': filepath}
        
        root = self.get('root_folder') or self.registry.files
        item = root.search(filepath)

        files = self.registry.files
        File_ = files.search('system/File')
        Folder_ = files.search('system/Folder')
        
        default_endpoint = ()
        if item.isinstance(File_):
            default_endpoint = ('download',)
        elif item.isinstance(Folder_):
            # if not filepath.endswith('/'): raise Exception("folder URLs must end with '/'") #return redirect(request.path + '/')       # folder URLs must end with '/'
            request.state['folder'] = item          # leaf folder, for use when generating file URLs (url_path())
            # default_endpoint = ('browse',)
        
        return item.serve(request, self, *default_endpoint)
        
    def url_path(self, item, route = '', relative = True, endpoint = None, params = None):
        # TODO: convert folder-item relationship to bottom-up to avoid using current_request.state
        
        state = self.registry.current_request.state
        return state['folder'].get_name(item)
    
    # def _search(self, path):
    #     """Find an item (folder/file) pointed to by `path` and its direct parent folder. Return both."""
    #     parent = None
    #     item = self.get('root_folder') or self.registry.files
    #     while path:
    #         parent = item
    #         name = path.split(self.SEP_FOLDER, 1)[0]
    #         item = parent.get('files')[name]
    #         path = path[len(name)+1:]
    #     return item, parent
        

class AppSpaces(Application):
    """
    Application for accessing public data through verbose paths of the form: .../SPACE:IID,
    where SPACE is a text identifier assigned to a category in `spaces` property.
    """
    def handle(self, request, path):
        try:
            path, request.endpoint = self._split_endpoint(path[1:])
            space, item_id = path.split(':')        # decode space identifier and convert to a category object
            category = self['spaces'][space]
        except Exception as ex:
            raise Exception(f'URL path not found: {path}')
            
        item = category.get_item(int(item_id))
        return item.serve(request, self)

    def url_path(self, item, route = '', relative = True, endpoint = None, params = None):
        category  = item.category
        space = self._find_space(category)
        iid   = category.encode_url(item.iid)
        url   = f'{space}:{iid}'
        return self._set_endpoint(url, endpoint, params)

    @cached(ttl = 10)
    def _find_space(self, category):
        for space, cat in self['spaces'].items():
            if cat.id == category.id: return space
        raise Exception(f'URL path not found for items of category {category}')


#####################################################################################################################################################
#####
#####  FILES & FOLDERS
#####

class Folder(Item):
    """"""
    SEP_FOLDER = '/'          # separator of folders in a file path

    def exists(self, path):
        """Check whether a given path exists in this folder."""
    
    def search(self, path):
        """
        Find an item pointed to by a `path`. The path may start with '/', but this is not obligatory.
        The search is performed recursively in subfolders.
        """
        if path.startswith(self.SEP_FOLDER): path = path[1:]
        item = self
        while path:
            name = path.split(self.SEP_FOLDER, 1)[0]
            item = item.get('files')[name]
            path = path[len(name)+1:]
        return item
        
    def read(self, path):
        """Search for a File/FileLocal pointed to by a given `path` and return its content."""
        f = self.search(path)
        if isinstance(f, File): return f.read()
        raise Exception(f"not a file: {path}")
        
    def get_name(self, item):
        """Return a name assigned to a given item. If the same item is assigned multiple names,
        the last one is returned."""
        names = self._names()
        return names.get(item.id, None)

    @cached(ttl=10)
    def _names(self):
        """Take `files` property and compute its reverse mapping: item ID -> name."""
        files = self.get('files')
        return {f.id: name for name, f in files.items()}
    

class File(Item):
    """"""
    def read(self):
        """Return full content of this file, either as <str> or a Response object."""
        return self.get('content')

    @handler('download')
    def download(self, request):
        return self.read()

class FileLocal(File):

    def read(self):
        path = self.get('path', None)
        if path is None: return None
        return open(path, 'rb').read()

    @handler('download')
    def download(self, request):
        
        content = self.get('content', None)
        if isinstance(content, str): return FileResponse(content)
        
        path = self.get('path', None)
        if not path: raise Http404

        content_type, encoding = mimetypes.guess_type(path)
        content_type = content_type or 'application/octet-stream'
        
        content = open(path, 'rb')
        response = FileResponse(content, content_type = content_type)

        if encoding:
            response.headers["Content-Encoding"] = encoding
            
        # TODO respect the "If-Modified-Since" http header like in django.views.static.serve(), see:
        # https://github.com/django/django/blob/main/django/views/static.py
        
        return response

