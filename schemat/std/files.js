/**********************************************************************************************************************
 **
 **  FILES & FOLDERS items
 **
 */

import {print} from "../common/utils.js"
import {Item} from "../item.js"
import {HttpService, InternalService} from "../services.js"
import {Directory} from "./containers.js";
import {UrlPathNotFound} from "../common/errors.js";


/**********************************************************************************************************************/

function _set_mimetype(res, path, mimetype = null) {
    /* Set the Content-Type header of the HTTP response `res` based on the file's extension in `path` or `mimetype`. */
    if (mimetype) return res.type(mimetype)

    let name = path.split('/').pop()
    let ext = name.split('.').pop()
    if (ext !== name) res.type(ext)
}


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

    get content_processed() {
        return this.CACHED_PROP(this.process(this._content()))
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

    static ['CALL/text'] = new InternalService(function (request)
    {
        /* Plain text of this File for Site.import() etc. */
        let txt = this.content_processed
        if (txt === undefined) request.throwNotFound()
        return txt
    })

    static ['GET/file'] = new HttpService(function (request)
    {
        // plain text sent over HTTP with a MIME type inferred from URL file extension
        _set_mimetype(request.res, request.path, this.mimetype)
        let txt = this.content_processed
        if (txt === undefined) request.throwNotFound()
        return txt
    })
}


export class FileLocal extends File {

    local_path

    async __init__()  { if (schemat.server_side) this._mod_fs = await import('node:fs') }

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

export class LocalFolder extends Directory {
    /* A folder on the local filesystem containing files and subfolders (no objects). */

    local_path

    async __init__() {
        if (schemat.server_side) {
            this._mod_fs = await import('node:fs')
            this._mod_path = await import('node:path')
        }
    }

    resolve(path) {
        return (request) => this._read_file(path, request.res)
    }

    _read_file(url_path, res) {
        let root = this.local_path
        root = this._mod_path.resolve(root)                         // make `root` an absolute path

        if (!root) throw new Error('missing `path` property in a LocalFolder')
        let file_path = this._mod_path.join(root, url_path)         // this reduces the '..' special symbols, so we have to check
        if (!file_path.startsWith(root))                            // if the final path still falls under the `root`, for safety
            throw new UrlPathNotFound({path: url_path})

        // TODO: the code below implements CALL requests and should return a buffer instead (no utf-8 decoding) to support all files incl. binary
        if (!res) return this._mod_fs.readFileSync(file_path, {encoding: 'utf8'})

        let buffer = this._mod_fs.readFileSync(file_path)
        _set_mimetype(res, file_path)
        res.send(buffer)

        // if (res) res.sendFile(file_path)
        // else return this._mod_fs.readFileSync(file_path, {encoding: 'utf8'})
    }
}

