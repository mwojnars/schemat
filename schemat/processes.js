import {set_global} from "./common/globals.js"


/**********************************************************************************************************************/

export class SchematProcess {
    /* The main Schemat process, on a worker node or in a user browser. */

    async _create_registry(registry_class, ...args) {
        let registry = new registry_class(...args)
        set_global({registry})

        await registry.init_classpath()
        // await registry.boot()
        return this
    }
}
