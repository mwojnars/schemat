/**********************************************************************************************************************
 **
 **  PROCESSES
 **
 */

export class SchematProcess {
    /* A Schemat process running on a node or in a user browser. */

    cluster         // the cluster this process belongs to; only defined in backend processes
    client_db       // the client DB of the cluster; only defined in client-side processes (in a browser)

    get db() {
        return this.cluster?.prop('db') || this.client_db
    }

    constructor() {
        globalThis.schemat = this
    }
}

export class ClientProcess extends SchematProcess {

    constructor(client_db) {
        super()
        this.client_db = client_db
    }
}

