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

        let source = await this.route(new Request({path, method: 'text'}))
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

    /*** Processing requests & URL generation ***/

    async routeWeb(session) {
        /* Convert a web request to an internal Request and process it through route(). */
        let request = new Request({session, path: session.path})
        return this.route(request)
    }

    findRoute(request) {
        return request.path ?
            [this.get('application'), request, false] :
            [this.get('empty_path'),  request,  true]
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
}

export class Router extends Item {
    /* A set of named routes, possibly with an unnamed default route that's selected without path truncation. */

    findRoute(request) {
        let step   = request.step()
        let routes = this.get('routes')
        let route  = routes.get(step)
        if (step && route)  return [route, request.move(step)]
        if (routes.has('')) return [routes.get(''), request]          // default (unnamed) route
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

    urlPath(item) {
        /* Generate a URL name/path (fragment after the base route string) of `item`.
           The path does NOT have a leading separator, or it has a different (internal) meaning -
           in any case, a leading separator should be inserted by caller if needed.
         */
    }
    name(item) {
        /* If `item` belongs to the item space defined by this application, return its flat name
           (no '/' or '@' characters) as assigned by the application. Otherwise, return undefined.
           The name can be used as a trailing component when building a URL for an item.
         */
    }
}

export class AppSystem extends Application {
    /* System space with admin interface. All items are accessible through the 'raw' routing pattern: /CID:IID */
    
    urlPath(item) {
        assert(item.has_id())
        let [cid, iid] = item.id
        return `${cid}:${iid}`
    }
    findRoute(request) {
        /* Extract (CID, IID) from a raw URL path of the form CID:IID. */
        let step = request.step(), id
        try { id = step.split(':').map(Number) }
        catch (ex) { request.throwNotFound() }
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

    findRoute(request) {
        request.methodDefault = 'file'
        return [this, request, true]                // "true": mark every File as a target node of a URL route
    }

    read()          { return this.get('content') }
    CALL_text()     { return this.read() }          // plain text of this File for Site.import() etc.

    GET_file({res, request}) {                      // plain text sent over HTTP with a MIME type inferred from URL file extension (!)
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
    GET_file({res}) {
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

    findRoute(request) {
        let step = request.step()
        if (!step) return [this, request, true]         // mark this folder as the target node of the route (true)
        let item = this.get(`files/${step}`)
        return [item, request.move(step)]
    }
}

export class FolderLocal extends Folder {

    async afterLoad(data) {
        if (this.registry.onServer)
            this._module_path = await import('path')        // to avoid awaiting in handlePartial()
    }

    findRoute(request) {
        // always mark this folder as a target: either to display it (empty path), or to pass the execution to .handlePartial()
        return [this, request, true]
    }

    handlePartial(request) {
        let root = this.get('path')
        if (!root) throw new Error('missing `path` property in a FolderLocal')
        let path = this._module_path.join(root, request.path)   // this reduces the '..' special symbols, so we have to check
        if (!path.startsWith(root)) request.throwNotFound()     // if the final path still falls under the `root`, for security
        request.session.sendFile(path)
    }
}

