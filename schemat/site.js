import { print, assert, splitLast, T } from './utils.js'
import { ItemsMap } from './data.js'
import { Item } from './item.js'


/**********************************************************************************************************************
 **
 **  ITEM SUBCLASSES
 **
 */

export class Site extends Item {
    /* Global configuration of all applications that comprise this website, with URL routing etc. */

    static SEP_ENDPOINT = '@'       // separator of an item path and an endpoint name within a URL path

    async execute(session) {
        /* Set `ipath` and `endpoint` in request. Forward the request to a root application from the `app` property. */
        let app  = await this.getLoaded('application')
        let path = session.request.path, sep = Site.SEP_ENDPOINT;
        [session.ipath, session.endpoint] = path.includes(sep) ? splitLast(path, sep) : [path, '']
        return app.execute(session.ipath, session)
    }

    systemURL() {
        /* Absolute base URL for system calls originating at a web client and targeting specific items. */
        return this.get('base_url') + this.get('system_path')
    }

    buildURL(item, {route, relative = true, baseURL, endpoint, args} = {}) {
        /*
        Return a relative URL of `item` as assigned by the deep-most Application (if no `route`)
        that's processing the current web request; or an absolute or relative URL
        assigned by an application anchored at a given `route`.
        */
        let url = this.url_path(item, {route, relative, baseURL})
        return this.setEndpoint(url, endpoint, args)              // append `endpoint` and `args` to the URL
    }

    url_path(item, {route, relative, baseURL}) {

        // relative URL anchored at the deep-most application's route
        if (route === undefined) {
            let app  = this.registry.session.app
            app.assertLoaded()
            let path = app.url_path(item, {relative})
            return './' + path      // ./ informs the browser this is a relative path, even if dots and ":" are present similar to a domain name with http port
        }

        // NOTE: the code below is never used right now, all calls leave route=undefined (??)

        // relative URL anchored at `route`
        let root = this.get('application'); root.assertLoaded()
        let path = root.url_path(item, {route, relative})
        if (relative) return path

        // absolute URL without base?
        path = '/' + path
        if (!baseURL) return path

        // absolute URL with base (protocol+domain+port)
        let base = (typeof baseURL === 'string') ? baseURL : this.get('base_url')
        if (base.endsWith('/')) base = base.slice(-1)
        return base + path
    }
    setEndpoint(url, endpoint, args) {
        if (endpoint) url += `${Site.SEP_ENDPOINT}${endpoint}`
        if (args) url += '?' + new URLSearchParams(args).toString()
        return url
    }
}

export class Application extends Item {
    /*
    An application implements a mapping of URL paths to item methods, and the way back.
    Some application classes may support nested applications.
    INFO what characters are allowed in URLs: https://stackoverflow.com/a/36667242/1202674
    */
    static SEP_ROUTE = '/'      // separator of route segments in URL, each segment corresponds to another (sub)application

    async execute(action, session) {
        /*
        Execute an `action` that originated from a web `request` and emit results to a web `response`.
        Typically, `action` is a URL path or subpath that points to an item and its particular view
        that should be rendered in response; this is not a strict rule, however.

        When spliting an original request.path on SEP_ROUTE, parent applications should ensure that
        the separatoror (if present) is preserved in a remaining subpath, so that sub-applications
        can differentiate between URLs of the form ".../PARENT/" and ".../PARENT".
        */
        throw new Error('method not implemented in a subclass')
    }
    url_path(item, {route, relative}) {
        /*
        Generate URL path (URL fragment after route) for `item`.
        If relative=true, the path is relative to a given application `route`; otherwise,
        it is absolute, i.e., includes segments for all intermediate applications below this one;
        the path does NOT have a leading separator, or it has a different meaning -
        in any case, a leading separator should be appended by caller if needed.
        */
        throw new Error('method not implemented in a subclass')
    }
}

export class AppRoot extends Application {
    /* A set of sub-applications, each bound to a different URL prefix. */

    async execute(path, session) {
        /*
        Find an application in 'apps' that matches the requested URL path and call its execute().
        `path` can be an empty string; if non-empty, it starts with SEP_ROUTE character.
        */
        let [step, app, subpath] = this._route(path)
        await app.load()
        return app.execute(subpath, session)
    }

    _route(path = '') {
        /*
        Make one step forward along a URL `path`. Return the extracted route segment (step),
        the associated application object, and the remaining subpath.
        */
        let lead = 0, step

        // consume leading '/' (lead=1) when it's followed by text, but treat it as terminal
        // and preserve in a returned subpath otherwise
        if (path.startsWith(Application.SEP_ROUTE)) {
            lead = (path.length >= 2)
            step = path.slice(1).split(Application.SEP_ROUTE)[0]
        } else
            step = path.split(Application.SEP_ROUTE)[0]
        
        let apps = this.get('apps')
        let app  = apps.get(step)
        
        if (step && app)                        // non-default (named) route can be followed with / in path
            return [step, app, path.slice(lead + step.length)]
        
        if (apps.has(''))                      // default (unnamed) route has special format, no "/"
            return ['', apps.get(''), path]
        
        throw new Error(`URL path not found: ${path}`)
    }

    url_path(item, opts = {}) {

        let [step, app, path] = this._route(opts.route)
        app.assertLoaded()
        // app.requestLoaded() -- if (!app.loaded) { session.itemsRequested.push(app); throw ... or return undefined }
        let subpath = app.url_path(item, {...opts, route: path})
        if (opts.relative) return subpath                           // path relative to `route`
        let segments = [step, subpath].filter(Boolean)              // only non-empty segments
        return segments.join(Application.SEP_ROUTE)                 // absolute path, empty segments excluded
    }
}

export class AppSystem extends Application {
    /* System space with admin interface. All items are accessible through the 'raw' routing pattern: .../CID:IID */
    
    async execute(path, session) {
        let item = await this._find_item(path)
        return item.handle(session, this)
    }
    async _find_item(path) {
        /* Extract (CID, IID) from a raw URL of the form CID:IID, return as an item. */
        let id
        try { id = path.slice(1).split(':').map(Number) }
        catch (ex) { throw new Error(`URL path not found: ${path}`) }
        return this.registry.getLoaded(id)
    }
    url_path(item, opts = {}) {
        assert(item.has_id())
        let [cid, iid] = item.id
        return `${cid}:${iid}`
    }
}

export class AppFiles extends Application {
    /*
    Filesystem application. Folders and files are accessible through the hierarchical
    "file path" routing pattern: .../dir1/dir2/file.txt
    */
    async execute(path, session) {
        /* Find an item (file/folder) pointed to by `path` and call its handle(). */

        if (!path.startsWith('/'))
            return session.redirect(session.ipath + '/')
        // TODO: make sure that special symbols, e.g. SEP_ENDPOINT, are forbidden in file paths

        session.app = this
        let root = await this.getLoaded('root_folder') || await this.registry.files
        return root.execute(path, session)     // `root` must be an item of Folder_ or its subcategory
    }

    url_path(item, opts = {}) {
        // TODO: convert folder-item relationship to bottom-up to avoid using current_request.state
        let state = this.registry.session.state
        return state.folder.get_name(item)
    }
}

export class AppSpaces extends Application {
    /*
    Application for accessing individual objects (items) through verbose paths of the form: .../SPACE:IID,
    where SPACE is a text identifier assigned to a category in `spaces` property.
    */
    url_path(item, opts = {}) {
        let spaces_rev = this.temp('spaces_rev')
        let space = spaces_rev.get(item.category.id)
        if (!space) throw new Error(`URL path not found for items of category ${item.category}`)
        return `${space}:${item.iid}`
    }
    _temp_spaces_rev()    { return ItemsMap.reversed(this.get('spaces')) }

    async execute(path, session) {
        // decode space identifier and convert to a category object
        let category, [space, item_id] = path.slice(1).split(':')
        category = await this.getLoaded(`spaces/${space}`)
        if (!category) return session.sendStatus(404)
        let item = category.getItem(Number(item_id))
        return item.handle(session, this)
    }
}

/**********************************************************************************************************************
 **
 **  FILES & FOLDERS
 **
 */

export class File extends Item {
    async read() {
        return this.get('content')
    }
    // async _handle_download() {
    //     /* Return full content of this file, either as <str> or a Response object. */
    //     return this.read()
    // }
}

export class FileLocal extends File {
    async read(encoding = 'utf8') {
        let fs = await import('fs')
        let path = this.get('path')
        if (path) return fs.readFileSync(path, {encoding})
    }
    _handle_download({res}) {
        let content = this.get('content', null)
        if (typeof content === 'string')
            return res.send(content)
        
        let path = this.get('path', null)
        if (!path) res.sendStatus(404)

        res.sendFile(path, {}, (err) => {if(err) res.sendStatus(err.status)})

        // TODO respect the "If-Modified-Since" http header like in django.views.static.serve(), see:
        // https://github.com/django/django/blob/main/django/views/static.py
    }
}

export class Folder extends Item {
    static SEP_FOLDER = '/'          // separator of folders in a file path

    async execute(path, session) {
        /* Propagate a web request down to the nearest object pointed to by `path`.
           If the object is a Folder, call its execute() with a truncated path. If the object is an item, call its handle().
         */
        if (path.startsWith(Folder.SEP_FOLDER)) path = path.slice(1)
        let name = path.split(Folder.SEP_FOLDER)[0]
        let item = this

        if (name) {
            item = this.get(`files/${name}`)
            if (!item) throw new Error(`URL path not found: ${path}`)
            assert(item instanceof Item, `not an item: ${item}`)
            path = path.slice(name.length+1)
        }

        if (item.get('_is_file')) {
            if (path) throw new Error('URL not found')
            session.endpointDefault = 'download'
        }
        else if (item.get('_is_folder')) {
            // request.endpointDefault = 'browse'
            if (path) return item.execute(path, session)
            else session.state.folder = item                 // leaf folder, for use when generating file URLs (url_path())
        }

        return item.handle(session)
    }

    // exists(path) {
    //     /* Check whether a given path exists in this folder. */
    // }
    search(path) {
        /*
        Find an object pointed to by `path`. The path may start with '/', but this is not obligatory.
        The search is performed recursively in subfolders.
        */
        if (path.startsWith(Folder.SEP_FOLDER)) path = path.slice(1)
        let item = this
        while (path) {
            let name = path.split(Folder.SEP_FOLDER)[0]
            item = item.get(`files/${name}`)
            path = path.slice(name.length+1)
        }
        return item
    }
    read(path) {
        /* Search for a File/FileLocal pointed to by a given `path` and return its content as a utf8 string. */
        let f = this.search(path)
        if (f instanceof File) return f.read()
        throw new Error(`not a File: ${path}`)
    }
    get_name(item) {
        /* Return a name assigned to a given item. If the same item is assigned multiple names,
        the last one is returned. */
        let names = this.temp('names')
        return names.get(item.id, null)
    }
    _temp_names()     { return ItemsMap.reversed(this.get('files')) }
}

export class FolderLocal extends Folder {

    async execute(path, session) {
        /* Find `path` on the local filesystem and send the file pointed to by `path` back to the client (download).
           FolderLocal does NOT provide web browsing of files and nested folders.
         */
        if (path.startsWith(Folder.SEP_FOLDER)) path = path.slice(1)
        if (!path) return this.handle(session)          // if no file `path` given, display this folder as a plain item

        let root = this.get('path')
        if (!root) throw new Error('missing `path` property in a FolderLocal')
        if (!root.endsWith('/')) root += '/'

        let fspath   = await import('path')
        let fullpath = fspath.join(root, path)              // this interpretes and reduces the '..' symbols, so we have to check
        if (!fullpath.startsWith(root))                     // if the final path still falls under the `root`, for security
            throw new Error(`URL path not found: ${path}`)

        session.sendFile(fullpath, {}, (err) => {if(err) session.sendStatus(err.status)})
    }
    get_name(item) { return null }
}

