import mod_path from 'node:path'
import {readdir, lstat, realpath} from 'node:fs/promises'
import {escapeRegExp, fileExtension, dropExtension} from '../common/utils.js'


/**********************************************************************************************************************/

export class Routes {
    /* Pre-scans the application's root folder and builds an in-memory URL routing table.
       Supports next.js-like dynamic segments using [param] in file and folder names.
     */

    exact_routes      // Map(route_path_without_ext -> {type, file, ext}) for renderable files
    dynamic_routes    // Array<{type, file, ext, param_names, regex, route_path}>

    constructor(app) {
        this.app = app
        this.app_root = app._app_root
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

    async _walk(parent, params = [], url = '') {
        let entries = await readdir(parent, {withFileTypes: true})
        
        // sort entries by replacing '(' and '[' with high-code chars to control segment order
        const HIGH_CHAR = '\uffff'
        const HIGH_CHAR_2 = '\ufffe'  // one less than HIGH_CHAR
        entries.sort((a, b) => {
            let a_sort = a.name.replaceAll('(', HIGH_CHAR_2).replaceAll('[', HIGH_CHAR)
            let b_sort = b.name.replaceAll('(', HIGH_CHAR_2).replaceAll('[', HIGH_CHAR)
            return a_sort.localeCompare(b_sort)
        })
        
        for (let ent of entries) {
            let name = ent.name
            let path = mod_path.join(parent, name)

            if (this.app._is_private_name.test(name)) continue

            if (ent.isSymbolicLink())
                ent = await lstat(await realpath(path))

            if (ent.isDirectory()) {
                if (name === 'node_modules') continue                   // protection against accidental scanning of a big source tree
                if (name[0] === '(' && name.endsWith(')')) name = ""    // drop virtual directories, like "(root)", from the URL
                let [_params, _url] = this._parse(name, params, url)    // update accumulators with this directory segment
                await this._walk(path, _params, _url)
                continue
            }

            if (!ent.isFile()) continue

            let ext = fileExtension(name).toLowerCase()
            if (ext) name = name.slice(0, -(ext.length + 1))            // from now on, `name` includes no extension

            let url_path = '/' + mod_path.relative(this.app_root, path) // truncate the leading `app_root` path
            let route_path = url_path.slice(0, -(ext.length + 1))       // drop ".ext"

            // schemat._print(`_walk():`, {path, url_path, route_path})

            route_path = this.app._norm_segment(route_path)             // replace dots with slashes
            if (ext) url_path = route_path + '.' + ext

            // determine route type based on extension
            let type = null
            if (this.app._static_exts.includes(ext)) type = 'static'
            else if (this.app._transpiled_exts.includes(ext)) type = 'transpiled'
            
            if (type) this.exact_routes.set(url_path, {type, path, ext})

            // renderable files become routes without extension
            if (this.app._rendered_exts.includes(ext)) {
                type = 'render'

                if (name === this.app.default_route) {                  // drop default route name (ex. "index") from the URL
                    route_path = route_path.slice(0, -(name.length + 1))
                    name = ""
                }

                let segm = this.app._norm_segment(name)
                let [_params, _url] = this._parse(segm, params, url)    // update accumulators with file segment (without extension)

                if (_params.length) {
                    let regex = new RegExp('^' + _url + '$')
                    this.dynamic_routes.push({route_path, type, path, ext, regex, param_names: _params})
                }
                else this.exact_routes.set(route_path, {type, path, ext})
            }
        }
    }

    _parse(segment, params, url) {
        /* Parse another `segment` (dir/file name) of a route file path, and convert it into a list of
           parameter names (_params) and URL regex pattern (_url), to be appended to the corresponding
           `params` and `url` parsed so far for the parent of `segment`.
         */
        let [_params, _url] = this._make_regex(segment)
        params = [...params, ..._params]
        if (_url) url += '/' + _url
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
        if (url_path === '/') url_path = ''             // canonical representation of URL root

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


