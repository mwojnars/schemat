import {ClientRegistry} from "./registry.js";


/**********************************************************************************************************************/

export class SchematProcess {
    /* A Schemat process running on a node or in a user browser. */

    registry
    cluster         // the cluster this process belongs to; only defined in backend processes
    client_db       // the client DB of the cluster; only defined in client-side processes (in a browser)

    get db() {
        return this.cluster?.prop('db') || this.client_db
    }

    constructor() {
        globalThis.schemat = this
    }

    async init() { return this }         // creating the registry; override in subclasses

    async _create_registry(registry_class, ...args) {
        // this.registry = await registry_class.createGlobal(this, ...args)
        let registry = new registry_class(this, ...args)
        this.registry = registry
        globalThis.registry = registry
        await registry.init_classpath()
        await registry.boot()
        return this
    }
}


export class ClientProcess extends SchematProcess {

    constructor(client_db) {
        super()
        this.client_db = client_db
    }

    async init() { return this._create_registry(ClientRegistry) }
}

