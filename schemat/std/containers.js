/*
    Container classes (Directory, Namespace) for building URL paths and routing requests to items.
 */

import {assert, print} from "../common/utils.js"
import {Item} from "../core/item.js"


/**********************************************************************************************************************/

export class Container extends Item {
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

    resolve(path, explicit_blank = false) {
        /* Find the web object pointed to by `path` and located inside this container or a nested one.
           Return the object in loaded state, or null if not found. Alternatively, a function, f(request),
           can be returned to perform the remaining part of the request handling process.
           This method may return a Promise if an async operation has to be performed during the computation.

           The path is relative to this container's base path and should NOT contain a leading slash.
           If `explicit_blank` is true, the path is an internal "container path" that includes explicit blank segment(s)
           (a/*BLANK/b/c); otherwise, the path is a "URL path" with blank segments hidden (a/b/c).
           Currently, a blank segment is only allowed at the top level of a URL path, inside a Site directory.
         */
        return null
    }

    identify(item) {
        /* Return a unique non-empty string identifier of `item` within this container. An identifier of the form *xxx
           (ident[0] == '*') denotes a blank segment that should be removed when converting container access path to a URL path.
         */
        throw new Error('not implemented')
    }

    get_access_path(member) {
        /* Return an access path to `member` that starts at the root (site object).
           The access path is like a URL path, but with explicit blank segments: /*BLANK
         */
        assert(this.__path, `container's __path is not initialized (${this.name} ${this.__id})`)
        assert(this.__path[0] === '/', `container's __path must start with '/'`)

        let ident = this.identify(member)
        if (!ident) {
            // here, null is returned instead of throwing an error because the mismatch between member's and container's settings may happen temporarily while moving an object from one container to another
            print(`WARNING: container [${this.__id}] does NOT include object [${member.__id}]`)
            return null
        }

        // the last char in __path can be '/' for a site (__path='/'); don't include extra '/' in such case
        if (this.__path.endsWith('/')) return this.__path + ident

        return this.__path + '/' + ident
    }

    // build_url(item) {
    //     /* Create an absolute URL path from the site's root to `item`. Return [url, duplicate], where:
    //        - `url` is the URL path from the site's root to `item`;
    //        - duplicate=true if the `url` is a duplicate of an ancestor's URL path, due to a terminal blank segment.
    //        The `item` should be a member of this container.
    //      */
    //     return this.decode_access_path(this.get_access_path(item))
    // }
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

    resolve(path) {
        assert(path, `path must be non-empty`)
        let step = path.split('/')[0]
        let next = this.entries?.get(step)
        if (!next) return null

        let rest = path.slice(step.length + 1)
        let tail = () => {
            // here, `next` is already loaded
            if (!rest) return next
            if (!next._is_container) return null
            return next.resolve(rest)
        }
        return next.is_loaded() ? tail() : next.load().then(tail)
    }

    identify(item) {
        item.assert_linked()
        return this._entries_rev.get(item.__id)
    }
}


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
       The set of objects can optionally be restricted to a particular category.
     */

    resolve(path) {
        assert(path, `path must be non-empty`)
        try {
            let id = Number(path)
            assert(!isNaN(id))
            return schemat.get_loaded(id)
        }
        catch (ex) { return null }
    }

    identify(item) {
        item.assert_linked()
        return `${item.__id}`
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

