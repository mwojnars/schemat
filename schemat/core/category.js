/**********************************************************************************************************************
 *
 *  Category. Base class for web objects representing categories.
 *
 *  @author Marcin Wojnarski
 *
 */

import {assert, print, T} from "../common/utils.js";
import {Catalog, Data} from "./catalog.js";

import {WebObject} from "./object.js";
import {SCHEMA} from "../types/catalog_type.js";
import {ReactPage, CategoryInspectView} from "../web/pages.js"
import {JsonGET} from "../web/services.js"
import {mDataRecords} from "../web/messages.js"


/**********************************************************************************************************************/

export class Category extends WebObject {
    /* A category is an item that describes other items: their schema and functionality;
       also acts as a manager that controls access to and creation of new items within category.
     */

    /***  Special properties:
      __child_class         imported JS class of objects in this category
      __child_schema        schema of objects in this category, as a SCHEMA instance; NOT the schema of self (.__schema)
      __source              module source code of this category: all code snippets combined, including inherited ones
    */

    get __child_schema() {
        let fields = this.schema.object()
        let custom = this.allow_custom_fields
        return new SCHEMA({fields, strict: custom !== true})
    }

    get __child_class() { return schemat.import(this.class) }


    is_category()   { return true }

    async __init__() {
        await this.__child_class            // from now on, __child_class is a regular value not a promise
        return this._init_schema()
    }

    async _init_schema() {
        // initialize Type objects inside `schema`; in particular, TypeWrapper requires explicit async initialization to load sublinked items
        let fields = this.__data.get('schema') || []
        let calls  = fields.map(type => type.init()).filter(res => res instanceof Promise)
        assert(!calls.length, 'TypeWrapper shall not be used for now')
        if (calls.length) return Promise.all(calls)
    }

    create(...args) {
        /* Create an empty newborn object (no ID) in this category and execute its __create__(...args). Return the object. */
        return this.__child_class._create([this], ...args)
    }

    async list_objects(opts = {}) {
        /* Return an array of all objects in this category, possibly truncated or re-ordered according to `opts`. */
        return this.GET.list_objects(opts)
    }

    _get_handler(endpoint) {
        // the handler can be defined as a *static* method of this category's __child_class
        return this[endpoint] || this.__child_class[endpoint]
    }

    // get_defaults(prop) {
    //     /* Return an array of default value(s) for a given `prop` as defined in this category's `defaults`
    //        OR in the type's own `default` property. NO imputation even if defined in the prop's type,
    //        because the imputation depends on the target object which is missing here.
    //      */
    //     let type = this.__child_schema.get(prop) || generic_type
    //     let defaults = this.defaults?.getAll(prop) || []
    //     return type.combine_inherited([defaults])
    // }
    //
    // get_default(prop) {
    //     /* Return the first default value for a given `prop`, or undefined. */
    //     return this.get_defaults(prop)[0]
    // }

    // get schema_assets() {
    //     let assets = new Assets()
    //     this.__child_schema.collect(assets)
    //     return this.CACHED_PROP(assets)
    // }


    /***  Dynamic loading of source code from web objects -- NOT USED for now (!)  ***/

    // getClassPath() {
    //     /* Return import path of this category's items' base class, as a pair [module_path, class_name]. */
    //     return splitLast(this.class || '', ':')
    // }
    //
    // get __source() {
    //     /* Combine all code snippets of this category, including inherited ones, into a module source code.
    //        Import the base class, create a Class definition from `class_body`, append view methods, export the new Class.
    //      */
    //     let name = this.class_name || `Class_${this.__id}`
    //     let base = this._codeBaseClass()
    //     let init = this._codeInit()
    //     let code = this._codeClass(name)
    //     let expo = `export {Base, Class, Class as ${name}, Class as default}`
    //
    //     let snippets = [base, init, code, expo].filter(Boolean)
    //     let source = snippets.join('\n')
    //
    //     return this.CACHED_PROP(source)
    // }
    //
    // _codeInit()      { return this._merge_snippets('class_init') }
    // _codeBaseClass() {
    //     /* Source code that imports/loads the base class, Base, for a custom Class of this category. */
    //     let [path, name] = this.getClassPath()
    //     if (name && path) return `import {${name} as Base} from '${path}'`
    //     else if (path)    return `import Base from '${path}'`
    //     else              return 'let Base = WebObject'              // WebObject class is available globally, no need to import
    // }
    // _codeClass(name) {
    //     /* Source code that defines a custom Class of this category, possibly in a reduced form of Class=Base. */
    //     let body = this._codeBody()
    //     // if (!body) return 'let Class = Base'
    //     let def  = body ? `class ${name} extends Base {\n${body}\n}` : `let ${name} = Base`
    //     if (name !== 'Class') def += `\nlet Class = ${name}`
    //     return def
    // }
    // _codeBody() {
    //     /* Source code of this category's dynamic Class body. */
    //     return this._merge_snippets('class_body')
    //     // let body = this.route_local(('class_body')
    //     // let methods = []
    //     // let views = this.prop('views')                              // extend body with VIEW_* methods
    //     // for (let {key: vname, value: vbody} of views || [])
    //     //     methods.push(`VIEW_${vname}(props) {\n${vbody}\n}`)
    //     // return body + methods.join('\n')
    // }
    //
    // _merge_snippets(key, params) {
    //     /* Retrieve all source code snippets (inherited first & own last) assigned to a given `key`.
    //        including the environment-specific {key}_client OR {key}_server keys; assumes the values are strings.
    //        Returns \n-concatenation of the strings found. Used internally to retrieve & combine code snippets.
    //      */
    //     // let side = SERVER ? 'server' : 'client'
    //     // let snippets = this.getMany([key, `${key}_${side}`], params)
    //     let snippets = this[`${key}$`].reverse()
    //     return snippets.join('\n')
    // }
    //
    // _checkPath(request) {
    //     /* Check if the request's path is compatible with the default path of this item. Throw an exception if not. */
    //     let path  = request.path
    //     let dpath = this.__url                      // `path` must be equal to the canonical URL path of this item
    //     if (path !== dpath)
    //         throw new Error(`code of ${this} can only be imported through '${dpath}' path, not '${path}'; create a derived item/category on the desired path, or use an absolute import, or set the "path" property to the desired path`)
    // }
    //
    // static 'GET/import' = new HttpService(function (request) {
    //     /* Send JS source code of this category with a proper MIME type to allow client-side import(). */
    //     this._checkPath(request)
    //     request.res.type('js')
    //     return this.__source
    // })

    /***  Endpoints  ***/

    'GET.inspect'() { return new ReactPage(CategoryInspectView) }

    'GET.list_objects'() {
        return new JsonGET({
            server: (opts) => schemat.list_category(this, {load: true, ...opts}),
            output: mDataRecords,
            // accept: (records) => {
            //     // replace records with fully-loaded objects; there's NO guarantee that a given object was actually built from
            //     // `rec.data` received in this particular request, because a newer record might have arrived in the meantime!
            //     return Promise.all(records.map(rec => schemat.get_loaded(rec.id)))
            // }
        })
    }
}


/**********************************************************************************************************************/

export class RootCategory extends Category {

    static __is_root_category = true

    get __category$() { return [this.__proxy] }
    get __category()  { return this.__proxy }       // root category is a category for itself
    set __category(c) {}                            // only needed due to caching in ItemProxy; TODO: remove when a proper `cache` sub-object is introduced in ItemProxy

    get __child_schema() {
        /* In RootCategory, this == this.__category, and to avoid infinite recursion we must perform schema inheritance manually. */
        let root_fields = this.__data.get('schema')
        let default_fields = this.__data.get('defaults').get('schema')
        let fields = new Catalog(root_fields, default_fields)
        let custom = this.__data.get('allow_custom_fields')
        return new SCHEMA({fields: fields.object(), strict: custom !== true})
    }
}

