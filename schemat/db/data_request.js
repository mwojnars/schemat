import {assert, T} from "../utils.js";
import {DataAccessError, ItemNotFound} from "../errors.js";


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
    args            // (optional) command arguments as args={arg1, arg2, ...}
    // response     // (optional) response from the actor after the step is completed

    constructor(actor, command, args) {
        this.actor = actor
        this.role = actor?.constructor?.role
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
    // parent              // parent request that led to the creation of this one (if any)

    // user                // user that initiated the request (if any), to check for permissions, user-specific config etc.

    trace = []             // array of ProcessingStep(s) that the request has gone through so far

    command                // the most recent not-null `command` in the trace
    args                   // the most recent non-empty array of arguments for a command, possibly from a different step than `command` (!)

    // `current_[ROLE]` properties contain the last actor of a given type in the `trace`;
    // they are updated automatically when a new step is added to the trace; these properties include:
    current_db
    current_ring
    current_data
    current_index
    current_block
    // etc... (whatever roles are defined for actors on the trace)


    constructor(actor = null, command = null, args = null) {
        if (actor || command) this.make_step(actor, command, args)
    }

    clone() {
        let dup = T.clone(this)
        dup.trace = [...this.trace]             // individual steps are NOT cloned!
        return dup
    }

    make_step(actor, command = null, args = null) {
        /* Append a new step to the request path and return this object. */
        const step = new ProcessingStep(actor, command, args)
        this.trace.push(step)

        if (step.role) this[`current_${step.role}`] = actor
        if (command) this.command = command
        if (args) this.args = args

        return this
    }

    remake_step(actor, command = null, args = null) {
        /* Like make_step(), but first the request object is cloned to allow its reuse in another (parallel) step. */
        return this.clone().make_step(actor, command, args)
    }

    forward_down()              { return this.current_db.forward_down(this) }
    forward_save()              { return this.current_db.save(this) }

    // assert_valid_id(msg)        { return this.current_ring.assert_valid_id(this.args?.id, msg || `item ID is outside of the valid range for the ring`) }

    error_access(msg)           { throw new DataAccessError(msg, {id: this.args?.id}) }
    error_item_not_found(msg)   { throw new ItemNotFound(msg, {id: this.args?.id}) }
}

