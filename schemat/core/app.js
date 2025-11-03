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
const {transform_postcss} = SERVER && await import('../web/transforms.js') || {}

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
    // static URL_LOCAL = '/$/local'           // url-path of the application's local filesystem root folder

    __global                        // plain object {...} holding all references from `global` (TODO: is not .std enough?)

    // properties:
    app_root
    root
    global
    cluster
    webserver

    static_extensions           // html, css, ... extensions included in URL, sent in their original form to client
    transpiled_extensions       // pcss, ... extensions included in URL, undergoing transformation before the file is sent to client
    rendered_extensions         // js, jsx, svelte ... extensions removed from URL, the files are rendered via _render_EXT() methods

    private_routes
    system_route
    flat_routes
    default_route

    purge_objects_interval
    evict_records_interval
    eval_allowed
    logger
    async_ejs

    get _static_exts()      { return this.static_extensions.toLowerCase().split(/\s+/) }
    get _transpiled_exts()  { return this.transpiled_extensions.toLowerCase().split(/\s+/) }
    get _rendered_exts()    { return this.rendered_extensions.toLowerCase().split(/\s+/) }

    get _private_routes()   { return this.private_routes.split(/\s+/) || [] }
    get _app_root()         { return mod_path.normalize(schemat.PATH_PROJECT + '/' + this.app_root) }
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
            // pre-scan file-based routes once at startup
            await this.routes.scan()
        }

        // load objects listed in [global] property and make them globally available for application code
        await schemat.after_boot(async () => {
            let __global = this.__self.__global = {}
            for (let [name, object] of this.global || [])
                __global[name] = await object.load()
        })
    }

    // async _check_default_container() {
    //     while (!schemat.app) await sleep(0.1)
    //     let default_container = await this.resolve(this.default_path.slice(1))
    //
    //     // check that default_path maps to a container...
    //     assert(default_container?._is_container, `default_path ('${this.default_path}') is incorrect and does not map to a container`)
    //
    //     // ...and that this container is an ObjectSpace, so it is compatible with the URL generation on the client
    //     assert(default_container.__category.name === 'ObjectSpace', `container [${this.id}] at the default path ('${this.default_path}') must be an ObjectSpace`)
    // }


    /***  URL / URL-path / local file-path conversions  ***/

    default_path_of(object_or_id) {
        /* Default absolute URL path ("system path") of a given object. Starts with '/', no domain.
           This function assumes that the container pointed to by the `default_path` is an ObjectSpace,
           otherwise the URL returned may be incorrect (!). See _check_default_container().
         */
        let id = typeof object_or_id === 'number' ? object_or_id : object_or_id.id
        return this.system_route + `/id/${id}`
        // return this.default_path + `/${id}`
    }


    /***  Request resolution  ***/

    async route(request) {
        /* Find request.path on disk, then respond with a static file, or render .ejs, or execute .js function. */

        // this._print(`request.path:`, request.path)
        let path = request.path
        assert(!path || path[0] === '/', path)

        // make sure that no segment in request.path starts with a forbidden prefix (_private_routes)
        if (this._is_private_path.test(path)) return request.not_found()

        // use precomputed file routes
        let match = this.routes.match(path)
        if (!match) return request.not_found()
        // this._print(`app._route_file_based() match:`, match)

        if (match.type === 'static') {                      // send a static file as is
            request.send_mimetype(match.ext)
            return request.send_file(match.path)
        }

        if (match.type === 'transpiled') {                  // send a transpiled file via a corresponding _transpile_*() method
            let method = `_transpile_${match.ext}`
            return this[method](match.path, request)
        }

        if (match.type === 'render') {
            request.set_params(match.params)
            let method = `_render_${match.ext}`
            return this[method](match.path, request)
        }

        // // execute directory-based views: path/+page.svelte  ... TODO: +layout +page.js
        // if (type === 'directory') {
        //     let page_path = mod_path.join(path, '+page.svelte')
        //     if (await check_file_type(page_path) === 'file') {
        //         let module = await import(page_path)
        //         if (typeof module.default === 'function')
        //             return module.default(request)
        //     }
        // }

        assert(false, `unknown route type: ${match.type}`)
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

    async _transpile_svelte(path, request) {
        /* Compile a .svelte file to client-side JS and send it to the client. */
        // this._print(`_transpile_svelte():`, path)
        let source = await readFile(path, 'utf-8')
        let out = svelte_compile(source, {filename: path, css: 'injected', generate: 'client'})
        if (out.warnings?.length) this._print('_transpile_svelte() compilation warnings:', out.warnings)

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

    async _transpile_pcss(path, request) {
        let input = await readFile(path, 'utf8')
        let output = await transform_postcss(input, path)
        request.send_mimetype('css')
        request.send(output)
    }

    async _render_ejs(path, request) {
        /* Render an EJS template file. It may include() other templates and async import_() other JS modules. */

        // `views` is an array of search paths that would be used as roots for resolving relative include(path) statements,
        // but *only* if the resolution relative to `filename` fails;
        // `async`=true allows EJS templates to include async JS code like `await import(...)` or `await fetch_data()`
        let opts = {filename: path, views: [this.app_root], async: !!this.async_ejs}
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

        let file = path.split('/').pop()        // on-client hydration imports the same file but with .svelte ext in URL, which goes back to _transpile_svelte() below
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


    // runs inside a TX, so updated DB records are captured at the end and returned to caller
    async 'act.db_execute'(...args) { return await schemat.db.execute(...args) }

}

