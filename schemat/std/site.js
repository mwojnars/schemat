import {print, assert, T, delay, splitLast, normalizePath} from '../common/utils.js'
import {UrlPathNotFound} from "../common/errors.js"
import {Request} from '../web/request.js'
import {WebObject} from '../core/object.js'
import {ObjectSpace} from "./containers.js";
import {JsonPOST} from "../web/services.js";
import {mDataRecord, mJsonx} from "../web/messages.js";


// Currently, vm.Module (Site.import_module()) cannot import builtin modules, as they are not instances of vm.Module.
// For this reason, importLocal() is added to the global context, so that the modules imported from DB can use it
// as an alias for standard (non-VM) import(). Adding this function in a call to vm.createContext() instead of here raises errors.

// set_global({importLocal: (p) => import(p)})


/**********************************************************************************************************************
 **
 **  ROUTER & SITE items
 **
 */

export class Site extends WebObject {
    /* Global configuration of all applications that comprise this website, with URL routing etc.
       A route whose name starts with asterisk (*NAME) is treated as blank.
     */

    // static DOMAIN_LOCAL   = 'local:'        // for import paths that address physical files of the local Schemat installation
    // static DOMAIN_SCHEMAT = 'schemat:'      // internal server-side domain name prepended to DB import paths for debugging
    // static URL_SCHEMAT = '/$/schemat'       // url-path of the root of Schemat source code

    static URL_LOCAL = '/$/local'           // url-path of the application's local filesystem root folder

    // properties:
    root
    global
    database
    default_path
    cache_purge_interval


    async __init__()  {
        this._modules_cache = new Map()
        if (SERVER) {
            await this.root.load()
            await this.database?.load()
            this._vm = await import('node:vm')
            this._check_default_container()                 // no await to avoid blocking the site's startup
        }
    }

    async _check_default_container() {
        while (!schemat.site) await delay()
        let default_container = await this.resolve(this.default_path.slice(1))

        // check that default_path maps to a container...
        assert(default_container?._is_container, `default_path ('${this.default_path}') is incorrect and does not map to a container`)

        // ...and that this container is an ObjectSpace, so it is compatible with the URL generation on the client
        assert(default_container.__category.name === 'ObjectSpace', `container [${this.__id}] at the default path ('${this.default_path}') must be an ObjectSpace`)
    }

    async load_globals() {
        /* Load objects listed in [global] property and make them globally available for application code. */
        for (let [name, object] of this.global || [])
            try { globalThis[name] = await object.load() }
            catch (e) {
                print(`Site: failed to load global object '${name}'`)
            }
    }


    /***  URL / URL-path / local file-path conversions  ***/

    default_path_of(object_or_id) {
        /* Default absolute URL path ("system path") of a given object. Starts with '/', no domain.
           This function assumes that the container pointed to by the `default_path` is an ObjectSpace,
           otherwise the URL returned may be incorrect (!). See _check_default_container().
         */
        let id = typeof object_or_id === 'number' ? object_or_id : object_or_id.__id
        return this.default_path + `/${id}`
    }

    get_file_url(path) {
        /* Convert a local file path to its corresponding URL-path (href=...). Typically used for loading assets on the client. */
        if (path.startsWith('file://')) path = path.slice(7)                // trim leading 'file://' if present
        let root = schemat.ROOT_DIRECTORY
        if (!path.startsWith(root + '/')) throw new Error(`path is not accessible via URL: ${path}`)
        return path.replace(root, Site.URL_LOCAL)
    }

    get_module_url(path) {
        /* Convert a local import path, like "schemat/.../file.js" to a URL-path that can be used with import() on the client. */
        if (path[0] === '/') throw new Error(`cannot make an import URL-path for an absolute local path: ${path}`)
        return `${Site.URL_LOCAL}/${path}::import`          // ::import is sometimes needed to get the proper MIME header, esp. if target is a web object not a local file
    }

    import_local(path) {
        /* Import from a local `path` of the form ".../file.js" or ".../file.js:ClassName", pointing to a module or symbol
           inside the project's root folder which should include both Schemat and application's source code.
           This method can be called both on the server and on the client (!). In the latter case, the import path
           is converted to a URL of the form "/$/local/.../file.js::import". May return a Promise.
         */
        // print(`Site.import():  ${path}`)
        let [file_path, symbol] = splitLast(path || '', ':')
        let import_path = CLIENT ? this.get_module_url(file_path) : schemat.ROOT_DIRECTORY + '/' + file_path

        // print(`...importing:  ${import_path}`)
        let module = this._modules_cache.get(import_path)           // first, try taking the module from the cache - returns immediately
        if (module) return symbol ? module[symbol] : module

        return import(import_path).then(mod => {                    // otherwise, import the module and cache it - this returns a Promise
            this._modules_cache.set(import_path, mod)
            return symbol ? mod[symbol] : mod
        })
    }

    import_global(path, referrer = null) {
        /* Import from an absolute URL path in the SUN namespace, like "/$/sys/Revision" etc.
           TODO: The path must not contain any endpoint (::xxx), but it may contain an in-module selector (:symbol)
         */
        if (path[0] === '.')                // convert a relative URL path to an absolute one
            path = normalizePath(referrer.__url + '/' + path)

        assert(path[0] === '/')
        return this.route_local(path)
    }


    /***  Request resolution  ***/

    // async find_object(path) {
    //     /* URL-call that requests and returns an item pointed to by `path`. The item is fully loaded. */
    //     // return this.route(new Request({path, method: '::item'}))
    //     assert(path[0] === '/')
    //     return this.route_local(path)
    // }

    async route_local(path) {
        /* URL-call to a LOCAL/* endpoint of an object identified by a URL `path`.
           The path should contain an endpoint name, otherwise the default endpoint is used.
         */
        return this.route(new Request({path}))
        // return Request.run_with({path}, () => this.route(request))
    }

    async route(request) {
        /* Find the object pointed to by the request's URL path and execute its endpoint function through handle(). */
        let path = request.path.slice(1)                // drop the leading slash
        let object = await this.resolve(path)
        if (!object) throw new UrlPathNotFound({path})

        if (typeof object === 'function') return object(request)        // `object` can be a tail function, just call it then
        if (!object.is_loaded()) await object.load()

        // if (path !== object.url()) {
        //     // TODO: redirect to the canonical URL
        // }

        return object.__handle__(request)
    }

    async resolve(path) { return this.root.resolve(path) }


    /***  Endpoints  ***/

    'POST.insert'() {
        /* Insert new object(s) to DB with __data initialized from the provided JSONx-stringified representation(s).
           `data` is either an array of content objects, one for each web object to be created; or a single content object.
           Every content object is a Catalog instance or the state of such instance (the result of .__getstate__()).
           Respond is an array of {id, data} records, one for each object created, in the same order as in the request.
         */
        return new JsonPOST({
            server: ({data, opts}) => this.database.insert(data, opts),
            input:  mJsonx,
            output: mDataRecords,
        })
    }

    'POST.create_object'() {
        /* Create a new object with __data initialized from the provided JSONx-stringified representation. */
        return new JsonPOST({
            server: ({data, opts}) => this.database.insert(data, opts),
            input:  mJsonx,
            output: mDataRecord,
        })
    }

    'POST.submit_edits'() {
        /* Submit a list of object edits to the DB. Each plain edit is an array: [op, ...args], where `op` is the name
           of the edit.<name>() operation to be executed, and `args` are 0+ arguments to be passed to the operation.
         */
        return new JsonPOST({
            server: (id, ...edits) => this.database.update(id, ...edits),
            output: mDataRecord,
        })
    }

    'POST.delete_object'() {
        return new JsonPOST({
            server: (id) => this.database.delete(id)
        })
    }


    /***  Dynamic imports  ***/

    // async import_module(path, referrer) {
    //     /* Custom import of JS files and code snippets from Schemat's Uniform Namespace (SUN). Returns a vm.Module object. */
    //     // TODO: cache module objects, parameter Site:cache_modules_ttl
    //     // TODO: for circular dependency return an unfinished module (use cache for this)
    //
    //     print(`import_module():  ${path}  (ref: ${referrer?.identifier})`)    //, ${referrer?.schemat_import}, ${referrer?.referrer}
    //
    //     // on a client, use standard import() via a URL, which still may point to a (remote) SUN object - no special handling needed
    //     if(CLIENT) return import(this._js_import_url(path))
    //
    //     // make `path` absolute
    //     if (path[0] === '.') {
    //         if (!referrer) throw new Error(`missing referrer for a relative import path: '${path}'`)
    //         path = referrer.identifier + '/../' + path          // referrer is a vm.Module
    //     }
    //
    //     // path normalize: drop "schemat:", convert '.' and '..' segments
    //     path = this._unprefix(path)
    //     path = this._normalize(path)
    //
    //     // standard JS import from non-SUN paths
    //     if (path[0] !== '/') return this._import_synthetic(path)
    //
    //     let module = schemat.registry.get_module(path)
    //     if (module) {
    //         print(`...from cache:  ${path}`)
    //         return module
    //     }
    //
    //     // // JS import if `path` starts with PATH_LOCAL_SUN; TODO: no custom linker configured in _import_synthetic(), why ??
    //     // let local = schemat.PATH_LOCAL_SUN
    //     // if (path.startsWith(local + '/'))
    //     //     return this._import_synthetic(this._js_import_file(path))
    //
    //     let source = await this.route_local(path + '::text')
    //     if (!source) throw new Error(`Site.import_module(), path not found: ${path}`)
    //
    //     module = await this._parse_module(source, path)
    //     print(`...from source:  ${path}`)
    //
    //     return module
    // }
    //
    // async _import_synthetic(path) {
    //     /* Import a module using standard import(), but return it as a vm.SyntheticModule (not a regular JS module). */
    //     // print('_import_synthetic() path:', path)
    //     const vm    = this._vm
    //     let mod_js  = await import(path)
    //     let context = vm.createContext(globalThis)
    //     let module  = new vm.SyntheticModule(
    //         Object.keys(mod_js),
    //         function() { Object.entries(mod_js).forEach(([k, v]) => this.setExport(k, v)) },
    //         {context, identifier: Site.DOMAIN_LOCAL + path}
    //     )
    //     await module.link(() => {})
    //     await module.evaluate()
    //     return {...module.namespace, __vmModule__: module}
    // }
    //
    // async _parse_module(source, path) {
    //
    //     const vm = this._vm
    //     // let context = vm.createContext(globalThis)
    //     // let context = referrer?.context || vm.createContext({...globalThis, importLocal: p => import(p)})
    //     // submodules must use the same^^ context as referrer (if not globalThis), otherwise an error is raised
    //
    //     let identifier = Site.DOMAIN_SCHEMAT + path
    //     let linker = async (specifier, ref, extra) => (print(specifier, ref) || await this.import_module(specifier, ref)).__vmModule__
    //     let initializeImportMeta = (meta) => {meta.url = identifier}   // also: meta.resolve = ... ??
    //
    //     let module = new vm.SourceTextModule(source, {identifier, initializeImportMeta, importModuleDynamically: linker})    //context,
    //
    //     let flat_module = {__vmModule__: module}
    //     schemat.registry.set_module(path, flat_module)      // the module must be registered already here, before linking, to handle circular dependencies
    //
    //     await module.link(linker)
    //     await module.evaluate()
    //
    //     Object.assign(flat_module, module.namespace)
    //     return flat_module
    //     // return {...module.namespace, __vmModule__: module}
    // }
}

