import {assert, T} from "../common/utils.js";
import {Catalog, Data} from "./data.js";

import {Item} from "./object.js";
import {DATA} from "../types/catalog.js";
import {ReactPage, CategoryRecordView} from "../web/pages.js"
import {JsonService, Task, TaskService} from "../web/services.js"

export const ROOT_ID = 0


/**********************************************************************************************************************/

export class Category extends Item {
    /* A category is an item that describes other items: their schema and functionality;
       also acts as a manager that controls access to and creation of new items within category.
     */

    /***  Special properties:
      __child_schema        schema of objects in this category, as a DATA instance; NOT the schema of self (.__schema)
      __source              module source code of this category: all code snippets combined, including inherited ones
    */

    get __child_schema() {
        let fields = this.schema.object()
        let custom = this.allow_custom_fields
        return new DATA({fields, strict: custom !== true})
    }

    // get __child_class() { return schemat.site.import(this.class) }      // TODO: add smart caching of Promises in ItemProxy


    async __init__() {
        this.__child_class = await schemat.import(this.class)
        return this._init_schema()
    }

    async _init_schema() {
        // initialize Type objects inside `schema`; in particular, TypeWrapper requires explicit async initialization to load sublinked items
        let fields = this.__data.get('schema') || []
        let calls  = fields.map(type => type.init()).filter(res => res instanceof Promise)
        assert(!calls.length, 'TypeWrapper shall not be used for now')
        if (calls.length) return Promise.all(calls)
    }

    // async new(data = {}) {
    //     /* Create a newborn item of this category (not yet in DB) and set its `data`; set its ID if given.
    //        The order of `data` and `id` arguments can be swapped.
    //      */
    //     // if (typeof data === 'number') [data, id] = [id, data]
    //     assert(data)
    //     if (!(data instanceof Data)) data = new Data(data)
    //     data.set('__category', this)
    //     return Item.from_data(null, data)
    // }

    async list_objects(opts = {}) {
        /* Return an array of all objects in this category, possibly truncated or re-ordered according to `opts`. */
        return schemat.list_category(this, opts)
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
    //     else              return 'let Base = Item'              // Item class is available globally, no need to import
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
    //     // let body = this.route_internal(('class_body')
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
    // static ['GET/import'] = new HttpService(function (request) {
    //     /* Send JS source code of this category with a proper MIME type to allow client-side import(). */
    //     this._checkPath(request)
    //     request.res.type('js')
    //     return this.__source
    // })

    /***  Endpoints  ***/

    static ['GET/record'] = new ReactPage(CategoryRecordView)

    static ['POST/read'] = new TaskService({
        list_items: new Task({
            /* Retrieve all children of `this` category server-side and send them to client as a JSON array
               of flat, fully loaded records.
             */
            async process(request, offset, limit) {
                return this.list_objects({load: true, offset, limit})
            },
            encode_result(items) {
                return items.map(item => item.__record.encoded())
            },
            async decode_result(records) {
                /* Convert records to items client-side and keep in local cache (ClientDB) to avoid repeated web requests. */
                let items = []
                for (const rec of records) {                    // rec's shape: {id, data}
                    if (rec.data) {
                        rec.data = JSON.stringify(rec.data)
                        schemat.db.cache(rec)                   // need to cache the item in ClientDB
                        // schemat.unregister(rec.id)          // evict the item from the cache to allow re-loading
                    }
                    items.push(await schemat.get_loaded(rec.id))
                }
                return items
            }
        }),
    })

    static ['POST/create_item'] = new JsonService(
        async function(request, dataState) {
            /* Create a new item in this category based on request data. */
            let data = Data.__setstate__(dataState)
            data.set('__category', this)
            let id = await schemat.db.insert(data)
            let obj = await schemat.get_loaded(id)
            return obj.__record.encoded()
        },
    // }, //{encodeResult: false}    // avoid unnecessary JSONx-decoding by the client before putting the record in client-side DB
    )


    /***  Actions  ***/

    list_items()            { return this.service.read('list_items') }
    create_item(data)       { return this.service.create_item(data) }
}


/**********************************************************************************************************************/

export class RootCategory extends Category {

    static __is_root_category = true

    __id = ROOT_ID

    get __category$() { return [this.__proxy] }
    get __category()  { return this.__proxy }        // root category is a category for itself
    set __category(c) {}                            // only needed due to caching in ItemProxy; TODO: remove when a proper `cache` sub-object is introduced in ItemProxy

    get __child_schema() {
        /* In RootCategory, this == this.__category, and to avoid infinite recursion we must perform schema inheritance manually. */
        let root_fields = this.__data.get('schema')
        let default_fields = this.__data.get('defaults').get('schema')
        let fields = new Catalog(root_fields, default_fields)
        let custom = this.__data.get('allow_custom_fields')
        return new DATA({fields: fields.object(), strict: custom !== true})
    }
}

