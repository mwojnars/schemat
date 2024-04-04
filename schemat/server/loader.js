import {print, DependenciesStack} from "../common/utils.js"
import vm from 'node:vm'


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

    static DOMAIN_LOCAL   = 'local:'        // for import paths that address physical files of the local Schemat installation
    static DOMAIN_SCHEMAT = ''  //'schemat:'      // internal server-side domain name prepended to DB import paths for debugging

    context = null                          // global vm.Context shared by all modules

    _loading_modules = new class extends DependenciesStack {            // list of module paths currently being loaded
        debug = false
    }


    async import_module(path, referrer) {
        /* Custom import of JS files and code snippets from Schemat's Uniform Namespace (SUN). Returns a vm.Module object. */

        // print(`import_module():  ${path}  (from ${referrer?.identifier})`)    //, ${referrer?.schemat_import}, ${referrer?.referrer}

        // make `path` absolute
        if (path[0] === '.') {
            if (!referrer) throw new Error(`missing referrer for a relative import path: '${path}'`)
            path = referrer.identifier + '/../' + path          // referrer is a vm.Module
        }

        // path normalize: drop "schemat:", convert '.' and '..' segments
        path = this._unprefix(path)
        path = this._normalize(path)

        this.context ??= this._create_context()

        // standard JS import from non-SUN paths
        if (path[0] !== '/') return DBG('P9', path, this._import_synthetic(path, referrer))

        let module = this._get_cached(path, referrer)
        if (module) return module                   // a promise

        let source = await DBG('P1', path + '::text', schemat.site.route_internal(path + '::text'))
        if (!source) throw new Error(`import_module(), path not found: ${path}`)

        return this._parse_module(source, path, referrer)
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
        /* Import a module using standard import(), but return it as a vm.SyntheticModule, because a regular JS module
           object is not accepted by the linker.
         */
        // print('_import_synthetic():', path)
        let mod_js  = await DBG('P2', path, import(path))
        let module  = new vm.SyntheticModule(
            Object.keys(mod_js),
            function() { Object.entries(mod_js).forEach(([k, v]) => this.setExport(k, v)) },
            {context: this.context, identifier: Loader.DOMAIN_LOCAL + path} // importModuleDynamically: linker}
        )
        module.referrer = referrer

        await DBG('P3', path, module.link(() => {}))
        await DBG('P4', path, module.evaluate())
        return {...module.namespace, __vmModule__: module}
    }

    async _parse_module(source, path, referrer) {
        // print(`parsing from source:  ${path} ...`)
        try {

        let module = this._get_cached(path, referrer)     // cache must be checked again here, because the module may have been registered while waiting for the `source` to be loaded
        if (module) return module

        this._loading_modules.push(path)

        let identifier = Loader.DOMAIN_SCHEMAT + path
        let linker = async (specifier, ref, extra) => (await DBG(null, specifier, this.import_module(specifier, ref))).__vmModule__    //print(specifier, ref) ||
        let initializeImportMeta = (meta) => {meta.url = identifier}   // also: meta.resolve = ... ??

        let __vmModule__ = new vm.SourceTextModule(source, {
            identifier,
            context: this.context,
            initializeImportMeta,
            importModuleDynamically: linker
        })

        __vmModule__.referrer = referrer
        module = {__vmModule__}  //__linking__
        schemat.registry.set_module(path, module)      // the module must be registered already here, before linking, to handle circular dependencies

        await DBG(null, path, module.__linking__ = __vmModule__.link(linker))
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
        return await DBG(null, specifier, this.import_module(specifier, ref)).__vmModule__    //print(specifier, ref) ||
    }


    _get_cached(path, referrer) {
        let module = schemat.registry.get_module(path)
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

    _unprefix(path) { return path.startsWith(Loader.DOMAIN_SCHEMAT) ? path.slice(Loader.DOMAIN_SCHEMAT.length) : path }

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
}