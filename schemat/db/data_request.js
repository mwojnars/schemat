import {assert, T} from "../utils.js";


/**********************************************************************************************************************/

export class Actor {
    /* A "virtual" base interface for all classes that can process a data request.
       Specifies what properties and methods a request processor should have.
       This class is defined here for documenting purposes; it is not actually used anywhere in the codebase,
       only because JavaScript doesn't have interfaces nor multiple inheritance.
     */

    static role
}

export class RequestStep {
    actor               // object that processed the request at this step: a database, ring, sequence, block, ...
    role                // type of actor: 'app', 'db', 'ring', 'data', 'index', 'block', ... or undefined

    constructor(actor) {
        this.actor = actor
        this.role = actor.role || actor.constructor.role
    }
}

export class DataRequest {
    /* Internal network request for data access/modification. Sent from an edge node, through the database,
       ring, sequence, and down to a specific data/index block.
       The request object tracks the origin and the processing path of the request, so that the target block
       can send the response back or notify about a failure. The request object is created on the edge node and
       is passed down the chain of objects, with more information added at each step.
       The request object can be serialized to binary and sent over TCP or Kafka to another node in the cluster.
     */

    origin              // node that originated the request and will receive the response
    ident               // identifier of the request, local to the origin node; for matching incoming responses with requests

    database            // database that received the request
    ring                // database ring that received the request
    sequence            // data or index sequence that received the request - owner of the target block
    block               // target block that will process the request and send the response; for logging and debugging

    response            // ??

    path                // array of RequestStep(s) that the request has gone through so far


    constructor({origin, ident, database, ring, sequence, block} = {}) {
        this.origin = origin
        this.ident = ident
        this.database = database || ring.db
        this.ring = ring
        this.sequence = sequence
        this.block = block
    }

    clone()     { return T.clone(this) }

    next(...actors) {
        /* Append `steps` to the request path and return this object. */
        this.path = this.path || []
        for (const actor of actors)
            this.path.push(new RequestStep(actor))
        return this
    }

    append_path(path = {}) {
        // copy all properties from `path` to this request object
        for (const [key, value] of Object.entries(path)) {
            assert(!this[key])
            this[key] = value
        }
        return this
    }

    encode_id(id) {
        /* Use the ring's data schema to encode item ID to a binary key. */
        if (id === undefined) return undefined
        return this.ring.data.schema.encode_key([id])
    }

    forward_select(id)                  { return this.database.forward_select(this.ring, id) }
    forward_update(id, ...edits)        { return this.database.forward_update(this.ring, id, ...edits) }
    forward_save(id, data)              { return this.database.forward_save(this.ring, id, data) }
    forward_delete(id)                  { return this.database.forward_delete(this.ring, id) }
}

