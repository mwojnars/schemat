/*
    Container classes (Directory, Namespace) for building URL paths and routing requests to items.
 */

import {assert} from "../common/utils.js"
import {Item} from "../item.js"
import {UrlPathNotFound} from "../common/errors.js";


/**********************************************************************************************************************/

export class Container extends Item {

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
        /* Return a unique non-empty string identifier of `item` within this container. */
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

    build_url(item) {
        /* Create an absolute URL path from the site's root to `item`. Return [url, duplicate], where:
           - `url` is the URL path from the site's root to `item`;
           - duplicate=true if the `url` is a duplicate of an ancestor's URL path, due to a terminal blank segment.
           The `item` should be a member of this container.
         */
        return this._path_to_url(this.build_path(item))
    }

    _path_to_url(path) {
        /* Convert a container access path to a URL path by removing all blank segments (/*xxx).
           NOTE 1: if the last segment is blank, the result URL can be a duplicate of the URL of a parent or ancestor container (!);
           NOTE 2: even if the last segment is not blank, the result URL can still be a duplicate of the URL of a sibling object,
                   if they both share an ancestor container with a blank segment. This cannot be automatically detected
                   and should be prevented by proper configuration of top-level containers.
         */
        let last = path.split('/').pop()
        let last_blank = last.startsWith('*')               // if the last segment is blank, the URL is a duplicate of a parent's URL
        let url = path.replace(/\/\*[^/]*/g, '')
        return [url, last_blank]
    }
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

    findRoute(request) {
        let step = request.step()
        if (!step) return [this, request, true]         // mark this folder as the target node of the route (true)
        let item = this.entries.get(step)
        // request.pushMethod('@file')                     // if `item` doesn't provide @file method, its default one will be used
        return [item, request.move(step), item => !(item instanceof Container)]
    }

    contains(name) { return this.entries.has(name) }
}


export class Namespace extends Container {
    /*
        Unbounded collection of objects available over the web that together serve the user's
        particular need. Each eligible item has a unique URL path within the application's URL space, and the application
        allows to retrieve this path for an arbitrary item (urlPath()) and, vice versa, map a URL path to
        a corresponding target item (findRoute()). All paths are relative to the application's base route.

        Within the application, some paths may be fixed and link to a limited number of predefined system items;
        while other paths may be dynamically generated and link to an arbitrary number of user-created items,
        giving the user an ability to create new items. Applications can also be nested.
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

    // address(item) {
    //     /* If `item` belongs to the item space defined by this application, return its URL subpath
    //        (no leading '/') to be appended to a route when building a URL. Otherwise, return undefined.
    //      */
    // }

    // urlPath(item) {
    //     /* Generate a URL name/path (fragment after the base route string) of `item`.
    //        The path does NOT have a leading separator, or it has a different (internal) meaning -
    //        in any case, a leading separator should be inserted by caller if needed.
    //      */
    //     let func = this.urlPath = this.parseMethod('urlPath', 'item')
    //     return func.call(this, item)
    // }
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
        /* Return a unique string identifier of `item` within this container. */
        item.assert_linked()
        return `${item._id_}`
    }


    urlPath(item) {
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

    urlPath(item) {
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


