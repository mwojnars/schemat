import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import node_path from "node:path"
import node_url from "node:url"

import {print, DependenciesStack, assert} from '../common/utils.js'


let _promises = new class extends DependenciesStack {
    debug = false
}


function DBG(type, name, promise) {
    if (!promise || type === null) return promise
    let id = type + ':' + name
    _promises.push(id)
    return promise.then(res => {_promises.pop(id); return res})
    // print(`promise created:   + ${id}`)
    // return promise.then(res => {print(`promise resolved:  - ${id}`); return res})
}


export class Loader {
    /* Dynamic imports from SUN namespace. */

    // static DOMAIN_LOCAL   = 'local:'        // for import paths that address physical files of the local Schemat installation
    // static DOMAIN_SCHEMAT = ''              // internal server-side domain name prepended to DB import paths for debugging    //'schemat:'

    PATH_LOCAL_SUN = "/system/local"        // SUN folder that maps to the local filesystem folder, PATH_LOCAL_FS;
    PATH_LOCAL_FS                           // modules from PATH_LOCAL_* can be imported during startup, before the SUN namespace is set up

    context = null                          // global vm.Context shared by all modules
    modules = new Map()                     // cache of the modules loaded so far
    
    
    _loading_modules = new class extends DependenciesStack {            // list of module paths currently being loaded
        debug = false
    }


    constructor(file_url, depth = 1) {
        this.PATH_LOCAL_FS = this._get_root_folder(file_url, depth)
        this._linker = this._linker.bind(this)
        this.context = this._create_context()
    }

    _get_root_folder(file_url, depth = 1) {
        /* Calculate the loader's root folder at `depth` levels up from the file_url's folder and return as plain filesystem path. */
        let file = node_url.fileURLToPath(file_url)                 // or: process.argv[1]
        let root = node_path.dirname(file)                          // folder of the file_url
    
        for (let i = 0; i < depth; i++)                             // go up `depth` levels to get the root folder of the project
            root = node_path.dirname(root)
            
        return root
    }
    
    async import(path, referrer) {
        /* Custom import of JS files and code snippets from Schemat's Uniform Namespace (SUN). Returns a vm.Module object. */

        // print(`import_module():  ${path}  (from ${referrer?.identifier})`)    //, ${referrer?.schemat_import}, ${referrer?.referrer}

        // make `path` absolute
        if (path[0] === '.') {
            if (!referrer) throw new Error(`missing referrer for a relative import path: '${path}'`)
            path = referrer.identifier + '/../' + path          // referrer is a vm.Module
        }

        // path = this._unprefix(path)                  // drop "schemat:"
        path = this._normalize(path)                    // path normalize: convert '.' and '..' segments

        // this.context ??= this._create_context()

        let module = this._get_cached(path, referrer)
        if (module) return module                       // a promise

        // standard JS import from non-SUN paths
        if (path[0] !== '/') return this._import_synthetic(path, referrer)

        // standard JS import if `path` starts with PATH_LOCAL_SUN; this guarantees that Schemat's system modules
        // can still be loaded during bootstrap before the SUN namespace is set up
        if (path.startsWith(this.PATH_LOCAL_SUN + '/')) {
            let filename = this._js_import_file(path)
            let source = await readFile(filename, {encoding: 'utf8'})               // read source code from a local file
            return this._parse_module(source, path, referrer)
        }

        print(`importing from SUN:  ${path}`)
        let source = await DBG('P1', path + '::text', schemat.site.route_internal(path + '::text'))

        return this._parse_module(source, path, referrer)
    }

    // _unprefix(path) { return path.startsWith(Loader.DOMAIN_SCHEMAT) ? path.slice(Loader.DOMAIN_SCHEMAT.length) : path }

    _normalize(path) {
        /* Drop single dots '.' occurring as `path` segments; truncate parent segments wherever '..' occur. */
        while (path.includes('/./')) path = path.replaceAll('/./', '/')
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

    _js_import_file(path) {
        /* Schemat's server-side import path (/system/local/...) converted to a local filesystem path that can be used with standard import(). */
        let local = this.PATH_LOCAL_SUN
        if (!path.startsWith(local + '/')) throw new Error(`incorrect import path (${path}), should start with "${local}"`)
        return this.PATH_LOCAL_FS + path.slice(local.length)
    }

    _create_context() {
        let context = vm.createContext(globalThis)
        // context = vm.createContext({...globalThis, console, process})   // unpacking globalThis does NOT work: ALL system objects inside the module differ from the base module's (Object, Map etc.!)
        // context = vm.createContext({Item, schemat, Object, Function, Promise, Array, ArrayBuffer, String, Number, Boolean, Date})

        print('Loader: new global context created:')
        // print(globalThis)
        // print({...globalThis})

        return context

        // let context = vm.createContext(globalThis)
        // let context = referrer?.context || vm.createContext({...globalThis, importLocal: p => import(p)})
        // submodules must use the same^^ context as referrer (if not globalThis), otherwise an error is raised
    }

    async _import_synthetic(path, referrer) {
        /* Import a module using standard import(), but return it as a vm.SyntheticModule,
           because a regular JS module object is not accepted by the linker.
         */
        let cached = this._get_cached(path, referrer)     // cache must be checked again here, because the module may have been registered while waiting for the `source` to be loaded
        if (cached) return cached

        // print('_import_synthetic():', path)

        let mod_js = await import(path)
        let vm_mod = new vm.SyntheticModule(
            Object.keys(mod_js),
            function() { Object.entries(mod_js).forEach(([k, v]) => this.setExport(k, v)) },
            {identifier: path, context: this.context}
        )

        return this._wrap_module(vm_mod, path, referrer, this._linker)  //() => {})
    }

    async _parse_module(source, path, referrer) {
        // print(`parsing from source:  ${path} ...`)
        if (!source) throw new Error(`path not found: ${path}`)

        let cached = this._get_cached(path, referrer)     // cache must be checked again here, because the module may have been registered while waiting for the `source` to be loaded
        if (cached) return cached

        let vm_mod = new vm.SourceTextModule(source, {
            identifier:                 path,
            context:                    this.context,
            // initializeImportMeta:       (meta) => {meta.url = path},        // also: meta.resolve = ... ??

            initializeImportMeta:       (meta) => {
                // meta.url = `file://${path}`
                meta.url = path
                meta.resolve = (specifier, parent = meta.url) => {
                    if (parent.startsWith("file://")) parent = node_url.fileURLToPath(parent)   // convert file URL to file path if necessary
                    let path = node_path.resolve(node_path.dirname(parent), specifier)          // resolve the specifier relative to the parent path
                    // print(`resolve: ${specifier}  (from ${parent})  ->  ${path}`)
                    return path
                    // return `file://${path}`                                                     // convert back to file URL
                }
            },
            importModuleDynamically:    this._linker,
        })

        return this._wrap_module(vm_mod, path, referrer, this._linker)
    }

    async _wrap_module(vm_mod, path, referrer, linker) {

        this._loading_modules.push(path)

        vm_mod.referrer = referrer
        let module = {__vmModule__: vm_mod}
        this._save_module(path, module)                     // the module must be registered already here, before linking, to handle circular dependencies

        await (module.__linking__ = vm_mod.link(linker))
        await (module.__evaluating__ = vm_mod.evaluate())
        // print(`parsed from source:  ${path}`)

        this._loading_modules.pop(path)

        Object.assign(module, vm_mod.namespace)
        return module
    }

    async _linker(specifier, ref, extra) {
        return (await this.import(specifier, ref)).__vmModule__    //print(specifier, ref) ||
    }


    _get_cached(path, referrer) {
        let module = this.modules.get(path)
        if (module) {
            let vm_mod = module.__vmModule__
            // print(`taken from cache:  ${path}  (${vm_mod.status})`)
            if (vm_mod.status === 'linking') {
                this._check_circular(referrer, vm_mod)
                return module.__linking__.then(() => module)        // wait for the module to be linked before returning it (module.__linking__ is a Promise)
            }
            return module
        }
    }

    _check_circular(referrer, module) {
        // print(`_check_circular():`) //, module.identifier)
        let paths = [module.identifier]
        let ref = referrer

        while (ref) {
            let path = ref.identifier
            paths.push(path)
            if (path === paths[0])
                throw new Error(`circular dependency detected:\n ${paths.reverse().join('\n ')}`)
            ref = ref.referrer
        }
        // for (let path of paths.reverse()) print(`  ${path}`)
    }

    _save_module(path, module) {
        /* `path` should be normalized already */
        assert(!this.modules.has(path), `module already registered: ${path}`)
        this.modules.set(path, module)
    }
}