import {assert} from "../utils.js"
import {Item} from "../item.js"


/**********************************************************************************************************************/

export class Application extends Item {
    /*
        Application is a (possibly unbounded) collection of items available over the web that together serve the user's
        particular need. Each item has a unique URL path within the application's URL space, and the application
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


export class AppBasic extends Application {
    /* System space with admin interface. All items are accessible through the 'raw' routing pattern: /IID */

    // view/action       -- what @view to use for rendering the items when a view is not specified in the URL

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

export class AppSpaces extends Application {
    /*
    Application for accessing individual objects (items) through verbose paths of the form: .../SPACE:IID,
    where SPACE is a text identifier assigned to a category in `spaces` property.
    */

    // cached_methods = 'spacesRev'

    urlPath(item) {
        let spaces_rev = this.spacesRev()
        let space = spaces_rev.get(item._category_?._id_)
        if (space) return `${space}:${item._id_}`
    }
    spacesRev() {
        let catalog = this.prop('spaces')
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

AppSpaces.setCaching('spacesRev')


