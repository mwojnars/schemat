/*
    Container classes (Directory, Namespace) for building URL paths and routing requests to items.
 */

import {assert} from "../common/utils.js"
import {Item} from "../item.js"
import {UrlPathNotFound} from "../common/errors.js";


/**********************************************************************************************************************/

export class Container extends Item {
    /* A collection of objects that are all published under the same URL path prefix.
       Container can assign unique URL path segment (identifier) to each member object, and can map a relative URL path
       back to an object (resolve()). May contain nested containers.
       Can assign "container access paths" which are like URL paths but with explicit blank segments (/*xxx);
       these paths are used internally to identify objects within a container, before a final URL is generated.
     */

    // async _init_url() {
    //     if (!this.container_path) throw new Error(`container_path is obligatory for a container`)
    //     await super._init_url()
    // }

    contains(name) { return true }

    resolve(path, explicit_blank = false) {
        /* Find an object pointed to by `path` in this or a nested container. Return the object in a loaded state.
           A Promise can be returned (!) if an async operation has to be performed during the computation;
           or the final result otherwise - check if the result is a Promise to avoid unnecessary awaiting.

           The path is relative to this container's base path and should NOT contain a leading slash.
           If `explicit_blank` is true, the path is an internal "container path" that includes explicit blank segment(s)
           (a/*BLANK/b/c); otherwise, the path is a "URL path" with blank segments hidden (a/b/c).
           Currently, a blank segment is only allowed at the top level of a URL path, inside a Site directory.
         */
        throw new Error('not implemented')
    }

    identify(item) {
        /* Return a unique non-empty string identifier of `item` within this container. An identifier of the form *xxx
           (ident[0] == '*') denotes a blank segment that should be removed when converting container access path to a URL path.
         */
        throw new Error('not implemented')
    }

    build_path(member) {
        /* Return an access path to `member` including the path from root to this container.
           The access path is like a URL path, but with explicit blank segments: /*BLANK
         */
        assert(this._path_[0] === '/', `_path_ must start with '/'`)
        let ident = this.identify(member)
        assert(ident, `object is not a member of this container`)
        return this._path_ + '/' + ident
    }

    // build_url(item) {
    //     /* Create an absolute URL path from the site's root to `item`. Return [url, duplicate], where:
    //        - `url` is the URL path from the site's root to `item`;
    //        - duplicate=true if the `url` is a duplicate of an ancestor's URL path, due to a terminal blank segment.
    //        The `item` should be a member of this container.
    //      */
    //     return this.path_to_url(this.build_path(item))
    // }
}


export class Directory extends Container {

    resolve(path) {
        assert(path, `path must be non-empty`)
        let step = path.split('/')[0]
        let next = this.entries.get(step)
        if (!next) throw new UrlPathNotFound({path})
        let rest = path.slice(step.length + 1)

        let tail = () => {
            // here, `next` is already loaded
            if (!rest) return next
            if (!(next instanceof Container)) throw new UrlPathNotFound({path})
            return next.resolve(rest)
        }
        return next.is_loaded() ? tail() : next.load().then(tail)
    }

    identify(item) {
        item.assert_linked()
        let id = item._id_
        for (let [name, ref] of this.entries)
            if (ref._id_ === id) return name
    }

    contains(name) { return this.entries.has(name) }

    findRoute(request) {
        let step = request.step()
        if (!step) return [this, request, true]         // mark this folder as the target node of the route (true)
        let item = this.entries.get(step)
        // request.pushMethod('@file')                     // if `item` doesn't provide @file method, its default one will be used
        return [item, request.move(step), item => !(item instanceof Container)]
    }
}


export class Namespace extends Container {
    /*
        Unbounded collection of objects: each object that satisfies the criteria of the namespace can be assigned
        (dynamically) a unique identifier, typically based on the object's ID.
     */

    /*
    Application implements a bidirectional mapping of URL names to items and back.
    Typically, an application is placed as the leaf segment of a routing pattern,
    to provide naming & routing for an open set of dynamically created items ("item space")
    which do not have their own proper names. Usually, the application also provides methods
    (endpoints) for creating new items. Applications make sure the URL names are unique.

    Not every route must contain an application, rather it may be composed of statically-named segments alone.
    Also, there can be multiple applications on a particular route, for example, the route:

       /post/XXX/comment/YYY

    contains two applications: "posts" and "comments". Some applications may generate multi-segment names.

    INFO what characters are allowed in URLs: https://stackoverflow.com/a/36667242/1202674
    */

    // findRoute(request)  {
    //     // findRoute() is parsed dynamically from source on the 1st call and stored in `this` -
    //     // not in a class prototype like `code` (!); after that, all calls go directly to the new function
    //     let func = this.findRoute = this.parseMethod('findRoute', 'request')
    //     return func.call(this, request)
    // }
}


export class ID_Namespace extends Namespace {
    /* All objects accessible through the raw numeric ID url path of the form: /ID */

    // view/action       -- what @view to use for rendering the items when a view is not specified in the URL

    resolve(path) {
        request.app = this      // todo: remove
        assert(path, `path must be non-empty`)
        try {
            let id = Number(path)
            assert(!isNaN(id))
            return registry.getLoaded(id)
        }
        catch (ex) { throw new UrlPathNotFound({path}) }
    }

    identify(item) {
        item.assert_linked()
        return `${item._id_}`
    }

    findRoute(request) {
        /* Extract item ID from a raw URL path. */
        let step = request.step(), id
        try {
            id = Number(step)
            assert(!isNaN(id))
        }
        catch (ex) { request.throwNotFound() }
        // request.pushMethod('@full')
        return [this.registry.getItem(id), request.move(step), true]
    }
}

export class CategoryID_Namespace extends Namespace {
    /*
    A collection of objects accessible through human-readable paths of the form: CATEGORY:ID,
    where CATEGORY is a category-specific text qualifier defined in `spaces` property.
    */

    static ID_SEPARATOR = ':'

    spaces

    resolve(path) {
        request.app = this      // todo: remove
        assert(path, `path must be non-empty`)
        let sep = CategoryID_Namespace.ID_SEPARATOR
        let [space, id, ...rest] = path.split(sep)
        let category = this.spaces.get(space)               // decode space identifier and convert to a category object
        if (!category || rest.length) throw new UrlPathNotFound({path})
        return registry.getLoaded(Number(id))
    }

    identify(item) {
        let sep = CategoryID_Namespace.ID_SEPARATOR
        let spaces_rev = this.spacesRev()
        let space = spaces_rev.get(item._category_?._id_)
        if (space) return `${space}${sep}${item._id_}`
    }

    spacesRev() {
        let catalog = this.spaces
        return new Map(catalog.map(({key, value:item}) => [item._id_, key]))
    }

    findRoute(request) {
        let step = request.step()
        let sep = CategoryID_Namespace.ID_SEPARATOR
        let [space, id] = step.split(sep)
        let category = this.spaces.get(space)               // decode space identifier and convert to a category object
        if (!category) request.throwNotFound()
        let item = this.registry.getItem(Number(id))
        return [item, request.pushApp(this).move(step), true]
    }
}

CategoryID_Namespace.setCaching('spacesRev')


