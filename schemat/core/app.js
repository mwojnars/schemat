import {print, assert, T, sleep, splitLast, normalizePath, escapeRegExp, fileExtension} from '../common/utils.js'
import {URLNotFound} from "../common/errors.js"
import {WebRequest} from '../web/request.js'
import {WebObject} from './object.js'
import {JsonPOST} from "../web/services.js";
import {mActionResult, mString} from "../web/messages.js";

// const fs  = SERVER && await import('fs')
const ejs = SERVER && await import('ejs')
const mod_path = SERVER && await import('node:path')
const {readFile} = SERVER && await import('node:fs/promises') || {}
const {Routes} = SERVER && await import('../web/routes.js') || {}
// const {check_file_type} = SERVER && await import('../common/utils_srv.js') || {}

const {render: svelte_render} = SERVER && await import('svelte/server') || {}
const {compile: svelte_compile} = SERVER && await import('svelte/compiler') || {}

const React = SERVER && await import('react')
const ReactDOMServer = SERVER && await import('react-dom/server')


/**********************************************************************************************************************/

export class Application extends WebObject {
    /* Global configuration of all applications that comprise this website, with URL routing etc.
       A route whose name starts with asterisk (*NAME) is treated as blank.
       TODO: in the future, every Application will be able to define its own set of builtin classes for JSONx serialization & classpath mapping
     */

    // static DOMAIN_LOCAL   = 'local:'        // for import paths that address physical files of the local Schemat installation
    // static DOMAIN_SCHEMAT = 'schemat:'      // internal server-side domain name prepended to DB import paths for debugging
    // static URL_SCHEMAT = '/$/schemat'       // url-path of the root of Schemat source code

    static URL_LOCAL = '/$/local'   // url-path of the application's local filesystem root folder

    __global                        // plain object {...} holding all references from `global` (TODO: is not .std enough?)

    // properties:
    root_folder
    root
    global
    cluster
    webserver
    default_path
    static_extensions
    transpiled_extensions
    private_routes
    system_route
    flat_routes
    purge_objects_interval
    evict_records_interval
    eval_allowed
    logger
    async_ejs

    get _app_root()         { return mod_path.normalize(schemat.PATH_PROJECT + '/' + this.root_folder) }
    get _static_exts()      { return this.static_extensions.toLowerCase().split(/[ ,;:]+/) }
    get _transpiled_exts()  { return this.transpiled_extensions.toLowerCase().split(/[ ,;:]+/) }
    get _private_routes()   { return this.private_routes.split(/\s+/) || [] }

    get routes()            { if (Routes) return new Routes(this) }

    get _is_private_path() {
        /* Regex that checks if a URL path (starting with /...) contains a private segment anywhere. */
        let prefixes = this._private_routes.map(route => escapeRegExp(route))
        let pattern = `/(${prefixes.join('|')})`
        return new RegExp(pattern)
    }
    get _is_private_name() {
        /* Regex that checks if a file/folder name is private. */
        let prefixes = this._private_routes.map(route => escapeRegExp(route))
        let pattern = `^(${prefixes.join('|')})`
        return new RegExp(pattern)
    }


    async __load__() {
        if (SERVER) {
            // this._vm = await import('node:vm')
            if (this.default_path) this._check_default_container()      // no await to avoid blocking the app's startup
            // pre-scan file-based routes once at startup
            await this.routes.scan()
        }
        await schemat.after_boot(() => this.load_globals())
    }

    async _check_default_container() {
        while (!schemat.app) await sleep(0.1)
        let default_container = await this.resolve(this.default_path.slice(1))

        // check that default_path maps to a container...
        assert(default_container?._is_container, `default_path ('${this.default_path}') is incorrect and does not map to a container`)

        // ...and that this container is an ObjectSpace, so it is compatible with the URL generation on the client
        assert(default_container.__category.name === 'ObjectSpace', `container [${this.id}] at the default path ('${this.default_path}') must be an ObjectSpace`)
    }

    async load_globals() {
        /* Load objects listed in [global] property and make them globally available for application code. */
        let __global = this.__self.__global = {}
        for (let [name, object] of this.global || [])
            __global[name] = await object.load()
    }


    /***  URL / URL-path / local file-path conversions  ***/

    default_path_of(object_or_id) {
        /* Default absolute URL path ("system path") of a given object. Starts with '/', no domain.
           This function assumes that the container pointed to by the `default_path` is an ObjectSpace,
           otherwise the URL returned may be incorrect (!). See _check_default_container().
         */
        let id = typeof object_or_id === 'number' ? object_or_id : object_or_id.id
        return this.default_path + `/${id}`
    }

    get_file_url(path) {
        /* Convert a local file path to its corresponding URL-path (href=...). Typically used for loading assets on the client. */
        if (path.startsWith('file://')) path = path.slice(7)                // trim leading 'file://' if present
        let root = schemat.PATH_PROJECT
        if (!path.startsWith(root + '/')) throw new Error(`path is not accessible via URL: ${path}`)
        return path.replace(root, Application.URL_LOCAL)
    }

    get_module_url(path) {
        /* Convert a local import path, like "schemat/.../file.js" to a URL-path that can be used with import() on the client. */
        if (path[0] === '/') throw new Error(`cannot make an import URL-path for an absolute local path: ${path}`)
        return `${Application.URL_LOCAL}/${path}::import`          // ::import is sometimes needed to get the proper MIME header, esp. if target is a web object not a local file
    }


    /***  Request resolution  ***/

    _norm_segment(seg) {
        /* Convert a file segment/path to a chunk of URL path. File extension must have been removed beforehand. */
        return this.flat_routes ? seg.replaceAll('.', '/') : seg
    }

    async _route_file_based(request) {
        /* Find request.path on disk, then return the static file, or render .ejs, or execute .js function. */
        // this._print(`request.path:`, request.path)
        let url_path = request.path || '/'
        assert(url_path[0] === '/', url_path)

        // make sure that no segment in request.path starts with a forbidden prefix (_private_routes)
        if (this._is_private_path.test(url_path)) request.not_found()

        // use precomputed file routes
        let match = this.routes.match(url_path)
        if (!match) return false
        // this._print(`app._route_file_based() match:`, match)

        if (match.type === 'static') {                      // send a static file as is
            await request.send_file(match.file)
            return true
        }

        if (match.type === 'transpiled') {                  // send a transpiled file via a corresponding _send_*() method
            await this._send_svelte(match.file, request)
            return true
        }

        if (match.type === 'render') {
            request.set_params(match.params)
            let method = `_render_${match.ext}`
            await this[method](match.file, request)
            return true
        }

        // // execute directory-based views: path/+page.svelte  ... TODO: +layout +page.js
        // if (type === 'directory') {
        //     let page_path = mod_path.join(path, '+page.svelte')
        //     if (await check_file_type(page_path) === 'file') {
        //         let module = await import(page_path)
        //         if (typeof module.default === 'function') {
        //             await module.default(request)
        //             return true
        //         }
        //     }
        // }

        return false
        // request.not_found()
    }

    async _render_ejs(path, request) {
        /* Render an EJS template file. It may include() other templates and async import_() other JS modules. */

        // `views` is an array of search paths that would be used as roots for resolving relative include(path) statements,
        // but *only* if the resolution relative to `filename` fails;
        // `async`=true allows EJS templates to include async JS code like `await import(...)` or `await fetch_data()`
        let opts = {filename: path, views: [this._app_root], async: !!this.async_ejs}
        let root = mod_path.dirname(path)
        let import_ = async (_path) => _path.startsWith('$') || _path.startsWith('node:') ?
                            import(_path) :
                            import(mod_path.resolve(root, _path))

        let template = await readFile(path, 'utf-8')
        if (this.async_ejs === 'auto') opts.async = /\bawait\b/.test(template)

        // here, trying to override the standard `import` symbol with `import_` does NOT work, so import_ is passed separately;
        // this modified function must be used for all relative imports inside .ejs instead of the standard one - the latter resolves against node_modules/ejs/lib
        let html = await ejs.render(template, {schemat, request, ...request.params, import_}, opts)
        request.send(html)
    }

    async _render_js(path, request) {
        /* Execute GET/POST/PUT/... function from the .js file pointed to by `path`. */
        let module = await import(path)
        let handler = module[request.http_method]       // GET(), POST(), ...
        if (typeof handler !== 'function') request.not_found()

        let {props} = request
        let {init, client} = module
        let data = init ? await init(request, props) : {}

        if (client)             // generate client-side code for custom initialization: init() + client()
            if (init) request.send_init(`
                let __props = schemat.request.props;
                let __data = await (${init})(schemat.request, __props);
                await (${client})({...__props, ...__data});
            `)
            else request.send_init(`
                await (${client})(schemat.request.props);
            `)

        return handler(request, {...props, ...data})
    }

    async _render_jsx(path, request, layout_file = '../web/views/skeleton.jsx') {
        /* Execute a JSX component file with React SSR. No client-side hydration as of now. */
        const module = await import(path)
        if (typeof module.default !== 'function') request.not_found()
        
        // render the component inside the layout
        const Layout = (await import(layout_file)).default
        const element = React.createElement(module.default, request.params)
        const page = React.createElement(Layout, {
            // scripts: [`${request.path}::client`],
            children: element
        })
        
        // render full page to HTML
        const html = '<!DOCTYPE html>\n' + ReactDOMServer.renderToString(page)
        request.send(html)
    }

    async _render_svelte(path, request, layout_file = '../web/views/skeleton.html') {
        /* Execute a Svelte 5 component file. See Svelte docs:
           - https://svelte.dev/docs/svelte/svelte-server -- info on server-side render()
           - https://svelte.dev/docs/svelte/v5-migration-guide -- info on client-side hydrate() call
           If the component defines a load() function in <script module>, it is called to get the data for the component,
           which is then included under `data` attribute inside $props(). The load() function can be async.
         */
        let module = await import(path)
        let component = module?.default
        if (typeof component !== 'function') request.not_found()

        let {load} = module                     // generate data with load(), if present, and append to `props` via request.extra
        if (typeof load === 'function')
            request.set_props({data: await load(request)})

        let file = path.split('/').pop()        // on-client hydration imports the same file but with .svelte extension kept in URL, which goes back to _send_svelte() below
        request.send_init(`
                import {hydrate} from "/$/bundle/svelte";
                import App from "./${file}";
                const target = document.getElementById("app");
                hydrate(App, {target, props: schemat.request.props});
            `)

        let init = schemat.init_client()
        let {head, body} = svelte_render(component, {props: request.props})

        // wrap with default html layout
        let layout_url = new URL(layout_file, import.meta.url)
        let template = await readFile(layout_url, 'utf-8')
        let html = template.replace('<!--INIT-->', init)
                           .replace('<!--HEAD-->', head || '')
                           .replace('<!--APP-->', body || '')
        request.send(html)
    }

    get _svelte_imports() {
        /* Discover Svelte client runtime imports by compiling a tiny sample component on the fly. Should include paths like:
             svelte/internal/client
             svelte/internal/disclose-version
             svelte/internal/flags/legacy
         */
        // minimal Svelte 5 component sufficient to trigger runtime imports
        let source = `<script>export let x</script>\n<div>{x}</div>`
        let out = svelte_compile(source, {filename: 'sample.svelte', css: 'injected', generate: 'client'})
        let code = out?.js?.code || ''

        // extract all import specifiers and keep only Svelte internals
        let set = new Set()
        code.replace(/from ['"]([^'"]+)['"]/g, (m, spec) => { if (spec.startsWith('svelte/')) set.add(spec); return '' })
        code.replace(/import ['"]([^'"]+)['"]/g, (m, spec) => { if (spec.startsWith('svelte/')) set.add(spec); return '' })
        return [...set]
    }

    async _send_svelte(path, request) {
        /* Compile a .svelte file to client-side JS and send it to the client. */
        // this._print(`_send_svelte():`, path)
        let source = await readFile(path, 'utf-8')
        let out = svelte_compile(source, {filename: path, css: 'injected', generate: 'client'})
        if (out.warnings?.length) this._print('_send_svelte() compilation warnings:', out.warnings)

        let bundle = `"/$/bundle/svelte"`
        let code = out.js.code

        // rewrite Svelte runtime imports to a single bundled runtime URL
        this._svelte_imports.forEach(dep => {
            code = code.replaceAll(new RegExp(`from ['"]${dep}['"]`, 'g'), `from ${bundle}`)
            code = code.replaceAll(new RegExp(`import ['"]${dep}['"]`, 'g'), `import ${bundle}`)
        })

        request.send_mimetype('js')
        request.send(code)
    }


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

        // this._print(`app.route() LEGACY ROUTE:`, request.req.url)
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

    async resolve(path) { return this.root.resolve(path) }


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


    // runs inside a TX, so updated DB records are captured at the end and returned to caller
    async 'act.db_execute'(...args) { return await schemat.db.execute(...args) }


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

