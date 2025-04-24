/**********************************************************************************************************************
 **
 **  FILES & FOLDERS items
 **
 */

import {print, assert} from "../common/utils.js"
import {WebObject} from "../core/object.js"
import {Directory} from "./containers.js";

const {transform_postcss} = SERVER && await import("./transforms.js")


/**********************************************************************************************************************/

function _set_mimetype(res, path, mimetype = null) {
    /* Set the Content-Type header of the HTTP response `res` based on the file's extension in `path` or `mimetype`. */
    if (mimetype) return res.type(mimetype)

    let name = path.split('/').pop()
    let ext = name.split('.').pop()
    if (ext === name) return                    // no extension found

    const substitutions = {
        'pcss': 'css',                          // PostCSS
    }

    // make lowercase and apply substitutions
    ext = ext.toLowerCase()
    if (ext in substitutions) ext = substitutions[ext]

    res.type(ext)
}


/**********************************************************************************************************************/

export class File extends WebObject {

    content
    mimetype

    _content() {
        /* Initial raw content of this file before any processing. */
        return this.content
    }

    // get content_processed() {
    //     return this.process(this._content())
    // }
    //
    // process(content) {
    //     /* Optional processing (e.g., transpiling, compaction) of this file before it gets sent to a client/caller.
    //        Can be overriden by subclasses.
    //      */
    //     return content
    // }

    // async LOCAL_import({request}) {
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
    //
    // static 'LOCAL/text' = new InternalService(function (request)
    // {
    //     /* Plain text of this File for Application.import() etc. */
    //     assert(false, 'NOT USED: File.LOCAL/text')
    //     let txt = this.content_processed
    //     if (txt === undefined) request.throwNotFound()
    //     return txt
    // })
    //
    // static 'GET/file' = new HttpService(function (request)
    // {
    //     // plain text sent over HTTP with a MIME type inferred from URL file extension
    //     assert(false, 'NOT USED: File.GET/file')
    //     _set_mimetype(request.res, request.path, this.mimetype)
    //     let txt = this.content_processed
    //     if (txt === undefined) request.throwNotFound()
    //     return txt
    // })
}


export class LocalFile extends File {

    local_path

    async __init__()  { if (SERVER) this._mod_fs = await import('node:fs') }

    _content(encoding) {
        let path = this.local_path
        if (path) return this._mod_fs.readFileSync(path, {encoding})
    }

    // 'GET.file'({request}) {
    //     let path = this.local_path
    //     request.res.sendFile(path, {}, (err) => {if(err) request.res.sendStatus(err.status)})
    //
    //     // TODO respect the "If-Modified-Since" http header like in django.views.static.serve(), see:
    //     // https://github.com/django/django/blob/main/django/views/static.py
    // }
}

export class LocalDirectory extends Directory {
    /* File directory on the local filesystem containing files and subfolders (no objects). */

    local_path
    extensions_allowed
    paths_forbidden
    paths_allowed

    async __init__() {
        if (SERVER) {
            this._mod_fs = await import('node:fs')
            this._mod_path = await import('node:path')
        }
    }

    resolve(path) {
        if (!this.local_path) return null
        let root = this._mod_path.resolve(this.local_path)          // make `root` an absolute path

        // check if the local path still falls under the `root` after ".." reduction
        let file_path = this._mod_path.join(root, path)
        if (!file_path.startsWith(root)) return null

        let subpath = file_path.slice(root.length + 1)              // truncate 'root' from 'file_path'
        if (!this._paths_allowed.includes(subpath)) {               // only if the path is NOT explicitly allowed, there's need for further checks

            // check if the file extension of `path` is in the list of allowed extensions
            let ext = path.split('.').pop().toLowerCase()
            if (!this._ext_allowed.includes(ext)) return null

            // check if the path possibly contains a forbidden substring
            if (this._paths_forbid.some(s => file_path.includes(s))) {
                print(`LocalDirectory._read_file(), forbidden path requested: '${file_path}'`)
                return null
            }
        }

        return (request) => this._read_file(file_path, request.res)
    }

    get _ext_allowed()      { return this.extensions_allowed.toLowerCase().split(/[ ,;:]+/) }
    get _paths_forbid()     { return this.paths_forbidden?.split(/\s+/) || [] }
    get _paths_allowed()    { return this.paths_allowed?.split(/\s+/) || [] }

    async _read_file(path, res) {
        // file transforms to be applied
        let transforms = [
            this._transform_postcss.bind(this),
        ]

        let buffer = this._mod_fs.readFileSync(path)
        buffer = await this._apply_transforms(transforms, buffer, path)

        // TODO: the code below implements LOCAL requests and should return a buffer instead (no utf-8 decoding) to support all files incl. binary
        if (!res) {
            assert(false, `LocalDirectory._read_file(): LOCAL request received for '${path}', returning file content as a string not binary`)
            return this._mod_fs.readFileSync(path, {encoding: 'utf8'})
        }

        _set_mimetype(res, path)
        res.send(buffer)
    }

    async _apply_transforms(transforms, buffer, file_path) {
        /* Perform all eligible `transforms` of the file whose content is provided in a `buffer`. */

        let content = buffer.toString('utf8')
        let ext = file_path.split('.').pop().toLowerCase()

        try {
            for (let transform of transforms) {
                let result = transform(buffer, content, file_path, ext)
                if (result instanceof Promise) result = await result
                if (result) {
                    buffer = result
                    content = buffer.toString('utf8')
                }
            }
        }
        catch (e) { console.error(`Error transforming content of '${file_path}':`, e) }

        return buffer
    }

    async _transform_postcss(buffer, content, file_path, ext) {
        /* Transform a css file via PostCSS. The file must either have .scss or .postcss extension, or contain
           a directive in the first 10 lines: `/* @postcss *\/` or `@use postcss;`.
         */

        let header = content.split('\n').slice(0, 10).join('\n')
        let postcss_directive = /\/\*\s*@postcss\s*\*\/|@use\s+postcss\s*;/i

        let eligible = (ext === 'pcss' || ext === 'postcss' || (ext === 'css' && postcss_directive.test(header)))
        if (!eligible) return null

        assert(transform_postcss, "transforms.js not imported")
        let output = await transform_postcss(content, file_path)

        // print('\n_transform_postcss() input:\n', content)
        // print('\n_transform_postcss() output:\n', output)

        return Buffer.from(output, "utf-8")
    }
}

