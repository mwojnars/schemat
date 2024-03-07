/*
    Container classes (Directory, Namespace) for building URL paths and routing requests to items.
 */

import {assert} from "../common/utils.js"
import {Item} from "../item.js"
import {UrlPathNotFound} from "../common/errors.js";


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

    get_access_path(member) {
        /* Return an access path to `member` including the path from root to this container.
           The access path is like a URL path, but with explicit blank segments: /*BLANK
         */
        assert(this._path_, `container's _path_ is not initialized (${this.name} ${this._id_})`)
        assert(this._path_[0] === '/', `container's _path_ must start with '/'`)

        let ident = this.identify(member)
        assert(ident, `object is not a member of this container`)

        // the last char in _path_ can be '/' for a site (_path_='/'); don't include extra '/' in such case
        if (this._path_.endsWith('/')) return this._path_ + ident

        return this._path_ + '/' + ident
    }

    // build_url(item) {
    //     /* Create an absolute URL path from the site's root to `item`. Return [url, duplicate], where:
    //        - `url` is the URL path from the site's root to `item`;
    //        - duplicate=true if the `url` is a duplicate of an ancestor's URL path, due to a terminal blank segment.
    //        The `item` should be a member of this container.
    //      */
    //     return this.path_to_url(this.get_access_path(item))
    // }
}


export class Directory extends Container {

    get _entries_rev() {
        /* Reverse mapping of objects IDs to their names for fast lookups.
           If an object occurs multiple times in this.entries, the LAST occurrence is recorded (!)
         */
        let rev = new Map()
        for (let {key: name, value: object} of this.entries)
            rev.set(object._id_, name)
        return this.CACHED_PROP(rev)
    }

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
        return this._entries_rev.get(item._id_)
    }

    contains(name) { return this.entries.has(name) }
}


export class Namespace extends Container {
    /*
        Unbounded collection of objects: each object that satisfies the criteria of the namespace is accepted
        and can receive a (dynamically created) unique identifier, typically built from the object's ID.
        Typically, Namespace is placed as a leaf on a URL route.

        INFO what characters are allowed in URLs: https://stackoverflow.com/a/36667242/1202674
    */
}


export class ID_Namespace extends Namespace {
    /* All objects accessible through the raw numeric ID url path of the form: /ID */

    resolve(path) {
        assert(path, `path must be non-empty`)
        try {
            let id = Number(path)
            assert(!isNaN(id))
            return schemat.get_loaded(id)
        }
        catch (ex) { throw new UrlPathNotFound({path}) }
    }

    identify(item) {
        item.assert_linked()
        return `${item._id_}`
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
        assert(path, `path must be non-empty`)
        let sep = CategoryID_Namespace.ID_SEPARATOR
        let [space, id, ...rest] = path.split(sep)
        let category = this.spaces.get(space)               // decode space identifier and convert to a category object
        if (!category || rest.length) throw new UrlPathNotFound({path})
        return schemat.get_loaded(Number(id))
    }

    identify(item) {
        let sep = CategoryID_Namespace.ID_SEPARATOR
        let spaces_rev = this.spaces_rev
        let space = spaces_rev.get(item._category_?._id_)
        if (space) return `${space}${sep}${item._id_}`
    }

    get spaces_rev() {
        /* A reverse mapping of category identifiers to space names. Cached. */
        let catalog = this.spaces
        let rev = new Map(catalog.map(({key, value:item}) => [item._id_, key]))
        return this.CACHED_PROP(rev)
    }
}

