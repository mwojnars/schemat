import mod_path from 'node:path'
import {readdir, lstat, readlink} from 'node:fs/promises'
import {escapeRegExp, fileExtension, dropExtension} from '../common/utils.js'

async function stat_symlink(path) {
    /* Follow a chain of symbolic links, starting from `path`. Return the final file status. */
    while (true) {
        let target = await readlink(path)
        if (!mod_path.isAbsolute(target))
            target = mod_path.resolve(mod_path.dirname(path), target)

        let stat = await lstat(target)
        if (stat.isSymbolicLink()) path = target
        else return stat
    }
}

/**********************************************************************************************************************/

export class Routes {
    /* Pre-scans the application's root folder and builds an in-memory URL routing table.
       Supports next.js-like dynamic segments using [param] in file and folder names.
     */

    exact_routes      // Map(route_path_without_ext -> {type, file, ext}) for renderable files
    dynamic_routes    // Array<{type, file, ext, param_names, regex, route_path}>

    constructor(app) {
        this.app = app
        this.app_root = app.app_root
        this.exact_routes = new Map()
        this.dynamic_routes = []
    }

    async scan() {
        // this.app._print(`URL_Routes.scan() ...`)
        await this._walk(this.app_root)
        
        // this.app._print(`URL_Routes.scan() done`)
        // this.app._print(` `, {exact_routes: this.exact_routes})
        // this.app._print(` `, {dynamic_routes: this.dynamic_routes})
    }

    async _walk(dir, params = [], url = '') {
        let entries = await readdir(dir, {withFileTypes: true})
        
        // sort entries by replacing '[' with a high-code char to push dynamic segments last
        const HIGH_CHAR = '\uffff'
        entries.sort((a, b) => {
            let a_sort = a.name.replaceAll('[', HIGH_CHAR)
            let b_sort = b.name.replaceAll('[', HIGH_CHAR)
            return a_sort.localeCompare(b_sort)
        })
        
        for (let ent of entries) {
            let name = ent.name
            let path = mod_path.join(dir, name)

            if (this.app._is_private_name.test(name)) continue

            if (ent.isSymbolicLink())
                ent = await stat_symlink(path)
            
            if (ent.isDirectory()) {
                if (name === 'node_modules') continue                   // protection against accidental scanning of a huge source tree
                let [_params, _url] = this._parse(name, params, url)    // update accumulators with this directory segment
                await this._walk(path, _params, _url)
                continue
            }

            if (!ent.isFile()) continue

            let ext = fileExtension(path).toLowerCase()
            let url_path = this._to_url(path)
            let route_path = url_path.slice(0, -(ext.length + 1))       // drop ".ext"

            route_path = this.app._norm_segment(route_path)             // replace dots with slashes
            if (ext) url_path = route_path + '.' + ext

            // determine route type based on extension
            let type = null
            if (this.app._static_exts.includes(ext)) type = 'static'
            else if (this.app._transpiled_exts.includes(ext)) type = 'transpiled'
            
            if (type) this.exact_routes.set(url_path, {file: path, type, ext})

            // renderable files become routes without extension
            if (['js', 'jsx', 'svelte', 'ejs'].includes(ext)) {
                type = 'render'
                let seg = this.app._norm_segment(name.slice(0, -(ext.length + 1)))
                let [_params, _url] = this._parse(seg, params, url)     // update accumulators with file segment (without extension)

                if (_params.length) {
                    let regex = new RegExp('^' + _url + '$')
                    this.dynamic_routes.push({type, file: path, ext, regex, param_names: _params, route_path})
                }
                else this.exact_routes.set(route_path, {type, file: path, ext})
            }
        }
    }

    _to_url(file_path) {
        let rel = mod_path.relative(this.app_root, file_path)
        rel = rel.split(mod_path.sep).join('/')
        return '/' + rel
    }

    _parse(segment, params, url) {
        /* Parse another `segment` (dir/file name) of a route file path, and convert it into a list of
           parameter names (_params) and URL regex pattern (_url), to be appended to the corresponding
           `params` and `url` parsed so far for the parent of `segment`.
         */
        let [_params, _url] = this._make_regex(segment)
        params = [...params, ..._params]
        url += '/' + _url
        return [params, url]
    }

    _make_regex(route) {
        /* Convert a route path (segment), possibly containing [NAME] parameters, to a regex matching actual URLs that fill these params.
           Parameters can be embedded within segments, e.g. "prefix[param]suffix" or "a[p1]b[p2]c".
           Returns a pair, [param_names, url_regex_pattern].
         */
        let param_names = []
        let pattern = escapeRegExp(route).replace(/\\\[([^\]]+)\\\]/g, (_, name) => {
            param_names.push(name)
            return '([^/]+)'
        })
        return [param_names, pattern]
    }

    match(url_path) {
        // this.app._print(`match()`, {url_path})

        // request for a static or transpiled file (with extension)
        let entry = this.exact_routes.get(url_path)
        if (entry) return entry

        // renderable route (without extension), exact match first (no parameters)
        let route_path = dropExtension(url_path)
        // this.app._print(`match()`, {route_path})
        let exact = this.exact_routes.get(route_path)
        if (exact) return exact

        // dynamic matches
        for (let route of this.dynamic_routes) {
            let match = route.regex.exec(route_path)
            if (match) {
                let params = {}
                route.param_names.forEach((name, i) => params[name] = match[i + 1])
                return {...route, params}
            }
        }

        return null
    }
}


