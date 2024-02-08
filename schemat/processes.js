import {set_global} from "./common/globals.js"


/**********************************************************************************************************************/

export class SchematProcess {
    /* The main Schemat process, on a worker node or in a user browser. */

    async _create_registry(registry_class, ...args) {
        let schemat = new registry_class(...args)
        set_global({schemat, registry: schemat})

        await schemat.init_classpath()
        // await schemat.boot()
        return this
    }
}
