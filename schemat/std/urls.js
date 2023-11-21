/*
    Container classes (Directory, Namespace) for building URL paths and routing requests to items.
 */

import {assert} from "../common/utils.js"
import {Item} from "../item.js"
import {UrlPathNotFound} from "../common/errors.js";


/**********************************************************************************************************************/

export class Container extends Item {

    contains(name) { return true }

    find_route(path) {
        /* Return an item inside this container or below, identified by a given URL path.
           The path is relative to this container's URL path, and may be empty (`this` is returned in such case).
           The path should NOT contain a leading slash.
           This function returns a Promise (!) if data loading is needed along the way, or the final result otherwise
           (check if the result is instanceof Promise to avoid unnecessary awaiting).
         */
        throw new Error('not implemented')
    }

    resolve(request) {
        /* Find an object pointed to by request.path_remaining, in this or a nested container.
           Return the object. The `request` may be modified in the process.
         */
        throw new Error('not implemented')
    }

    identify(item) {
        /* Return a unique string identifier of `item` within this container. */
        throw new Error('not implemented')
    }
    address(item) {
        /* Return an absolute URL path to `item` including the path from root to this container. */
        throw new Error('not implemented')
    }
}


export class Directory extends Container {

    find_route(path) {
        // if (!path) return this
        assert(path, `path must be non-empty`)
        let step = path.split('/')[0]
        let next = this.entries.get(step)
        if (!next) throw new UrlPathNotFound({path})
        let subpath = path.slice(step.length + 1)

        let tail = () => {
            // here, `next` is already loaded
            if (!subpath) return next
            if (!(next instanceof Container)) throw new UrlPathNotFound({path})
            return next.find_route(subpath)
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

    identify(item) {
        /* Return a unique string identifier of `item` within this container. */
        item.assert_linked()
        return `${item._id_}`
    }
    address(item) {
        /* Return an absolute URL path to `item` including the path from root to this container. */
        return this.internal_url + '/' + this.identify(item)        // internal_url may contain an explicit blank segment: /*BLANK
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

    spaces

    urlPath(item) {
        let spaces_rev = this.spacesRev()
        let space = spaces_rev.get(item._category_?._id_)
        if (space) return `${space}:${item._id_}`
    }
    spacesRev() {
        let catalog = this.spaces
        return new Map(catalog.map(({key, value:item}) => [item._id_, key]))
    }

    findRoute(request) {
        let step = request.step()
        let [space, id] = step.split(':')
        let category = this.spaces.get(space)               // decode space identifier and convert to a category object
        if (!category) request.throwNotFound()
        let item = this.registry.getItem(Number(id))
        return [item, request.pushApp(this).move(step), true]
    }
}

CategoryID_Namespace.setCaching('spacesRev')


