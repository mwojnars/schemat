import {WebObject} from "../core/object.js";


// Cluster extends System
// Site extends System

export class Cluster extends WebObject {

    async __init__()  {
        if (SERVER) {
            await this.database?.load()
            await Promise.all(this.nodes.map(node => node.load()))
        }
    }

    find_node(agent, role) {  // host_node() locate_node()
        /* Return the node where the `agent` running in a given `role` can be found. If `agent` is deployed
           on multiple nodes, one of them is chosen at random, or by hashing (TODO), or according to a routing policy...
           If `agent` is deployed here, on the current node, this location is always returned.
         */
        return agent.__node
    }

    find_nodes(agent, role) {
        /* Array of all nodes where `agent` is currently deployed. */
    }
}
