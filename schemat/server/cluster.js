import {WebObject} from "../core/object.js";


// Cluster extends System
// Site extends System

export class Cluster extends WebObject {

    async __init__()  {
        if (SERVER) await this.database?.load()
    }

    locate_node(agent, role) {
        /* Return the node where the `agent` running in a given `role` can be found. If `agent` is deployed
           on multiple nodes, one of them is chosen at random, or by hashing (TODO), or in some other way...
           If `agent` is deployed here, on the current node, this location is always returned.
         */
        return agent.__node
    }

    locate_nodes(agent, role) {
        /* Return an array of all locations of `agent`. */
    }
}
