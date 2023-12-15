import {set_global} from "../common/globals.js"
import {print, assert, T, delay} from '../common/utils.js'
import {UrlPathNotFound} from "../common/errors.js"
import {ItemProxy, Request} from '../item.js'
import {Container, Directory, ID_Namespace} from "./urls.js";


// Currently, vm.Module (Site.importModule()) cannot import builtin modules, as they are not instances of vm.Module.
// For this reason, importLocal() is added to the global context, so that the modules imported from DB can use it
// as an alias for standard (non-VM) import(). Adding this function in a call to vm.createContext() instead of here raises errors.

set_global({importLocal: (p) => import(p)})


/**********************************************************************************************************************
 **
 **  ROUTER & SITE items
 **
 */

// export class Router extends Item {
//     /* A set of named routes, possibly with unnamed default routes that are selected without path truncation. */
//
//     async route(request) {
//         let step   = request.step()
//         let routes = this.routes
//
//         let node   = routes.get(step)
//         if (step && node) return node.load().then(n => n.route(request.move(step)))
//
//         // check for empty '' route segment(s) in the routing table, there can be multiple ones;
//         // try the first one, or proceed to the next one if NotFound is raised...
//         let lastEx
//         let defaultRoutes = routes.getEmpty()
//         for (let {value: defaultNode} of defaultRoutes)
//             try { return await defaultNode.load().then(n => n.route(request.copy())) }
//             catch(ex) {
//                 if (!(ex instanceof UrlPathNotFound)) throw ex
//                 lastEx = ex
//             }
//         if (lastEx) throw lastEx
//
//         // for (let {key: name, value: node} of routes) {
//         //
//         //     // empty route? don't consume any part of the request path; step into the (Directory) node
//         //     // only if it may contain the `step` sub-route
//         //     if (!name) {
//         //         if (!node.is_loaded()) await node.load()
//         //         assert(node instanceof Directory, "empty route can only point to a Directory or Namespace")
//         //         if (node.contains(step)) return node.route(request)
//         //         else continue
//         //     }
//         //     if (name === step) {
//         //         if (!node.is_loaded()) await node.load()
//         //         return node.route(request.move(step))
//         //     }
//         // }
//
//         request.throwNotFound()
//     }
//
//     // findRoute(request) {
//     //     let step   = request.step()
//     //     let routes = this.routes
//     //     let route  = routes.get(step)
//     //     if (step && route)  return [route, request.move(step)]
//     //     if (routes.has('')) return [routes.get(''), request]          // default (unnamed) route
//     // }
// }

export class Site extends Directory {
    /* Global configuration of all applications that comprise this website, with URL routing etc.
       A route whose name starts with asterisk (*NAME) is treated as blank.
     */

    static DOMAIN_LOCAL   = 'local:'        // for import paths that address physical files of the local Schemat installation
    static DOMAIN_SCHEMAT = 'schemat:'      // internal server-side domain name prepended to DB import paths for debugging

    // properties:
    base_url
    entries
    default_path


    async __init__()  {
        if (registry.onClient) return
        this._vm = await import('vm')
        this._check_default_container()                 // no await to avoid blocking the site's startup
    }

    async _check_default_container() {
        while (!registry.site) await delay()
        let default_container = await this.resolve(this.default_path)

        // check that default_path maps to a container...
        assert(default_container instanceof Container, `default_path ('${this.default_path}') is incorrect and does not map to a container`)

        // ...and that this container is an ID_Namespace, so it is compatible with the URL generation on the client
        assert(default_container instanceof ID_Namespace, `the container [${this._id_}] at the default path ('${this.default_path}') must be an ID_Namespace`)
    }

    async _init_url() {
        let url = new URL(this.base_url)            // remove domain name from the base URL and keep the remaining URL path
        // this._url_  = url.pathname
        // this._path_ = url.pathname
        this._url_ = this._path_ = '/'
        assert(this._url_[0] === '/', `incorrect base URL: ${this.base_url}`)
        // print('Site._init_url():', this._url_)
    }

    path_to_url(path) {
        /* Convert a container access path to a URL path by removing all blank segments (/*xxx).
           NOTE 1: if the last segment is blank, the result URL can be a duplicate of the URL of a parent or ancestor container (!);
           NOTE 2: even if the last segment is not blank, the result URL can still be a duplicate of the URL of a sibling object,
                   if they both share an ancestor container with a blank segment. This cannot be automatically detected
                   and should be prevented by proper configuration of top-level containers.
         */
        let last = path.split('/').pop()
        let last_blank = last.startsWith('*')               // if the last segment is blank, the URL is a duplicate of a parent's URL
        let url = path.replace(/\/\*[^/]*/g, '')
        return [url, last_blank]
    }

    async resolve(path, explicit_blank = false) {
        if (path[0] === '/') path = path.slice(1)           // drop the leading slash
        if (!path) return this
        let step = path.split('/')[0]
        let rest = path.slice(step.length + 1)

        for (let {key: name, value: node} of this.entries) {

            assert(name, "route name must be non-empty; use *NAME for a blank route to be excluded in public URLs")
            let blank = (name[0] === '*')

            // blank route? only consume the `step` and truncate the request path if explicit_blank=true;
            // step into the nested Container only if it potentially contains the `step`
            if (blank) {
                if (!node.is_loaded()) await node.load()
                assert(node instanceof Container, "blank route can only point to a Container (Directory, Namespace)")
                if (explicit_blank) return rest ? node.resolve(rest, explicit_blank) : node
                if (node.contains(step)) return node.resolve(path, explicit_blank)
            }
            else if (name === step) {
                if (!node.is_loaded()) await node.load()
                if (node instanceof Container && rest) return node.resolve(rest, explicit_blank)
                else if (rest) throw new UrlPathNotFound({path})
                else return node
            }
        }
        throw new UrlPathNotFound({path})
    }

    async findItem(path) {
        /* URL-call that requests and returns an item pointed to by `path`.
           The request is handled by the target item's CALL_item() endpoint.
           The item is fully loaded (this is a prerequisite to calling CALL_*()).
         */
        // return Request.run_with({path, method: '@item'}, () => this.route(request))
        return this.route(new Request({path, method: '@item'}))
    }

    async route(request, explicit_blank = false) {
        /* Find the object pointed by the request's URL path and execute its endpoint function. */
        let path = request.path.slice(1)                // drop the leading slash
        let object = request.item = await this.resolve(path, explicit_blank)

        // if (path !== object.url()) {
        //     // TODO: redirect to the canonical URL
        // }

        request.path = ''
        return object.handle(request)
    }

    // async route(request) {
    //     /* Use the thread-global `request` to find the target item and execute its endpoint function. */
    //     let step = request.step()
    //     for (let {key: name, value: node} of this.routes) {
    //
    //         // empty route? don't consume any part of the request path; step into the (Directory) node
    //         // only if it may contain the `step` sub-route
    //         if (!name) {
    //             if (!node.is_loaded()) await node.load()
    //             assert(node instanceof Container, "empty route can only point to a Directory or Namespace")
    //             if (node.contains(step)) return node.route(request)
    //             else continue
    //         }
    //         if (name === step) {
    //             if (!node.is_loaded()) await node.load()
    //             return node.route(request.move(step))
    //         }
    //     }
    //     request.throwNotFound()
    // }

    // async getRouteNode(route, strategy = 'last') {
    //     /* URL-call that returns an intermediate routing node installed at the `route` point of URL paths. */
    //     return this.routeNode(new Request({path: route}), strategy)
    // }
    //
    // async getApplication(route, strategy = 'last') {
    //     /* URL-call to an application installed as a routing node at the end of `route` path. */
    //     let Application = await this.findItem('/system/Application')
    //     print('Application:', Application)
    //     let app = await this.getRouteNode(route, strategy)
    //     if (app.instanceof(Application)) return app
    //     throw new UrlPathNotFound("not an application")
    // }

    async importModule(path, referrer) {
        /* Custom import of JS files and code snippets from Schemat's Universal Namespace (SUN). Returns a vm.Module object. */
        // TODO: cache module objects, parameter Site:cache_modules_ttl
        // TODO: for circular dependency return an unfinished module (use cache for this)

        assert(registry.onServer)

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
        let local = registry.PATH_LOCAL_SUN
        if (path.startsWith(local + '/'))
            return this.localImport(registry.directImportPath(path))

        // let source = await Request.run_with({path, method: '@text'}, () => this.route(request))
        let source = await this.route(new Request({path, method: '@text'}))
        if (!source) throw new Error(`Site.importModule(), path not found: ${path}`)

        return this.parseModule(source, path)
    }

    async localImport(path) {
        /* Import a module from the local installation (server-side) using standard import(); return a vm.SyntheticModule. */
        // print('localImport() path:', path)
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
        /* Drop single dots '.' occurring as `path` segments; truncate parent segments wherever '..' occur. */
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

    default_path_of(object_or_id) {
        /* Default absolute URL path ("system path") of a given object. Starts with '/', no domain.
           This function assumes that the container pointed to by the `default_path` is an ID_Namespace,
           otherwise the URL returned may be incorrect (!). See _check_default_container().
         */
        let id = typeof object_or_id === 'number' ? object_or_id : object_or_id._id_
        return this.default_path + `/${id}`
        // item.assert_linked()
        // return this.default_path + `/${item._id_}`
    }
}

