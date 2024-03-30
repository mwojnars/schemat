import {print, DependenciesStack} from "../common/utils.js"
import vm from 'node:vm'


let _promises = new class extends DependenciesStack {
    debug = true
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
    static DOMAIN_SCHEMAT = 'schemat:'      // internal server-side domain name prepended to DB import paths for debugging

    // list of module paths currently being loaded
    _loading_modules = new class extends DependenciesStack {
        debug = false
    }

    async import_module(path, referrer) {
        /* Custom import of JS files and code snippets from Schemat's Uniform Namespace (SUN). Returns a vm.Module object. */

        // print(`import_module():  ${path}  (ref: ${referrer?.identifier})`)    //, ${referrer?.schemat_import}, ${referrer?.referrer}

        // make `path` absolute
        if (path[0] === '.') {
            if (!referrer) throw new Error(`missing referrer for a relative import path: '${path}'`)
            path = referrer.identifier + '/../' + path          // referrer is a vm.Module
        }

        // path normalize: drop "schemat:", convert '.' and '..' segments
        path = this._unprefix(path)
        path = this._normalize(path)

        // standard JS import from non-SUN paths
        if (path[0] !== '/') return DBG('P9', path, this._import_synthetic(path))

        let module = this._get_cached(path)
        if (module) return module                   // a promise

        let source = await DBG('P1', path + '::text', schemat.site.route_internal(path + '::text'))
        if (!source) throw new Error(`import_module(), path not found: ${path}`)

        return this._parse_module(source, path)
    }

    async _import_synthetic(path) {
        /* Import a module using standard import(), but return it as a vm.SyntheticModule, because a regular JS module
           object is not accepted by the linker.
         */
        // print('_import_synthetic():', path)
        let mod_js  = await DBG('P2', path, import(path))
        let context = vm.createContext(globalThis)
        // let linker = async (specifier, ref, extra) => (await DBG(null, specifier, this.import_module(specifier, ref))).__vmModule__
        let module  = new vm.SyntheticModule(
            Object.keys(mod_js),
            function() { Object.entries(mod_js).forEach(([k, v]) => this.setExport(k, v)) },
            {context, identifier: Loader.DOMAIN_LOCAL + path} // importModuleDynamically: linker}
        )
        await DBG('P3', path, module.link(() => {}))
        await DBG('P4', path, module.evaluate())
        return {...module.namespace, __vmModule__: module}
    }

    _get_cached(path) {
        let module = schemat.registry.get_module(path)
        if (module) {
            let {status} = module.__vmModule__
            // print(`taken from cache:  ${path}  (status: ${status})`)
            if (status === 'linking')
                return DBG('P8', path, module.__linking__.then(() => module))        // wait for the module to be linked before returning it (module.__linking__ is a Promise)
            return module
        }
    }

    async _parse_module(source, path) {
        // print(`parsing from source:  ${path} ...`)
        try {

        let module = this._get_cached(path)     // cache must be checked again here, because the module may have been registered while waiting for the `source` to be loaded
        if (module) return module

        this._loading_modules.push(path)

        // let context = vm.createContext(globalThis)
        // let context = referrer?.context || vm.createContext({...globalThis, importLocal: p => import(p)})
        // submodules must use the same^^ context as referrer (if not globalThis), otherwise an error is raised

        let identifier = Loader.DOMAIN_SCHEMAT + path
        let linker = async (specifier, ref, extra) => (await DBG(null, specifier, this.import_module(specifier, ref))).__vmModule__    //print(specifier, ref) ||
        let initializeImportMeta = (meta) => {meta.url = identifier}   // also: meta.resolve = ... ??

        let __vmModule__ = new vm.SourceTextModule(source, {identifier, initializeImportMeta, importModuleDynamically: linker})  //context,
        let __linking__ = __vmModule__.link(linker)

        module = {__vmModule__, __linking__}
        schemat.registry.set_module(path, module)      // the module must be registered already here, before linking, to handle circular dependencies

        await DBG(null, path, __linking__)
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

    _unprefix(path) { return path.startsWith(Loader.DOMAIN_SCHEMAT) ? path.slice(Loader.DOMAIN_SCHEMAT.length) : path }

    _normalize(path) {
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
}