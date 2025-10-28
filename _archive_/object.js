class WebObject {

    async _init_url() {
        while (!schemat.app) {                                      // wait until the app is created; important for bootstrap objects
            await sleep()
            if (schemat.terminating) return                         // app is closing? no need to wait any longer
        }

        let container = this.__container
        if (!container) return this.__url                           // root Directory has no parent container; also, no-category objects have no *default* __container and no imputation of __path & __url

        if (!container.is_loaded()) await container.load()          // container must be fully loaded
        if (!container.__path) await container.__meta.pending_url   // container's path must be initialized

        delete this.__meta.pending_url
        return this.__url                                           // invokes calculation of __path and __url via impute functions
    }

    static _decode_access_path(path) {
        /* Convert a container access path to a URL path by removing all blank segments (/*xxx).
           NOTE 1: if the last segment is blank, the result URL can be a duplicate of the URL of a parent or ancestor container (!);
           NOTE 2: even if the last segment is not blank, the result URL can still be a duplicate of the URL of a sibling object,
                   if they both share an ancestor container with a blank segment. This case cannot be automatically detected
                   and should be prevented by proper configuration of top-level containers.
         */
        let last = path.split('/').pop()
        let last_blank = last.startsWith('*')           // if the last segment is blank, the URL may be a duplicate of an ancestor's URL
        let url = path.replace(/\/\*[^/]*/g, '')
        return [url, last_blank]
    }


    static _collect_methods(protocols = ['LOCAL', 'GET', 'POST'], SEP = '.') {
        /* Collect all special methods of this class: web handlers + actions + edit operators. */
        let is_endpoint = prop => protocols.some(p => prop.startsWith(p + SEP))
        let proto = this.prototype
        let props = T.getAllPropertyNames(proto)

        let handlers = props.filter(is_endpoint).filter(name => proto[name]).map(name => [name, proto[name]])
        this.__handlers = new Map(handlers)
    }


    /***  Dynamic loading of source code  ***/

    parseClass(base = WebObject) {
        /* Concatenate all the relevant `code_*` and `code` snippets of this item into a class body string,
           and dynamically parse them into a new class object - a subclass of `base` or the base class identified
           by the `class` property. Return the base if no code snippets found. Inherited snippets are included in parsing.
         */
        let name = this.get('_boot_class')
        if (name) base = schemat.get_builtin(name)

        let body = this.route_local(('class')           // full class body from concatenated `code` and `code_*` snippets
        if (!body) return base

        let url = this.sourceURL('class')
        let import_ = (path) => {
            if (path[0] === '.') throw Error(`relative import not allowed in dynamic code of a category (${url}), path='${path}'`)
            return schemat.app.import(path)
        }
        let source = `return class extends base {${body}}` + `\n//# sourceURL=${url}`
        return new Function('base', 'import_', source) (base, import_)
    }
        let asyn = body.match(/\bawait\b/)              // if `body` contains "await" word, even if it's in a comment (!),
        let func = asyn ? AsyncFunction : Function      // an async function is created instead of a synchronous one

    parseMethod(path, ...args) {
        let source = this.get(path)
        let url = this.sourceURL(path)
        return source ? new Function(...args, source + `\n//# sourceURL=${url}`) : undefined
    }

    sourceURL(path) {
        /* Build a sourceURL string for the code parsed dynamically from a data element, `path`, of this item. */
        function clean(s) {
            if (typeof s !== 'string') return ''
            return s.replace(/\W/, '')                  // keep ascii-alphanum characters only, drop all others
        }
        let domain   = WebObject.CODE_DOMAIN
        let cat_name = clean(this.get('name'))
        let fil_name = `${cat_name}_${this.id_str}`
        return `${domain}:///items/${fil_name}/${path}`
        // return `\n//# sourceURL=${url}`
    }

}