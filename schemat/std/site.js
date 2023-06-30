import { print, assert, T } from '../utils.js'
import { Item, Request } from '../item.js'


// Currently, vm.Module (Site.importModule()) cannot import builtin modules, as they are not instances of vm.Module.
// For this reason, importLocal() is added to the global context, so that the modules imported from DB can use it
// as an alias for standard (non-VM) import(). Adding this function in a call to vm.createContext() instead of here raises errors.

globalThis.importLocal = (p) => import(p)


/**********************************************************************************************************************
 **
 **  ROUTER & SITE items
 **
 */

export class Router extends Item {
    /* A set of named routes, possibly with unnamed default routes that are selected without path truncation. */

    async route(request) {
        let step   = request.step()
        let routes = this.prop('routes')
        let node   = routes.get(step)
        if (step && node) return node.load().then(n => n.route(request.move(step)))

        // check for empty '' route segment(s) in the routing table, there can be multiple ones;
        // try the first one, or proceed to the next one if NotFound is raised...
        let lastEx
        let defaultRoutes = routes.getEmpty()
        for (let {value: defaultNode} of defaultRoutes)
            try { return await defaultNode.load().then(n => n.route(request.copy())) }
            catch(ex) {
                if (!(ex instanceof Request.PathNotFound)) throw ex
                lastEx = ex
            }

        if (lastEx) throw lastEx
        request.throwNotFound()
    }

    // findRoute(request) {
    //     let step   = request.step()
    //     let routes = this.prop('routes')
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
        throw new Request.PathNotFound("not an application")
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
    //         [this.prop('router'), request, false] :
    //         [this.prop('empty_path'),  request,  true]
    // }

    systemURL() {
        /* Absolute base URL for system calls originating at a web client and targeting specific items. */
        return this.prop('URL') + this.prop('path_internal')
    }
    systemPath(item) {
        /* Default absolute URL path ("system path") of the item. No domain. */
        assert(item.has_id())
        return this.prop('path_internal') + `/${item.id}`
    }

    urlRaw(item) {
        /* Absolute raw URL for an `item`. TODO: reuse the AppBasic instead of the code below. */
        return this.prop('URL') + this.systemPath(item)
    }
}

