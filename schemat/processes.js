import {set_global} from "./common/globals.js"


/**********************************************************************************************************************/

export class SchematProcess {
    /* The main Schemat process, on a worker node or in a user browser. */

    cluster         // the cluster this process belongs to; only defined in backend processes
    client_db       // the client DB of the cluster; only defined in client-side processes (in a browser)

    get db() {
        return this.cluster?.db || this.client_db
    }

    constructor() {
        set_global({schemat: this})
    }

    async _create_registry(registry_class, ...args) {
        let registry = new registry_class(...args)
        set_global({registry})

        await registry.init_classpath()
        // await registry.boot()
        return this
    }

    // equivalent(obj1, obj2) {
    //     /* True if `obj1` and `obj2` are equivalent in terms of ID; they still can be two different instances
    //        AND may contain different data (!), for example, if one them contains more recent updates than the other.
    //        Each of the arguments can be null or undefined - such values, or missing ID, are considered NOT equivalent.
    //      */
    //     return obj1?._id_ !== undefined && obj1?._id_ === obj2?._id_
    // }
}
