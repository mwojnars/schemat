import {assert, print, copy} from "../common/utils.js";
// import {DataAccessError, ObjectNotFound} from "../common/errors.js";


/**********************************************************************************************************************/

// export class ProcessingStep {
//     actor           // object that processed the request: a database, ring, sequence, block, ...
//     command         // (optional) command name, e.g.: 'select', 'update', 'delete', 'insert', ...
//     args            // (optional) command arguments as args={arg1, arg2, ...}
//     // response     // (optional) response from the actor after the step is completed
//
//     constructor(actor, command, args) {
//         this.actor = actor
//         this.command = command
//         this.args = args
//     }
// }

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
    // hops                // number of hops the request has gone through so far (for debugging and performance monitoring); after too many hops the request should be dropped to avoid infinite loops

    // trace = []          // array of ProcessingStep(s) that the request has gone through so far
    rings = []             // higher Rings that have been encountered during "read" part of the request when forwarding it down from the top ring;
                           // ordered from top to bottom, *excluding* the current (bottom-most) ring

    command                // the most recent not-null `command` in the trace
    args                   // the most recent non-empty array of arguments for a command, possibly from a different step than `command` (!)

    // `current_[ROLE]` properties contain the last actor of a given type in the `trace`;
    // they are updated automatically when a new step is added to the trace; these properties include:

    // current_db
    // current_ring


    constructor(actor = null, command = null, args = null) {
        if (actor || command) this.make_step(actor, command, args)
    }

    clone() {
        let dup = copy(this)
        // dup.trace = [...this.trace]             // individual steps are NOT cloned!
        dup.rings = [...this.rings]
        return dup
    }

    push_ring(ring) {
        this.rings.push(ring)
        // print('request-forward rings:', this.rings.map(r => r.name))
    }
    pop_ring(ring) {
        return this.rings.pop()
    }

    make_step(actor, command = null, args = null) {
        /* Append a new step to the request path and return this object. */
        // const step = new ProcessingStep(actor, command, args)
        // this.trace.push(step)

        if (command) this.command = command
        if (args) {
            this.args = args
            for (let key in args) this[key] = args[key]
        }

        return this
    }

    safe_step(actor, command = null, args = null) {
        /* Like make_step(), but the request object is cloned before adding a step to allow its reuse in another (parallel) step. */
        return this.clone().make_step(actor, command, args)
    }

    // assert_valid_id(msg)        { return this.current_ring.assert_valid_id(this.args?.id, msg || `object ID is outside of the valid range for the ring`) }
}

