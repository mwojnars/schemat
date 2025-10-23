import mod_path from 'node:path'
import {readdir} from 'node:fs/promises'
import {escapeRegExp, fileExtension} from '../common/utils.js'


export class FileRoutes {
    /* Pre-scans the application's root folder and builds an in-memory routing table.
       Supports next.js-like dynamic segments using [param] in file and folder names. */

    // indices
    files_by_url      // Map(url_path_with_ext -> file_path)
    exact_routes      // Map(route_path_without_ext -> {file, ext}) for renderable files
    dynamic_routes    // Array<{regex, param_names, file, ext, route_path}>

    constructor(app) {
        this.app = app
        this.app_root = app._app_root
        this.static_exts = app._static_exts

        this.files_by_url = new Map()
        this.exact_routes = new Map()
        this.dynamic_routes = []
    }

    async scan() {
        // this.app._print(`FileRoutes.scan() ...`)
        await this._walk(this.app_root)
        
        // this.app._print(`FileRoutes.scan() done`)
        // this.app._print(` `, {files_by_url: this.files_by_url})
        // this.app._print(` `, {exact_routes: this.exact_routes})
        // this.app._print(` `, {dynamic_routes: this.dynamic_routes})
    }

    async _walk(dir) {
        let entries = await readdir(dir, {withFileTypes: true})
        
        // sort entries by replacing '[' with a high-code char to push dynamic segments last
        const HIGH_CHAR = '\uffff'
        entries.sort((a, b) => {
            let a_sort = a.name.replaceAll('[', HIGH_CHAR)
            let b_sort = b.name.replaceAll('[', HIGH_CHAR)
            return a_sort.localeCompare(b_sort)
        })
        
        for (let ent of entries) {
            if (this.app._is_private_name.test(ent.name)) continue
            if (ent.isDirectory()) {
                if (ent.name === 'node_modules') continue
                await this._walk(mod_path.join(dir, ent.name))
                continue
            }
            if (!ent.isFile()) continue

            let file_path = mod_path.join(dir, ent.name)
            let url_path = this._to_url(file_path)
            this.files_by_url.set(url_path, file_path)

            let ext = fileExtension(file_path).toLowerCase()

            // renderable files become routes without extension
            if (['js', 'jsx', 'svelte', 'ejs'].includes(ext)) {
                let route_path = url_path.slice(0, -(ext.length + 1))       // drop ".ext"
                if (this._has_params(route_path)) this._add_dynamic(route_path, file_path, ext)
                else this.exact_routes.set(route_path, {file: file_path, ext})
            }
        }
    }

    _to_url(file_path) {
        let rel = mod_path.relative(this.app_root, file_path)
        rel = rel.split(mod_path.sep).join('/')
        return '/' + rel
    }

    _has_params(route_path) { return /\[[^\]/]+\]/.test(route_path) }

    _add_dynamic(route_path, file, ext) {
        // compile pattern from [...]/[param]/...
        let [param_names, pattern] = this._make_regex(route_path)
        let regex = new RegExp('^' + pattern + '$')
        this.dynamic_routes.push({regex, param_names, file, ext, route_path})
    }

    _make_regex(route_path) {
        /* Convert a route path, possibly containing [NAME] parameters, to a regex matching actual URLs that fill these params.
           Parameters can be embedded within segments, e.g. "prefix[param]suffix" or "a[p1]b[p2]c".
           Return a pair, [param_names, regex_pattern].
         */
        let param_names = []
        let pattern = escapeRegExp(route_path).replace(/\\\[([^\]]+)\\\]/g, (_, name) => {
            param_names.push(name)
            return '([^/]+)'
        })
        return [param_names, pattern]
    }

    match(url_path) {
        // this.app._print(`match()`, {url_path})

        // exact static file request (with extension)
        let ext = fileExtension(url_path).toLowerCase()
        let file = this.files_by_url.get(url_path)
        if (file) {
            if (this.static_exts.includes(ext)) return {type: 'static', file}
            if (ext === 'svelte') return {type: 'svelte_client', file}
        }

        // renderable route without extension
        let route_path = url_path
        if (ext) route_path = url_path.slice(0, -(ext.length + 1))
        // this.app._print(`match()`, {route_path})

        // exact match first
        let exact = this.exact_routes.get(route_path)
        if (exact) return {type: 'render', file: exact.file, ext: exact.ext, params: {}}

        // dynamic matches
        for (let route of this.dynamic_routes) {
            let match = route.regex.exec(route_path)
            if (match) {
                let params = {}
                route.param_names.forEach((name, i) => params[name] = match[i + 1])
                return {type: 'render', file: route.file, ext: route.ext, params}
            }
        }

        return null
    }
}


