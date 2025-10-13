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

}