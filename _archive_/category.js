import {WebObject} from "./object.js";
import {ReactPage, CategoryInspectView} from "../web/pages.js"
import {JsonGET} from "../web/services.js"
import {mWebObjects} from "../web/messages.js"


export class Category extends WebObject {

    async list_objects(opts = {}) {
        /* Return an array of all objects in this category, possibly truncated or re-ordered according to `opts`. */
        return this.GET.list_objects(opts)
    }

    _get_handler(endpoint) {
        /* Web handler can be defined as a *static* method of this category's member_class. */
        assert(!(this.member_class instanceof Promise))
        return this.__self[endpoint] || this.member_class[endpoint]
    }


    get_defaults(prop) {
        /* Return an array of default value(s) for a given `prop` as defined in this category's `defaults`
           OR in the type's own `default` property. NO imputation even if defined in the prop's type,
           because the imputation depends on the target object which is missing here.
         */
        let type = this.member_schema.get(prop) || generic_type
        let defaults = this.defaults?.getAll(prop) || []
        return type.combine_inherited([defaults])
    }

    get_default(prop) {
        /* Return the first default value for a given `prop`, or undefined. */
        return this.get_defaults(prop)[0]
    }

    get schema_assets() {
        let assets = new Assets()
        this.member_schema.collect(assets)
        return this.CACHED_PROP(assets)
    }


    /***  Dynamic loading of source code from web objects -- NOT USED for now (!)  ***/

    getClassPath() {
        /* Return import path of this category's items' base class, as a pair [module_path, class_name]. */
        return splitLast(this.class || '', ':')
    }

    get __source() {
        /* Combine all code snippets of this category, including inherited ones, into a module source code.
           Import the base class, create a Class definition from `class_body`, append view methods, export the new Class.
         */
        let name = this.class_name || `Class_${this.id}`
        let base = this._codeBaseClass()
        let init = this._codeInit()
        let code = this._codeClass(name)
        let expo = `export {Base, Class, Class as ${name}, Class as default}`

        let snippets = [base, init, code, expo].filter(Boolean)
        let source = snippets.join('\n')

        return this.CACHED_PROP(source)
    }

    _codeInit()      { return this._merge_snippets('class_init') }
    _codeBaseClass() {
        /* Source code that imports/loads the base class, Base, for a custom Class of this category. */
        let [path, name] = this.getClassPath()
        if (name && path) return `import {${name} as Base} from '${path}'`
        else if (path)    return `import Base from '${path}'`
        else              return 'let Base = WebObject'              // WebObject class is available globally, no need to import
    }
    _codeClass(name) {
        /* Source code that defines a custom Class of this category, possibly in a reduced form of Class=Base. */
        let body = this._codeBody()
        // if (!body) return 'let Class = Base'
        let def  = body ? `class ${name} extends Base {\n${body}\n}` : `let ${name} = Base`
        if (name !== 'Class') def += `\nlet Class = ${name}`
        return def
    }
    _codeBody() {
        /* Source code of this category's dynamic Class body. */
        return this._merge_snippets('class_body')
        // let body = this.route_local(('class_body')
        // let methods = []
        // let views = this.prop('views')                              // extend body with VIEW_* methods
        // for (let {key: vname, value: vbody} of views || [])
        //     methods.push(`VIEW_${vname}(props) {\n${vbody}\n}`)
        // return body + methods.join('\n')
    }

    _merge_snippets(key, params) {
        /* Retrieve all source code snippets (inherited first & own last) assigned to a given `key`.
           including the environment-specific {key}_client OR {key}_server keys; assumes the values are strings.
           Returns \n-concatenation of the strings found. Used internally to retrieve & combine code snippets.
         */
        // let side = SERVER ? 'server' : 'client'
        // let snippets = this.getMany([key, `${key}_${side}`], params)
        let snippets = this[`${key}$`].reverse()
        return snippets.join('\n')
    }

    _checkPath(request) {
        /* Check if the request's path is compatible with the default path of this item. Throw an exception if not. */
        let path  = request.path
        let dpath = this.__url                      // `path` must be equal to the canonical URL path of this item
        if (path !== dpath)
            throw new Error(`code of ${this} can only be imported through '${dpath}' path, not '${path}'; create a derived item/category on the desired path, or use an absolute import, or set the "path" property to the desired path`)
    }

    static 'GET/import' = new HttpService(function (request) {
        /* Send JS source code of this category with a proper MIME type to allow client-side import(). */
        this._checkPath(request)
        request.res.type('js')
        return this.__source
    })

    /***  Endpoints  ***/

    'GET.inspect'() { return new ReactPage(CategoryInspectView) }

    'GET.list_objects'() {
        return new JsonGET({
            server: (opts) => schemat.list_category(this, {load: true, ...opts}),
            output: mWebObjects,
        })
    }

    'act.insert'(...args) {
        /* Create a new object of this category inside a transaction and insert it to the database (tx.save() invoked automatically). */
        return this.new(...args)

        // TX+DB operations performed in the background:
        // - the new object is registered in TX and receives a provisional ID
        // - a request is sent over HTTP to an edge server
        // - the edge server sends an RCP request over TCP to a data block agent
        // - the object is written to DB where its record receives a proper ID
        // - record + ID are transferred back to edge server & client
        // - TX writes the final ID into the object, so it can be serialized by JSONx when completing the action
        // - JsonPOST + JSONx write the ID in HTTP response (serialized representation of the "result" object);
        //   "records" are appended to the response, where the DB content of the object is included
        // - client deserializes "records" and saves the object's record in the Registry, then it deserializes the object itself
        //   from its ID via JSONx, which pulls the record from Registry and recreates the object as a stub with proper ID (no content)
    }
}
