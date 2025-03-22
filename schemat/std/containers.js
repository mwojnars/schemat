/*
    Container classes (Directory, Namespace) for building URL paths and routing requests to items.
 */

import {assert, print, T} from "../common/utils.js"
import {WebObject} from "../core/object.js"
import {URLNotFound, warn} from "../common/errors.js";


/**********************************************************************************************************************/

export class Container extends WebObject {
    /*
       Bidirectional mapping of URL names to objects, and a collection of objects that are all published
       under the same URL path prefix as defined by the parent container(s).
       Container assigns unique identifiers to each member object (identify()) that are used as URL path segments,
       and can map a relative URL path back to an object (resolve()). May contain nested containers.
       It can assign "container access paths" which are like URL paths but with explicit blank segments (/*xxx);
       these paths are used internally to identify objects within a container, before a final URL is generated.
     */

    // properties:
    _is_container

    get __url() {
        /* All containers are exposed on internal URLs to avoid conflicts with URLs of member objects (on blank routes). */
        return this.system_url
    }

    resolve(path) {
        /* Find the web object pointed to by URL `path` and located inside this container or a nested one.
           Return the object in loaded state, or null if not found. Alternatively, a function, f(request),
           can be returned to perform the remaining part of the request handling process.
           This method may return a Promise if an async operation has to be performed during the computation.
           The path is relative to this container's base path and should NOT contain a leading slash.
         */
        return null
    }

    identify(obj) {
        /* Return a unique string identifier of `obj` within this container. Empty string is a *valid* identifier!
           An identifier of the form *XXX denotes a blank segment that should be removed when converting container access path to a URL path.
         */
        throw new Error('not implemented')
    }

    get_access_path(member) {
        /* Return an access path to `member` that starts at the domain root.
           The access path is like a URL path, but with explicit blank segments: /*BLANK
         */
        assert(this.__path, `__path of container [${this.id}] is not initialized (${this.name}) when initializing object [${member.id}]`)
        assert(this.__path[0] === '/', `container's __path must start with '/'`)

        let ident = this.identify(member)
        if (ident === null || ident === undefined) {
            // here, null is returned instead of throwing an error because the mismatch between member's and container's settings may happen temporarily while moving an object from one container to another
            print(`WARNING: container [${this.id}] does NOT include object [${member.id}]`)
            return null
        }

        // the last char in __path can be '/' for the root container, don't add extra '/' in such case
        if (this.__path.endsWith('/')) return this.__path + ident

        return this.__path + '/' + ident
    }

    'edit.del_entry'(key)   {}
}


export class Directory extends Container {

    entries     // Catalog of {name: object} elements in this directory

    get _entries_rev() {
        /* Reverse mapping of objects IDs to their names for fast lookups.
           If an object occurs multiple times in this.entries, the LAST occurrence is recorded (!)
         */
        let rev = new Map()
        for (let [name, object] of this.entries || [])
            rev.set(object.id, name)
        return rev
    }

    get _non_blank_routes() {
        /* A Map like this.entries, but without blank routes. */
        let routes = new Map()
        for (let [name, target] of this.entries || [])
            if (name[0] !== '*')
                if (routes.has(name)) warn(`duplicate non-blank entry (${name}) in directory [${this.id}]`)
                else routes.set(name, target)
        return routes
    }

    get _blank_routes() {
        /* An array of target nodes for all blank routes in this.entries. */
        let nodes = []
        for (let [name, target] of this.entries || [])
            if (name[0] === '*') nodes.push(target)
        return nodes
    }

    async resolve(path) {
        /* Find an object that corresponds to the URL path, `path`. */
        if (path[0] === '/') return null                    // the leading slash should have been dropped already
        let step = path.split('/')[0]
        let rest = path.slice(step.length + 1)

        // first, check non-blank routes for the one matching exactly the `step`
        let node = this._non_blank_routes.get(step)
        if (node) {
            if (!node.is_loaded()) await node.load()
            if (!rest) return node
            if (node._is_container) return node.resolve(rest)
            return null
        }

        // then, iterate over blank routes and try resolving the full `path` through each one
        for (let node of this._blank_routes) {
            if (!node.is_loaded()) await node.load()
            if (!node._is_container) throw new Error(`found a non-container on a blank route (${node.name}), which is not allowed`)

            let target = node.resolve(path)
            if (T.isPromise(target)) target = await target
            if (target) return target
        }
        return null
    }

    identify(obj) {
        assert(obj.id)
        return this._entries_rev.get(obj.id)
    }

    has_entry(key, obj = null) {
        /* If `obj` (web object) is given, check that this particular object (and not any other) is present at a given key. */
        return obj ? obj.is(this.entries.get(key)) : this.entries.has(key)
    }

    'edit.del_entry'(key)           { return this.entries.delete(key) }
    'edit.set_entry'(key, target)   { return this.entries.set(key, target) }
}


/**********************************************************************************************************************/

export class Namespace extends Container {
    /*
        Unbounded collection of objects: each object that satisfies the criteria of the namespace is accepted
        and can receive a (dynamically created) unique identifier, typically built from the object's ID.
        Typically, Namespace is placed as a leaf on a URL route.

        INFO what characters are allowed in URLs: https://stackoverflow.com/a/36667242/1202674
    */
}


export class ObjectSpace extends Namespace {
    /* Web objects accessible through the raw numeric ID url path of the form: /ID
       The set of objects can optionally be restricted to a particular category, although, during resolve(),
       a loading error may be raised even if the object does NOT belong to this namespace (!)
       - that's because the errors are raised before the category check can be made.
     */

    resolve(path) {
        assert(path, `path must be non-empty`)
        try {
            let id = Number(path)
            if (isNaN(id)) return null
            let loading = schemat.get_loaded(id)
            return !this.category ? loading : loading.then(obj => this._is_allowed(obj) ? obj : null)
        }
        catch (ex) { return null }
    }

    identify(obj) {
        assert(obj.id)
        return this._is_allowed(obj) ? `${obj.id}` : null
    }

    _is_allowed(obj) {
        if (!this.category) return true
        for (let category of this.category$)
            if (obj.instanceof(category)) return true
        return false
    }

}

export class Category_IID_Namespace extends Namespace {
    /*
    A collection of objects accessible through human-readable paths of the form: CATEGORY:ID,
    where CATEGORY is a category-specific text qualifier defined in `spaces` property.
    */

    static ID_SEPARATOR = ':'

    spaces

    resolve(path) {
        assert(path, `path must be non-empty`)
        let sep = Category_IID_Namespace.ID_SEPARATOR
        let [space, id, ...rest] = path.split(sep)
        let category = this.spaces.get(space)               // decode space identifier and convert to a category object
        if (!category || rest.length) return null
        return schemat.get_loaded(Number(id))
    }

    identify(obj) {
        let sep = Category_IID_Namespace.ID_SEPARATOR
        let spaces_rev = this.spaces_rev
        let space = spaces_rev.get(obj.__category?.id)
        if (space) return `${space}${sep}${obj.id}`
    }

    get spaces_rev() {
        /* A reverse mapping of category identifiers to space names. Cached. */
        let catalog = this.spaces
        return new Map(catalog.map(({key, value:obj}) => [obj.id, key]))
    }
}

