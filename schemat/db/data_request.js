
/**********************************************************************************************************************/

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


    constructor({origin, ident, database, ring, sequence, block} = {}) {
        this.origin = origin
        this.ident = ident
        this.database = database || ring.db
        this.ring = ring
        this.sequence = sequence
        this.block = block
    }

    forward_select(id)      { return this.database.forward_select(this.ring, id) }
}

