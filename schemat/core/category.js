/**********************************************************************************************************************
 *
 *  Category. Base class for web objects representing categories.
 *
 *  @author Marcin Wojnarski
 *
 */

import {assert, print, T} from "../common/utils.js";
import {Catalog} from "../common/catalog.js";

import {WebObject} from "./object.js";
import {SCHEMA} from "../types/type.js";


/**********************************************************************************************************************/

export class Category extends WebObject {
    /* A category is an object that describes other objects: their schema and functionality;
       also acts as a manager that controls access to, and creation of, new instances ("members") of this category.
       If this category has a `class` defined, all static methods of the corresponding class are accessible via
       this [category] object (they are copied as regular methods into this object).
     */

    /* Properties:

    class           import path of the JavaScript class that should be attached to member objects
    lib
    base_url        canonical public URL base of member objects, i.e., prefix of all URL paths of member objects

    */

    get member_schema() {
        /* Schema of descendant objects in this category, as a SCHEMA instance. NOT the schema of self (.__schema). */
        let strict = !this.allow_custom_fields
        return new SCHEMA({fields: this.schema, strict})
    }

    get member_class() {
        /* JS class of objects in this category, as an imported constructor function. Initially, this property is
           a Promise, which is resolved and replaced with a final value in cache only during this.__load__().
         */
        return schemat.import(this.class)
    }

    get required_attrs() {
        /* List of attributes that have required=true in `schema`. */
        return Object.entries(this.schema).filter(([_, type]) => type.options.required).map(([attr]) => attr)
    }

    get autoload_attrs() {
        /* List of REF attributes that have load=true in `schema`. */
        return Object.entries(this.schema)
                     .filter(([_, type]) => type.options.autoload === true || type.options.autoload === CLIENT_SERVER)
                     .map(([attr]) => attr)
    }

    // get has_strong_refs() {
    //     /* Check if member_schema contains any REF objects with ref.options.strong=true. */
    //     let refs = []
    //     let collect = (ref) => {if (ref.is_strong?.()) refs.push(ref)}
    //     Struct.collect(this.member_schema, collect)
    //     return refs.length
    // }


    is_category()   { return true }

    async __load__(no_await = false) {
        await this.member_class             // from now on, member_class is a regular value in cache, not a promise
        if (SERVER && this.std) {
            let promise = Promise.all(Object.values(this.std).map(obj => obj.load()))
            if (!no_await) await promise    // root category cannot await the related objects, otherwise a deadlock occurs
        }
        this._copy_static()
        return this._init_schema()
    }

    _copy_static() {
        /* Copy all static methods of `member_class` into self as regular methods of `this`. */
        let cls = this.member_class
        if (!cls) return
        
        // get all static methods from member_class, including inherited ones
        let static_methods = Object.getOwnPropertyNames(cls).filter(name => typeof cls[name] === 'function')
        
        // copy each static method to this instance
        for (let method of static_methods)
            this.__self[method] = cls[method].bind(this)
    }

    async _init_schema() {
        // initialize Type objects inside `schema`; in particular, TypeWrapper requires explicit async initialization to load sublinked items
        let fields = Object.values(this.__data.get('schema') || {})
        let calls  = fields.map(type => type.init()).filter(res => res instanceof Promise)
        assert(!calls.length, 'TypeWrapper shall not be used for now')
        if (calls.length) return Promise.all(calls)
    }

    new(props = null, ...args) {
        /* Create a new object in this category and execute its __new__(...args). Return the object (no ID yet). */
        let cls = props?.get?.('__class') || props?.__class || this.member_class
        if (typeof cls === 'string') cls = schemat.get_object(cls)
        assert(!(cls instanceof Promise), `cannot instantly import ${this.class} class to create a new instance of ${this}`)
        return cls._new([this], props, args)
    }

    async list_objects({load = true, ...opts} = {}) {
        /* Return an array of member objects in this category, possibly truncated or re-ordered according to `opts`.
           Can be called on server or client; the list is generated on server.
           If load=true, each of the returned objects is loaded.
         */
        if (SERVER) return schemat.list_category(this, {load, ...opts})
        let records = await schemat.fetch_system(`members/${this.id}`, {json: true})
        return load ?
            Promise.all(records.map(rec => schemat.register_record(rec) && schemat.get_loaded(rec.id))) :
            records.map(id => schemat.get_object(id))
    }

    /***  URL routing  ***/

    // member_url(obj) {
    //     /* Canonical public URL path of a given member object. */
    //     let base = this.base_url || ''
    //     if (base && !base.endsWith('/')) base += '/'
    //     return base + this.member_class.get_slug(obj)
    // }
    //
    // async resolve_url(slug) {
    //     let obj = await this.member_class.resolve_url(slug)
    //     return obj.instanceof(this) ? obj : null        // by default, only objects that belong to this category can be resolved
    // }
}


/**********************************************************************************************************************/

export class RootCategory extends Category {

    static __is_root_category = true

    get __category$() { return [this.__proxy] }
    get __category()  { return this.__proxy }       // root category is a category for itself
    set __category(c) {}                            // only needed due to caching in Intercept; TODO: remove when a proper `cache` sub-object is introduced in Intercept

    get member_schema() {
        /* In RootCategory, this == this.__category, and to avoid infinite recursion we must perform schema inheritance manually. */
        let root_fields = Object.entries(this.__data.get('schema'))
        let default_fields = Object.entries(this.__data.get('defaults')['schema'])
        let fields = new Catalog([...root_fields, ...default_fields])
        let custom = this.__data.get('allow_custom_fields')
        return new SCHEMA({fields: fields.object(), strict: custom !== true})
    }

    async __load__(no_await = false) {
        await super.__load__(true)
    }

    // member_url(obj) {
    //     assert(false)   //TODO
    // }
    //
    // async resolve_url(slug) {
    //     /* Resolves to an object of any category. `slug` is an ID. */
    //     return this.constructor.resolve_url(slug)
    // }
}

