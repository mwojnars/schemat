import { print, assert, splitLast, T } from './utils.js'
import { ItemsMap } from './data.js'
import {Category, Item, Request} from './item.js'

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

export class Router extends Item {
    /* A set of named routes, possibly with unnamed default routes that are selected without path truncation. */

    async route(request) {
        let step   = request.step()
        let routes = this.get('routes')
        let node   = routes.get(step)
        if (step && node) return node.load().then(n => n.route(request.move(step)))
        // if (step && node) {
        //     await node.load()
        //     return await node.route(request.move(step))
        // }

        // check for empty '' route segment(s) in the routing table, there can be multiple ones;
        // try the first one, or proceed to the next one if NotFound is raised...
        for (let {value: node} of routes.getEmpty())
            try { return await node.load().then(n => n.route(request.copy())) }
            catch(ex) {
                if (!(ex instanceof Request.NotFound)) throw ex
            }

        request.throwNotFound()
    }

    // findRoute(request) {
    //     let step   = request.step()
    //     let routes = this.get('routes')
    //     let route  = routes.get(step)
    //     if (step && route)  return [route, request.move(step)]
    //     if (routes.has('')) return [routes.get(''), request]          // default (unnamed) route
    // }
}

export class Site extends Router {
    /* Global configuration of all applications that comprise this website, with URL routing etc. */

    static DOMAIN_LOCAL   = 'local:'        // for import paths that address physical files of the local Schemat installation
    static DOMAIN_SCHEMAT = 'schemat:'      // internal server-side domain name prepended to DB import paths for debugging

    async init()   { if (this.registry.onServer) this._vm = await import('vm') }

    async findItem(path) {
        /* URL-call that requests and returns an item pointed to by `path`.
           The request is handled by the target item's CALL_item() endpoint.
           The item is fully loaded (this is a prerequisite to calling CALL_*()).
         */
        return this.route(new Request({path, method: '@item'}))
    }

    async getRouteNode(route, strategy = 'last') {
        /* URL-call that returns an intermediate routing node installed at the `route` point of URL paths. */
        return this.routeNode(new Request({path: route}), strategy)
    }

    async getApplication(route, strategy = 'last') {
        /* URL-call to an application installed as a routing node at the end of `route` path. */
        let Application = await this.findItem('/system/Application')
        print('Application:', Application)
        let app = await this.getRouteNode(route, strategy)
        if (app.instanceof(Application)) return app
        throw new Request.NotFound("not an application")
    }

    async importModule(path, referrer) {
        /* Custom import of JS files and code snippets from Schemat's Universal Namespace (SUN). Returns a vm.Module object. */
        // TODO: cache module objects, parameter Site:cache_modules_ttl
        // TODO: for circular dependency return an unfinished module (use cache for this)

        assert(this.registry.onServer)

        // make `path` absolute
        if (path[0] === '.') {
            if (!referrer) throw new Error(`missing referrer for a relative import path: '${path}'`)
            path = referrer.identifier + '/../' + path          // referrer is a vm.Module
        }

        // path normalize: drop "schemat:", convert '.' and '..' segments
        path = this._unprefix(path)
        path = this._normPath(path)

        // standard local import for non-SUN paths
        if (path[0] !== '/') return this.localImport(path)

        // local import if `path` starts with PATH_LOCAL_SUN
        let local = this.registry.PATH_LOCAL_SUN
        if (path.startsWith(local + '/'))
            return this.localImport(this.registry.directImportPath(path))

        let source = await this.route(new Request({path, method: '@text'}))
        if (!source) throw new Error(`Site.importModule(), path not found: ${path}`)

        return this.parseModule(source, path)
    }

    async localImport(path) {
        /* Import a module from the local installation (server-side) using standard import(); return a vm.SyntheticModule. */
        print('localImport() path:', path)
        const vm    = this._vm
        let local   = await import(path)
        let context = vm.createContext(globalThis)
        let module  = new vm.SyntheticModule(
            Object.keys(local),
            function() { Object.entries(local).forEach(([k, v]) => this.setExport(k, v)) },
            {context, identifier: Site.DOMAIN_LOCAL + path}
        )
        await module.link(() => {})
        await module.evaluate()
        return {...module.namespace, __vmModule__: module}
    }

    async parseModule(source, path) {

        const vm = this._vm
        let context = vm.createContext(globalThis)
        // let context = referrer?.context || vm.createContext({...globalThis, importLocal: p => import(p)})
        // submodules must use the same^^ context as referrer (if not globalThis), otherwise an error is raised

        let identifier = Site.DOMAIN_SCHEMAT + path
        let linker = async (specifier, ref, extra) => (await this.importModule(specifier, ref)).__vmModule__
        let initializeImportMeta = (meta) => {meta.url = identifier}

        let module = new vm.SourceTextModule(source, {context, identifier, initializeImportMeta, importModuleDynamically: linker})

        await module.link(linker)
        await module.evaluate()
        return {...module.namespace, __vmModule__: module}
    }

    _unprefix(path) { return path.startsWith(Site.DOMAIN_SCHEMAT) ? path.slice(Site.DOMAIN_SCHEMAT.length) : path }

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

    /*** Processing requests & URL generation ***/

    routeWeb(session) {
        /* Convert a web request to an internal Request and process it through route(). */
        let request = new Request({session, path: session.path})
        return this.route(request)
    }

    // findRoute(request) {
    //     return request.path ?
    //         [this.get('router'), request, false] :
    //         [this.get('empty_path'),  request,  true]
    // }

    systemURL() {
        /* Absolute base URL for system calls originating at a web client and targeting specific items. */
        return this.get('URL') + this.get('path_internal')
    }
    systemPath(item) {
        /* Default absolute URL path ("system path") of the item. No domain. */
        assert(item.has_id())
        let [cid, iid] = item.id
        return this.get('path_internal') + `/${cid}:${iid}`
    }

    urlRaw(item) {
        /* Absolute raw URL for an `item`. TODO: reuse the AppBasic instead of the code below. */
        return this.get('URL') + this.systemPath(item)
    }
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

    contains two applications: "posts" and "comments". Some applications may generate multi-segment names.

    INFO what characters are allowed in URLs: https://stackoverflow.com/a/36667242/1202674
    */

    address(item) {
        /* If `item` belongs to the item space defined by this application, return its URL subpath
           (no leading '/') to be appended to a route when building a URL. Otherwise, return undefined.
         */
    }
    // urlPath(item) {
    //     /* Generate a URL name/path (fragment after the base route string) of `item`.
    //        The path does NOT have a leading separator, or it has a different (internal) meaning -
    //        in any case, a leading separator should be inserted by caller if needed.
    //      */
    //     let func = this.urlPath = this.parseMethod('urlPath', 'item')
    //     return func.call(this, item)
    // }
    // findRoute(request)  {
    //     // findRoute() is parsed dynamically from source on the 1st call and stored in `this` -
    //     // not in a class prototype like `code` (!); after that, all calls go directly to the new function
    //     let func = this.findRoute = this.parseMethod('findRoute', 'request')
    //     return func.call(this, request)
    // }
}


export class AppBasic extends Application {
    /* System space with admin interface. All items are accessible through the 'raw' routing pattern: /CID:IID */

    urlPath(item) {
        assert(item.has_id())
        let [cid, iid] = item.id
        return `${cid}:${iid}`
    }
    findRoute(request) {
        /* Extract (CID, IID) from a raw URL path of the form CID:IID. */
        let step = request.step(), id
        try {
            id = step.split(':').map(Number)
            assert(id[0] !== undefined && id[1] !== undefined)
        }
        catch (ex) { request.throwNotFound() }
        // request.pushMethod('@full')
        return [this.registry.getItem(id), request.move(step), true]
    }
}

export class AppSpaces extends Application {
    /*
    Application for accessing individual objects (items) through verbose paths of the form: .../SPACE:IID,
    where SPACE is a text identifier assigned to a category in `spaces` property.
    */
    urlPath(item) {
        let spaces_rev = this.spacesRev()
        let space = spaces_rev.get(item.category.id)
        if (space) return `${space}:${item.iid}`
    }
    spacesRev() { return ItemsMap.reversed(this.get('spaces')) }

    findRoute(request) {
        let step = request.step()
        let [space, item_id] = step.split(':')
        let category = this.get(`spaces/${space}`)          // decode space identifier and convert to a category object
        if (!category) request.throwNotFound()
        let item = category.load().then(c => c.getItem(Number(item_id)))
        return [item, request.pushApp(this).move(step), true]
    }
}

AppSpaces.setCaching('spacesRev')


/**********************************************************************************************************************
 **
 **  FILES & FOLDERS
 **
 */

export class File extends Item {

    process(content) {
        /* Optional processing (e.g., transpiling, compaction) of this file before it gets sent to a client/caller.
           Can be overriden by subclasses.
         */
        return content
    }
    content() {
        /* Initial raw content of this file before any processing. */
        return this.get('content')
    }
    read() {
        /* Final post-processed (e.g., transpiled, compacted) content of this file. */
        return this.process(this.content())
    }

    CALL_text({request}) {
        /* Plain text of this File for Site.import() etc. */
        let txt = this.read()
        if (txt === undefined) request.throwNotFound()
        return txt
    }

    // async CALL_import({request}) {
    //     /* Parse the file as a JS module. Return the module, or a selected symbol if request.path is non-empty.
    //        A function for parsing module's source code, parse(source), must be passed in `args` by the caller,
    //        as well as a function for reloading the module from cache without parsing, loadCached(route).
    //      */
    //     let {loadCached, parse} = request.args
    //     let module = loadCached(request.route) || parse(this.read())
    //     if (!request.path) return module
    //
    //     let symbol = request.step()
    //     if (request.move().path) request.throwNotFound()
    //     return module[symbol]
    // }

    GET_default(args) { return this.GET_file(args) }

    GET_file({res, request}) {                      // plain text sent over HTTP with a MIME type inferred from URL file extension (!)
        this.setMimeType(res, request.pathFull)
        let txt = this.read()
        if (txt === undefined) request.throwNotFound()
        res.send(txt)
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

File.setCaching('read')


export class FileLocal extends File {
    async init()   { if (this.registry.onServer) this._fs = await import('fs') }

    content(encoding) {
        let path = this.get('path')
        if (path) return this._fs.readFileSync(path, {encoding})
    }

    // GET_file({res}) {
    //     let path = this.get('path')
    //     res.sendFile(path, {}, (err) => {if(err) res.sendStatus(err.status)})
    //
    //     // TODO respect the "If-Modified-Since" http header like in django.views.static.serve(), see:
    //     // https://github.com/django/django/blob/main/django/views/static.py
    // }
}

export class Folder extends Item {

    findRoute(request) {
        let step = request.step()
        if (!step) return [this, request, true]         // mark this folder as the target node of the route (true)
        let item = this.get(`files/${step}`)
        // request.pushMethod('@file')                     // if `item` doesn't provide @file method, its default one will be used
        return [item, request.move(step), item => !(item instanceof Folder)]
    }
}

export class FolderLocal extends Folder {

    async init() {
        if (this.registry.onServer) {
            this._mod_fs = await import('fs')
            this._mod_path = await import('path')        // to avoid awaiting in handlePartial()
        }
    }

    findRoute(request) {
        // always mark this folder as a target: either to display it (empty path), or to pass the execution to .handlePartial()
        return [this, request, true]
    }

    handlePartial(request) {
        let root = this.get('path')
        root = this._mod_path.resolve(root)                     // make `root` an absolute path
        if (!root) throw new Error('missing `path` property in a FolderLocal')
        let path = this._mod_path.join(root, request.path)      // this reduces the '..' special symbols, so we have to check
        if (!path.startsWith(root)) request.throwNotFound()     // if the final path still falls under the `root`, for security
        if (request.session) request.session.sendFile(path)
        else return this._mod_fs.readFileSync(path, {encoding: 'utf8'})
    }
}

