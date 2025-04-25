import {assert} from "../common/utils.js";
import {WebObject} from "../core/object.js";


// Cluster extends System
// Application extends System

export class Cluster extends WebObject {

    async __init__()  {
        if (SERVER) {
            await this.database?.load()
            await Promise.all(this.nodes.map(node => node.load()))
        }
    }

    get agent_placements() {
        /* Map of agent_id --> array of nodes where this agent is deployed.
           TODO: keys are strings of the form `agent_role`.
         */
        let placements = {}

        for (let node of this.nodes)
            for (let agent of node.agents_installed)
                (placements[agent.id] ??= []).push(node)

        for (let node of this.nodes) {
            assert(placements[node.id] === undefined)
            placements[node.id] = [node]        // node as an agent is deployed on itself and nowhere else
        }

        return placements
    }

    find_node(agent, role) {  // host_node() locate_node()
        /* Return the node where the `agent` running in a given `role` can be found. If `agent` is deployed
           on multiple nodes, one of them is chosen at random, or by hashing (TODO), or according to a routing policy...
           If `agent` is deployed here, on the current node, this location is always returned.
         */
        if (typeof agent === 'number') agent = schemat.get_object(agent)
        let nodes = this.agent_placements[agent.id]
        if (!nodes?.length) throw new Error(`agent ${agent} not deployed on any node`)
        if (nodes.some(node => node.id === this.id)) return this
        return nodes[0]
        // return nodes.random()
    }

    find_nodes(agent, role) {
        /* Array of all nodes where `agent` is currently deployed. */
    }
}
