/**********************************************************************************************************************
 **
 **  FILES & FOLDERS items
 **
 */

import {print, assert} from "../common/utils.js"
import {Item} from "../item.js"
import {HttpService, InternalService} from "../web/services.js"
import {Directory} from "./containers.js";
import {UrlPathNotFound} from "../common/errors.js";

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
        assert(false, 'NOT USED: File.CALL/text')
        let txt = this.content_processed
        if (txt === undefined) request.throwNotFound()
        return txt
    })

    static ['GET/file'] = new HttpService(function (request)
    {
        // plain text sent over HTTP with a MIME type inferred from URL file extension
        assert(false, 'NOT USED: File.GET/file')
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

    async _read_file(url_path, res) {
        let root = this.local_path
        root = this._mod_path.resolve(root)                         // make `root` an absolute path

        if (!root) throw new Error('missing `path` property in a LocalFolder')
        let file_path = this._mod_path.join(root, url_path)         // this reduces the '..' special symbols, so we have to check
        if (!file_path.startsWith(root))                            // if the final path still falls under the `root`, for safety
            throw new UrlPathNotFound({path: url_path})
        
        // check if the path contains a folder name that starts with "_" (underscore), which indicates a PRIVATE folder; return "not found" in such case
        if (file_path.includes('/_')) {
            print(`LocalFolder._read_file(): PRIVATE folder requested: '${file_path}'`)
            throw new UrlPathNotFound({path: url_path})
        }

        // file transforms to be applied
        let transforms = [
            this._transform_postcss.bind(this),
        ]

        let buffer = this._mod_fs.readFileSync(file_path)
        buffer = await this._apply_transforms(transforms, buffer, file_path)

        // TODO: the code below implements CALL requests and should return a buffer instead (no utf-8 decoding) to support all files incl. binary
        if (!res) {
            assert(false, `LocalFolder._read_file(): CALL request received for '${file_path}', returning file content as a string not binary`)
            return this._mod_fs.readFileSync(file_path, {encoding: 'utf8'})
        }

        _set_mimetype(res, file_path)
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

