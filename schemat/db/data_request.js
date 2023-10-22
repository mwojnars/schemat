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

export class ProcessingStep {
    actor           // object that processed the request: a database, ring, sequence, block, ...
    role            // type of the actor: 'app', 'db', 'ring', 'data', 'index', 'block', ... or undefined

    command         // (optional) command name, e.g.: 'select', 'update', 'delete', 'insert', ...
    args            // (optional) command arguments, e.g. [id, data] for 'save' command
    // response     // (optional) response from the actor after the step is completed

    constructor(actor, command, args) {
        this.actor = actor
        this.role = actor.constructor.role
        this.command = command
        this.args = args
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

    // uuid                // unique identifier of the request, global across the cluster; for logging and debugging
    // ident               // identifier of the request, local to the origin node; for matching incoming responses with requests
    // debug               // true if detailed debugging information should be logged for this request

    path = []              // array of ProcessingStep(s) that the request has gone through so far

    command                 // the most recent not-null `command` on the path
    args                    // array of arguments that accompany the `command` in its corresponding step

    // `current_[ROLE]` properties contain the last actor on the `path` of a given type;
    // they are updated automatically when a new step is added to the path; these properties include:
    current_db
    current_ring
    current_data
    current_index
    current_block
    // etc... (whatever roles are defined for actors on the path)


    constructor(actor = null, command = null, ...args) {
        if (actor) this.make_step(actor, command, ...args)
    }

    clone() {
        let dup = T.clone(this)
        dup.path = [...this.path]           // individual steps are NOT cloned!
        return dup
    }

    make_step(actor, command = null, ...args) {
        /* Append a new step to the request path and return this object. */
        const step = new ProcessingStep(actor, command, args)
        this.path.push(step)

        if (step.role) this[`current_${step.role}`] = actor
        if (command) {
            this.command = command
            this.args = args
        }
        return this
    }

    encode_id(id) {
        /* Use the ring's data schema to encode item ID as a binary key. */
        if (id === undefined) return undefined
        return this.current_ring.data.schema.encode_key([id])
    }

    forward_select()                { return this.current_db.forward_select(this) }
    forward_update()                { return this.current_db.forward_update(this) }
    forward_save(id, data)              { return this.current_db.forward_save(this.current_ring, id, data) }
    forward_delete()                { return this.current_db.forward_delete(this) }
}

