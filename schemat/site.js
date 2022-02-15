import { print, assert, splitLast, T } from './utils.js'
import { ItemsMap } from './data.js'
import { Item, Request } from './item.js'


/**********************************************************************************************************************/

// Currently, vm.Module (Site.importModule()) cannot import builtin modules, as they are not instances of vm.Module.
// For this reason, importLocal() is added to the global context, so that the modules imported from DB can use it
// as an alias for standard (non-VM) import(). Adding this function in a call to vm.createContext() instead of here raises errors.
globalThis.importLocal = (p) => import(p)


/**********************************************************************************************************************
 **
 **  ITEM SUBCLASSES
 **
 */

export class Site extends Item {
    /* Global configuration of all applications that comprise this website, with URL routing etc. */

    async import(path, referrer) {
        /* Custom import of JS files and code snippets from Schemat's Universal Namespace.
           This method returns a namespace object extracted from a vm.Module loaded by importModule().
           Optional `referrer` is a vm.Module object.
         */
        let module = await this.importModule(path, referrer)
        return module.namespace
    }

    async importModule(path, referrer) {
        /* Custom import of JS files and code snippets from Schemat's Universal Namespace. Returns a vm.Module object. */
        // TODO: cache module objects, parameter Site:cache_modules_ttl
        // TODO: for circular dependency return an unfinished module (use cache for this)

        const PREFIX = 'schemat:'
        const unprefix = (s) => s.startsWith(PREFIX) ? s.slice(PREFIX.length) : s

        // convert a relative path to absolute
        if (path[0] === '.') {
            if (!referrer) throw new Error(`missing referrer for a relative import path: '${path}'`)
            path = unprefix(referrer.identifier) + '/../' + path    // referrer is a vm.Module
            path = this._normPath(path)
        }
        // else if (!path.startsWith(PREFIX) && path[0] !== '/')       // NOT WORKING: fall back to Node's import for no-path global imports (no ./ or /...)
        //     return import(path)
        else
            path = unprefix(path)

        let source = await this.route(new Request({path, method: 'import'}))
        if (!source) throw new Error(`Site.importModule(), path not found: ${path}`)
        let identifier = PREFIX + path

        const vm = await import('vm')
        let context = vm.createContext(globalThis)
        // let context = referrer?.context || vm.createContext({...globalThis, importLocal: p => import(p)})
        // submodules must use the same^^ context as referrer (if not globalThis), otherwise an error is raised

        let linker = (specifier, ref, extra) => this.importModule(specifier, ref)
        let initializeImportMeta = (meta) => {meta.url = identifier}

        let module = new vm.SourceTextModule(source, {context, identifier, initializeImportMeta, importModuleDynamically: linker})

        await module.link(linker)
        await module.evaluate()
        return module
    }
    _normPath(path) {
        /* Drop single dots '.' occuring as `path` segments; truncate parent segments wherever '..' occur. */
        path = path.replaceAll('/./', '/')
        let lead = path[0] === '/' ? path[0] : ''
        if (lead) path = path.slice(1)

        let parts = []
        for (const part of path.split('/'))
            if (part === '..')
                if (!parts.length) throw new Error(`incorrect path: '${path}'`)
                else parts.pop()
            else parts.push(part)

        return lead + parts.join('/')
    }

    async routeWeb(session) {
        /* Routing of a web request (in contrast to an internal request). */
        return this.route(new Request({session, path: session.path}))
    }
    async route(request) {
        /* Forward the request to the root item. */
        if (request.path[0] !== '/') throw new Error(`missing leading slash '/' in a routing path: '${request.path}'`)
        let app = await this.getLoaded('application')
        return app.route(request)
    }

    systemURL() {
        /* Absolute base URL for system calls originating at a web client and targeting specific items. */
        return this.get('base_url') + this.get('system_path')
    }

    urlRaw(item) {
        /* Absolute raw URL for an `item`. TODO: reuse the AppSystem instead of the code below. */
        assert(item.has_id())
        let [cid, iid] = item.id
        return this.systemURL() + `/${cid}:${iid}`
    }

    // buildURL(item, {route, relative = true, baseURL, method, args} = {}) {
    //     /*
    //     Return a relative URL of `item` as assigned by the deep-most Application (if no `route`)
    //     that's processing the current web request; or an absolute or relative URL
    //     assigned by an application anchored at a given `route`.
    //     */
    //     // let url = this.urlPath(item, {route, relative, baseURL})
    //     let app  = this.registry.session.app
    //     app.assertLoaded()
    //     let path = app.urlPath(item)
    //     let url  = './' + path      // ./ informs the browser this is a relative path, even if dots and ":" are present similar to a domain name with http port
    //     if (method) url += Request.SEP_METHOD + method                  // append `method` and `args` to the URL
    //     if (args) url += '?' + new URLSearchParams(args).toString()
    //     return url
    //     // return this.setEndpoint(url, endpoint, args)
    // }

    // urlPath(item, {route, relative, baseURL}) {
    //
    //     // relative URL anchored at the deep-most application's route
    //     if (route === undefined) {
    //         let app  = this.registry.session.app
    //         app.assertLoaded()
    //         let path = app.urlPath(item, {relative})
    //         return './' + path      // ./ informs the browser this is a relative path, even if dots and ":" are present similar to a domain name with http port
    //     }
    //
    //     // NOTE: the code below is never used right now, all calls leave route=undefined (??)
    //
    //     // relative URL anchored at `route`
    //     let root = this.get('application'); root.assertLoaded()
    //     let path = root.urlPath(item, {route, relative})
    //     if (relative) return path
    //
    //     // absolute URL without base?
    //     path = '/' + path
    //     if (!baseURL) return path
    //
    //     // absolute URL with base (protocol+domain+port)
    //     let base = (typeof baseURL === 'string') ? baseURL : this.get('base_url')
    //     if (base.endsWith('/')) base = base.slice(-1)
    //     return base + path
    // }
    //
    // setEndpoint(url, endpoint, args) {
    //     if (endpoint) url += `${SEP_METHOD}${endpoint}`
    //     if (args) url += '?' + new URLSearchParams(args).toString()
    //     return url
    // }
}

export class Router extends Item {
    /* A set of named routes, possibly with an unnamed default route that's selected without path truncation. */

    async route(request) {
        /*
        Find an object in `routes` that matches the requested URL path and call its route().
        The path can be an empty string; if non-empty, it should start with SEP_ROUTE character.
        */
        let [app, subpath] = this._find(request.path)
        request.path = subpath
        await app.load()
        return app.route(request)
    }

    _find(path = '') {
        /* Make one step forward along a URL `path`. Return the object associated with the route and the remaining subpath. */
        let lead = 0, step

        // consume leading '/' (lead=1) when it's followed by text, but treat it as terminal
        // and preserve in a returned subpath otherwise
        if (path.startsWith(Request.SEP_ROUTE)) {
            lead = (path.length >= 2)
            step = path.slice(1).split(Request.SEP_ROUTE)[0]
        } else
            step = path.split(Request.SEP_ROUTE)[0]
        
        let routes = this.get('routes')
        let route  = routes.get(step)
        
        if (step && route)                          // non-default (named) route can be followed with / in path
            return [route, path.slice(lead + step.length)]
        
        if (routes.has(''))                         // default (unnamed) route has special format, no "/"
            return [routes.get(''), path]
        
        throw new Error(`URL path not found: ${path}`)
    }

    // urlPath(item, opts = {}) {
    //
    //     let [step, app, path] = this._route(opts.route)
    //     app.assertLoaded()
    //     // app.requestLoaded() -- if (!app.loaded) { session.itemsRequested.push(app); throw ... or return undefined }
    //     let subpath = app.urlPath(item, {...opts, route: path})
    //     if (opts.relative) return subpath                           // path relative to `route`
    //     let segments = [step, subpath].filter(Boolean)              // only non-empty segments
    //     return segments.join(SEP_ROUTE)                 // absolute path, empty segments excluded
    // }
}

export class Application extends Item {
    /*
    Application implements a bidirectional mapping of URL names to items and back.
    Typically, an application is placed as the leaf segment of a routing pattern,
    to provide naming & routing for an open set of dynamically created items ("item space")
    which do not have their own proper names. Usually, the application also provides methods
    (endpoints) for creating new items. Applications make sure the URL names are unique.

    Not every route must contain an application, rather it may be composed of statically-named segments alone.
    Also, there can be multiple applications on a particular route, for example, the route:

       /post/XXX/comment/YYY

    contains two applications: "posts" and "comments".
    Some applications may generate multi-segment hierarchical names (TODO).

    INFO what characters are allowed in URLs: https://stackoverflow.com/a/36667242/1202674
    */

    urlPath(item) {
        /*
        Generate a URL name/path (fragment after the base route string) of `item`.
        The path does NOT have a leading separator, or it has a different (internal) meaning -
        in any case, a leading separator should be inserted by caller if needed.
        */
        return undefined
    }

    name(item) {
        /* If `item` belongs to the item space defined by this application, return its flat name
           (no '/' or '@' characters) as assigned by the application. Otherwise, return undefined.
           The name can be used as a trailing component when building a URL for an item.
           TODO: support generation of multi-segment hierarchical names (with '/').
         */
        return undefined
    }
}

export class AppSystem extends Application {
    /* System space with admin interface. All items are accessible through the 'raw' routing pattern: /CID:IID */
    
    urlPath(item) {
        assert(item.has_id())
        let [cid, iid] = item.id
        return `${cid}:${iid}`
    }
    async route(request) {
        let item = await this._find_item(request.path)
        request.path = ''
        request.app = this
        return item.handle(request)
    }
    async _find_item(path) {
        /* Extract (CID, IID) from a raw URL of the form CID:IID, return as an item. */
        let id
        try { id = path.slice(1).split(':').map(Number) }
        catch (ex) { throw new Error(`URL path not found: ${path}`) }
        return this.registry.getLoaded(id)
    }
}

export class AppSpaces extends Application {
    /*
    Application for accessing individual objects (items) through verbose paths of the form: .../SPACE:IID,
    where SPACE is a text identifier assigned to a category in `spaces` property.
    */
    urlPath(item) {
        let spaces_rev = this.temp('spaces_rev')
        let space = spaces_rev.get(item.category.id)
        if (!space) return undefined
        //if (!space) throw new Error(`URL path not found for items of category ${item.category}`)
        return `${space}:${item.iid}`
    }
    _temp_spaces_rev()    { return ItemsMap.reversed(this.get('spaces')) }

    async route(request) {
        // decode space identifier and convert to a category object
        let category, [space, item_id] = request.path.slice(1).split(':')
        category = await this.getLoaded(`spaces/${space}`)
        if (!category) return request.session?.sendStatus(404)
        let item = category.getItem(Number(item_id))
        request.path = ''
        request.app = this
        return item.handle(request)
    }
}

/**********************************************************************************************************************
 **
 **  FILES & FOLDERS
 **
 */

export class File extends Item {
    read() { return this.get('content') }

    _handle_import({}) {
        return this.read()
    }

    _handle_download({res, request}) {
        this.setMimeType(res, request.pathFull)
        res.send(this.read())
    }
    setMimeType(res, path) {
        // use the `mimetype` property if present...
        let mimetype = this.get('mimetype')
        if (mimetype) return res.type(mimetype)

        // ...otherwise, set Content-Type to match the URL path's extension, like in .../file.EXT
        let name = path.split('/').pop()
        let ext  = name.split('.').pop()
        if (ext !== name) res.type(ext)
    }
}

export class FileLocal extends File {
    async read(encoding = 'utf8') {
        let fs = await import('fs')
        let path = this.get('path')
        if (path) return fs.readFileSync(path, {encoding})
    }
    _handle_download({res}) {
        let content = this.get('content')
        if (typeof content === 'string')
            return res.send(content)
        
        let path = this.get('path')
        if (!path) res.sendStatus(404)

        res.sendFile(path, {}, (err) => {if(err) res.sendStatus(err.status)})

        // TODO respect the "If-Modified-Since" http header like in django.views.static.serve(), see:
        // https://github.com/django/django/blob/main/django/views/static.py
    }
}

export class Folder extends Item {
    static SEP_FOLDER = '/'          // separator of folders in a file path

    async route(request) {
        /* Propagate a web request down to the nearest object pointed to by `path`.
           If the object is a Folder, call its route() with a truncated path. If the object is an item, call its handle().
         */
        let path = request.path
        if (path === '/') return request.session?.redirect(request.pathFull.slice(0,-1))    // truncate the trailing '/' in URL
        // if (!path.startsWith('/')) return request.session?.redirect(request.pathFull + '/')
        // TODO: make sure that special symbols, e.g. SEP_METHOD, are forbidden in file paths

        if (path.startsWith(Folder.SEP_FOLDER)) path = path.slice(1)
        let name = path.split(Folder.SEP_FOLDER)[0]
        let item = this

        if (name) {
            item = this.get(`files/${name}`)
            if (!item) throw new Error(`URL path not found: ${path}`)
            assert(item instanceof Item, `not an item: ${item}`)
            path = path.slice(name.length+1)
            await item.load()
        }

        if (item.get('_is_file')) {
            if (path) throw new Error('URL not found')
            request.methodDefault = 'download'
        }
        else if (item.get('_is_folder')) {
            // request.endpointDefault = 'browse'
            if (path) { request.path = path; return item.route(request) }
            else request.session.state.folder = item            // leaf folder, for use when generating file URLs (urlPath())
        }

        request.path = ''
        return item.handle(request)
    }

    // exists(path) {
    //     /* Check whether a given path exists in this folder. */
    // }
    search(path) {
        /*
        Find an object pointed to by `path`. The path may start with '/', but this is not obligatory.
        The search is performed recursively in subfolders.
        */
        if (path.startsWith(Folder.SEP_FOLDER)) path = path.slice(1)
        let item = this
        while (path) {
            let name = path.split(Folder.SEP_FOLDER)[0]
            item = item.get(`files/${name}`)
            path = path.slice(name.length+1)
        }
        return item
    }
    read(path) {
        /* Search for a File/FileLocal pointed to by a given `path` and return its content as a utf8 string. */
        let f = this.search(path)
        if (f instanceof File) return f.read()
        throw new Error(`not a File: ${path}`)
    }
    get_name(item) {
        /* Return a name assigned to a given item. If the same item is assigned multiple names,
        the last one is returned. */
        let names = this.temp('names')
        return names.get(item.id, null)
    }
    _temp_names()     { return ItemsMap.reversed(this.get('files')) }
}

export class FolderLocal extends Folder {

    async route(request) {
        /* Find `path` on the local filesystem and send the file pointed to by `path` back to the client (download).
           FolderLocal does NOT provide web browsing of files and nested folders.
         */
        let path = request.path
        if (path.startsWith(Folder.SEP_FOLDER)) path = path.slice(1)
        if (!path) {
            request.path = ''
            return this.handle(request)             // if no file `path` given, display this folder as a plain item
        }

        let root = this.get('path')
        if (!root) throw new Error('missing `path` property in a FolderLocal')
        if (!root.endsWith('/')) root += '/'

        let fspath   = await import('path')
        let fullpath = fspath.join(root, path)              // this interpretes and reduces the '..' symbols, so we have to check
        if (!fullpath.startsWith(root))                     // if the final path still falls under the `root`, for security
            throw new Error(`URL path not found: ${path}`)

        request.session.sendFile(fullpath, {}, (err) => {if(err) request.session.sendStatus(err.status)})
    }
    get_name(item) { return null }
}

