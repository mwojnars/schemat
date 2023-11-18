/**********************************************************************************************************************
 **
 **  FILES & FOLDERS items
 **
 */

import {print} from "../common/utils.js"
import {Item} from "../item.js"
import {HttpService, InternalService} from "../services.js"


/**********************************************************************************************************************/

export class File extends Item {

    content
    mimetype

    process(content) {
        /* Optional processing (e.g., transpiling, compaction) of this file before it gets sent to a client/caller.
           Can be overriden by subclasses.
         */
        return content
    }
    _content() {
        /* Initial raw content of this file before any processing. */
        return this.content
    }
    read() {
        /* Final post-processed (e.g., transpiled, compacted) content of this file. */
        return this.process(this._content())
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
        let mimetype = this.mimetype
        if (mimetype) return res.type(mimetype)

        // ...otherwise, set Content-Type to match the URL path's extension, like in .../file.EXT
        let name = path.split('/').pop()
        let ext  = name.split('.').pop()
        if (ext !== name) res.type(ext)
    }
}

File.create_api({        // endpoints...

    'CALL/text':    new InternalService(function (request)
    {
        /* Plain text of this File for Site.import() etc. */
        let txt = this.read()
        if (txt === undefined) request.throwNotFound()
        return txt
    }),

    'GET/file':     new HttpService(function (request)
    {
        // plain text sent over HTTP with a MIME type inferred from URL file extension (!)
        this.setMimeType(request.res, request.pathFull)
        let txt = this.read()
        if (txt === undefined) request.throwNotFound()
        request.res.send(txt)
    }),
})


export class FileLocal extends File {

    local_path

    async __init__()  { if (this.registry.onServer) this._mod_fs = await import('fs') }

    _content(encoding) {
        let path = this.local_path
        if (path) return this._mod_fs.readFileSync(path, {encoding})
    }

    // GET_file({request}) {
    //     let path = this.local_path
    //     request.res.sendFile(path, {}, (err) => {if(err) request.res.sendStatus(err.status)})
    //
    //     // TODO respect the "If-Modified-Since" http header like in django.views.static.serve(), see:
    //     // https://github.com/django/django/blob/main/django/views/static.py
    // }
}

export class Directory extends Item {

    findRoute(request) {
        let step = request.step()
        if (!step) return [this, request, true]         // mark this folder as the target node of the route (true)
        let item = this.files.get(step)
        // request.pushMethod('@file')                     // if `item` doesn't provide @file method, its default one will be used
        return [item, request.move(step), item => !(item instanceof Directory)]
    }
}

export class LocalDirectory extends Directory {

    local_path

    async __init__() {
        if (this.registry.onServer) {
            this._mod_fs = await import('node:fs')
            this._mod_path = await import('node:path')        // to avoid awaiting in handlePartial()
        }
    }

    findRoute(request) {
        // always mark this folder as a target: either to display it (empty path), or to pass the execution to .handlePartial()
        return [this, request, true]
    }

    handlePartial(request) {
        let root = this.local_path
        root = this._mod_path.resolve(root)                     // make `root` an absolute path
        if (!root) throw new Error('missing `path` property in a LocalDirectory')
        let path = this._mod_path.join(root, request.path)      // this reduces the '..' special symbols, so we have to check
        if (!path.startsWith(root)) request.throwNotFound()     // if the final path still falls under the `root`, for security
        if (request.res) request.res.sendFile(path)
        else return this._mod_fs.readFileSync(path, {encoding: 'utf8'})
    }
}

