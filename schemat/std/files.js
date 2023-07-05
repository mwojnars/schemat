/**********************************************************************************************************************
 **
 **  FILES & FOLDERS items
 **
 */

import {print} from "../utils.js"
import {Item} from "../item.js"
import {HttpService, InternalService} from "../services.js"


/**********************************************************************************************************************/

export class File extends Item {

    process(content) {
        /* Optional processing (e.g., transpiling, compaction) of this file before it gets sent to a client/caller.
           Can be overriden by subclasses.
         */
        return content
    }
    content() {
        /* Initial raw content of this file before any processing. */
        return this.prop('content')
    }
    read() {
        /* Final post-processed (e.g., transpiled, compacted) content of this file. */
        return this.process(this.content())
    }

    // async CALL_import({request}) {
    //     /* Parse the file as a JS module. Return the module, or a selected symbol if request.path is non-empty.
    //        A function for parsing module's source code, parse(source), must be passed in `args` by the caller,
    //        as well as a function for reloading the module from cache without parsing, loadCached(route).
    //      */
    //     let {loadCached, parse} = request.args
    //     let module = loadCached(request.route) || parse(this.read())
    //     if (!request.path) return module
    //
    //     let symbol = request.step()
    //     if (request.move().path) request.throwNotFound()
    //     return module[symbol]
    // }

    setMimeType(res, path) {
        // use the `mimetype` property if present...
        let mimetype = this.prop('mimetype')
        if (mimetype) return res.type(mimetype)

        // ...otherwise, set Content-Type to match the URL path's extension, like in .../file.EXT
        let name = path.split('/').pop()
        let ext  = name.split('.').pop()
        if (ext !== name) res.type(ext)
    }
}

File.createAPI({        // endpoints...

    'CALL/text':    new InternalService(function ({request})
    {
        /* Plain text of this File for Site.import() etc. */
        let txt = this.read()
        if (txt === undefined) request.throwNotFound()
        return txt
    }),

    'GET/file':     new HttpService(function ({res, request})
    {
        // plain text sent over HTTP with a MIME type inferred from URL file extension (!)
        this.setMimeType(res, request.pathFull)
        let txt = this.read()
        if (txt === undefined) request.throwNotFound()
        res.send(txt)
    }),
})


export class FileLocal extends File {
    async init()   { if (this.registry.onServer) this._mod_fs = await import('fs') }

    content(encoding) {
        let path = this.prop('path')
        if (path) return this._mod_fs.readFileSync(path, {encoding})
    }

    // GET_file({res}) {
    //     let path = this.prop('path')
    //     res.sendFile(path, {}, (err) => {if(err) res.sendStatus(err.status)})
    //
    //     // TODO respect the "If-Modified-Since" http header like in django.views.static.serve(), see:
    //     // https://github.com/django/django/blob/main/django/views/static.py
    // }
}

export class Folder extends Item {

    findRoute(request) {
        let step = request.step()
        if (!step) return [this, request, true]         // mark this folder as the target node of the route (true)
        let item = this.prop(`files/${step}`)
        // request.pushMethod('@file')                     // if `item` doesn't provide @file method, its default one will be used
        return [item, request.move(step), item => !(item instanceof Folder)]
    }
}

export class FolderLocal extends Folder {

    async init() {
        if (this.registry.onServer) {
            this._mod_fs = await import('fs')
            this._mod_path = await import('path')        // to avoid awaiting in handlePartial()
        }
    }

    findRoute(request) {
        // always mark this folder as a target: either to display it (empty path), or to pass the execution to .handlePartial()
        return [this, request, true]
    }

    handlePartial(request) {
        let root = this.prop('path')
        root = this._mod_path.resolve(root)                     // make `root` an absolute path
        if (!root) throw new Error('missing `path` property in a FolderLocal')
        let path = this._mod_path.join(root, request.path)      // this reduces the '..' special symbols, so we have to check
        if (!path.startsWith(root)) request.throwNotFound()     // if the final path still falls under the `root`, for security
        if (request.session) request.session.sendFile(path)
        else return this._mod_fs.readFileSync(path, {encoding: 'utf8'})
    }
}

