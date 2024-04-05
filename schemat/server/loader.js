import fs from 'node:fs'
import vm from 'node:vm'

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


    constructor(path_local_fs) {
        this.PATH_LOCAL_FS = path_local_fs
        this._linker = this._linker.bind(this)
    }

    async import(path, referrer) {
        /* Custom import of JS files and code snippets from Schemat's Uniform Namespace (SUN). Returns a vm.Module object. */

        print(`import_module():  ${path}  (from ${referrer?.identifier})`)    //, ${referrer?.schemat_import}, ${referrer?.referrer}

        // make `path` absolute
        if (path[0] === '.') {
            if (!referrer) throw new Error(`missing referrer for a relative import path: '${path}'`)
            path = referrer.identifier + '/../' + path          // referrer is a vm.Module
        }

        // path = this._unprefix(path)                  // drop "schemat:"
        path = this._normalize(path)                    // path normalize: convert '.' and '..' segments

        this.context ??= this._create_context()

        // standard JS import from non-SUN paths
        if (path[0] !== '/') return DBG('P9', path, this._import_synthetic(path, referrer))

        let module = this._get_cached(path, referrer)
        if (module) return module                   // a promise

        // standard JS import if `path` starts with PATH_LOCAL_SUN; this guarantees that Schemat's system modules
        // can still be loaded during bootstrap before the SUN namespace is set up
        if (path.startsWith(this.PATH_LOCAL_SUN + '/')) {
            let filename = this._js_import_file(path)
            let source = fs.readFileSync(filename, {encoding: 'utf8'})                  // read source code from a local file
            return this._parse_module(source, path, referrer)
        }

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
        // print('_import_synthetic():', path)
        let mod_js  = await DBG('P2', path, import(path))
        let module  = new vm.SyntheticModule(
            Object.keys(mod_js),
            function() { Object.entries(mod_js).forEach(([k, v]) => this.setExport(k, v)) },
            {identifier: path, context: this.context}
        )
        module.referrer = referrer

        await DBG('P3', path, module.link(() => {}))
        await DBG('P4', path, module.evaluate())
        return {...module.namespace, __vmModule__: module}
    }

    async _parse_module(source, path, referrer) {
        // print(`parsing from source:  ${path} ...`)
        if (!source) throw new Error(`path not found: ${path}`)

        try {

        let module = this._get_cached(path, referrer)     // cache must be checked again here, because the module may have been registered while waiting for the `source` to be loaded
        if (module) return module

        this._loading_modules.push(path)
        // let identifier = Loader.DOMAIN_SCHEMAT + path

        let __vmModule__ = new vm.SourceTextModule(source, {
            identifier:                 path,
            context:                    this.context,
            initializeImportMeta:       (meta) => {meta.url = path},        // also: meta.resolve = ... ??
            importModuleDynamically:    this._linker,
        })

        __vmModule__.referrer = referrer
        module = {__vmModule__}  //__linking__
        this._save_module(path, module)                     // the module must be registered already here, before linking, to handle circular dependencies

        await DBG(null, path, module.__linking__ = __vmModule__.link(this._linker))
        await DBG('P7', path, __vmModule__.evaluate())
        // print(`parsed from source:  ${path}`)

        this._loading_modules.pop(path)

        Object.assign(module, __vmModule__.namespace)
        return module

        } catch (err) {
            print(`Error parsing module: ${path}`)
            throw err
        }
    }

    async _linker(specifier, ref, extra) {
        return (await DBG(null, specifier, this.import(specifier, ref))).__vmModule__    //print(specifier, ref) ||
    }


    _get_cached(path, referrer) {
        let module = this.modules.get(path)
        if (module) {
            let vm_mod = module.__vmModule__
            // print(`taken from cache:  ${path}  (${vm_mod.status})`)
            if (vm_mod.status === 'linking') {
                this._check_circular(referrer, vm_mod)
                return DBG('P8', path, module.__linking__.then(() => module))        // wait for the module to be linked before returning it (module.__linking__ is a Promise)
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