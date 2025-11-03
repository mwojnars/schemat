
export class Application extends WebObject {

    /*** Legacy routing ***/

    // async find_object(path) {
    //     /* URL-call that requests and returns an item pointed to by `path`. The item is fully loaded. */
    //     // return this.route(new WebRequest({path}))
    //     assert(path[0] === '/')
    //     return this.route_local(path)
    // }

    async route_local(path) {
        /* URL-call to a LOCAL/* endpoint of an object identified by a URL `path`.
           The path should contain an endpoint name, otherwise the default endpoint is used.
         */
        return this.route(new WebRequest({path}))
        // return WebRequest.run_with({path}, () => this.route(request))
    }

    async route(request) {
        /* Find the object pointed to by the request's URL path and execute its endpoint function through handle(). */

        let handled = await this._route_file_based(request)
        if (handled) return

        this._print(`app.route() LEGACY ROUTE:`, request.req.url)
        let path = request.path.slice(1)                // drop the leading slash
        let object = await this.resolve(path)
        if (!object) throw new URLNotFound({path})

        if (typeof object === 'function') return object(request)        // `object` can be a tail function, just call it then
        if (!object.is_loaded()) await object.load()

        // if (path !== object.get_url()) {
        //     // TODO: redirect to the canonical URL
        // }
        request.set_target(object)

        return object._handle_request(request)      // a promise
    }

    /***  Endpoints & Actions  ***/

    'POST.server'() {
        /* Run eval(code) on the server and return a JSONx-encoded result; `code` is a string.
           Any locally created data modifications are implicitly saved at the end unless the code raised an error.
         */
        return new JsonPOST({
            server: async (code, in_tx = false) => {
                if (!this.eval_allowed) throw new Error(`custom server-side code execution is not allowed`)
                let result = await (in_tx ? schemat.new_session(() => eval(code)) : eval(code))
                await schemat.save()
                return result
            },
            input:  mString,
            // output: mActionResult,
        })
    }

    'POST.action'() {
        /* Execute a server-side action inside a Session so that record modifications are captured and sent back to caller. */
        return new JsonPOST({
            server: (id, action, args) => {
                let obj = schemat.get_object(id)
                return schemat.execute_action(obj, action, args)    // [result, tx]; `tx` is used internally by mActionResult (below) and then dropped
            },
            output: mActionResult,
        })
    }


    /***  Dynamic imports  ***/

    // Currently, vm.Module (Application.import_module()) cannot import builtin modules, as they are not instances of vm.Module.
    // For this reason, importLocal() is added to the global context, so that the modules imported from DB can use it
    // as an alias for standard (non-VM) import(). Adding this function in a call to vm.createContext() instead of here raises errors.
    //
    // set_global({importLocal: (p) => import(p)})


    // async import_module(path, referrer) {
    //     /* Custom import of JS files and code snippets from Schemat's Uniform Namespace (SUN). Returns a vm.Module object. */
    //     // TODO: cache module objects, parameter Application:cache_modules_ttl
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
    //     if (!source) throw new Error(`Application.import_module(), path not found: ${path}`)
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
    //         {context, identifier: Application.DOMAIN_LOCAL + path}
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
    //     let identifier = Application.DOMAIN_SCHEMAT + path
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
