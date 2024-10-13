/*
    Container classes (Directory, Namespace) for building URL paths and routing requests to items.
 */

import {assert, print, T} from "../common/utils.js"
import {WebObject} from "../core/object.js"
import {UrlPathNotFound, warn} from "../common/errors.js";


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

    _impute__url() {
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

    identify(item) {
        /* Return a unique string identifier of `item` within this container. Empty string is a *valid* identifier!
           An identifier of the form *XXX denotes a blank segment that should be removed when converting container access path to a URL path.
         */
        throw new Error('not implemented')
    }

    get_access_path(member) {
        /* Return an access path to `member` that starts at the domain root.
           The access path is like a URL path, but with explicit blank segments: /*BLANK
         */
        assert(this.__path, `container's __path is not initialized (${this.name} ${this.__id})`)
        assert(this.__path[0] === '/', `container's __path must start with '/'`)

        let ident = this.identify(member)
        if (ident === null || ident === undefined) {
            // here, null is returned instead of throwing an error because the mismatch between member's and container's settings may happen temporarily while moving an object from one container to another
            print(`WARNING: container [${this.__id}] does NOT include object [${member.__id}]`)
            return null
        }

        // the last char in __path can be '/' for the root container, don't add extra '/' in such case
        if (this.__path.endsWith('/')) return this.__path + ident

        return this.__path + '/' + ident
    }
}


export class Directory extends Container {

    get _entries_rev() {
        /* Reverse mapping of objects IDs to their names for fast lookups.
           If an object occurs multiple times in this.entries, the LAST occurrence is recorded (!)
         */
        let rev = new Map()
        for (let [name, object] of this.entries || [])
            rev.set(object.__id, name)
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

    // async resolve(path, explicit_blank = false) {
    //     /* If `explicit_blank` is true, the path is an internal "container path" that includes explicit blank segment(s)
    //        (a/*BLANK/b/c); otherwise, the path is a "URL path" with blank segments hidden (a/b/c).
    //      */
    //     if (path[0] === '/') path = path.slice(1)           // drop the leading slash
    //     if (!path) return this
    //     let step = path.split('/')[0]
    //     let rest = path.slice(step.length + 1)
    //
    //     for (let [name, node] of this.entries || []) {
    //
    //         assert(name, "route name must be non-empty; use *NAME for a blank route to be excluded in public URLs")
    //         let blank = (name[0] === '*')
    //
    //         // blank route? only consume the `step` and truncate the request path if explicit_blank=true;
    //         // step into the nested Container only if it potentially contains the `step`
    //         if (blank) {
    //             if (!node.is_loaded()) await node.load()
    //             assert(node._is_container, "blank route can only point to a Container (Directory, Namespace)")
    //             if (explicit_blank) return rest ? node.resolve(rest, explicit_blank) : node
    //
    //             let target = node.resolve(path, explicit_blank)
    //             if (T.isPromise(target)) target = await target
    //             if (target) return target           // target=null means the object was not found and the next route should be tried
    //         }
    //         else if (name === step) {
    //             if (!node.is_loaded()) await node.load()
    //             // print('import.meta.url:', import.meta.url)
    //             // print(`resolve():  ${name}  (rest: ${rest})  (${node instanceof Container})`)
    //             if (node._is_container && rest) return node.resolve(rest, explicit_blank)
    //             else if (rest) return null
    //             else return node
    //         }
    //     }
    //     return null
    // }

    identify(item) {
        item.assert_linked()
        return this._entries_rev.get(item.__id)
    }
}

export class RootDirectory extends Directory {
    /* Site's root directory must implement special behavior for URL resolution and __url/__path imputation. */
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
        obj.assert_linked()
        return this._is_allowed(obj) ? `${obj.__id}` : null
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

    identify(item) {
        let sep = Category_IID_Namespace.ID_SEPARATOR
        let spaces_rev = this.spaces_rev
        let space = spaces_rev.get(item.__category?.__id)
        if (space) return `${space}${sep}${item.__id}`
    }

    get spaces_rev() {
        /* A reverse mapping of category identifiers to space names. Cached. */
        let catalog = this.spaces
        return new Map(catalog.map(({key, value:item}) => [item.__id, key]))
    }
}

