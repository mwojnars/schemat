import {assert} from "../common/utils.js";
import {Agent} from "./agent.js";


function _agent_role(agent, role = null) {
    /* Utility function for building a specification string that identifies an agent (by ID) together with its particular role. */
    role ??= schemat.GENERIC_ROLE
    assert(role[0] === '$', `incorrect name of agent role (${role})`)
    return `${agent.id}_${role}`        // 1234_$agent
}

/**********************************************************************************************************************/

// Cluster extends System
// Application extends System

export class Cluster extends Agent {

    async __init__()  {
        if (SERVER) await Promise.all(this.nodes.map(node => node.load()))
    }

    get agent_placements() {
        /* Map of agent_role --> array of nodes where this agent is deployed, where `agent_role` is a string
           of the form `${id}_${role}`, like "1234_$agent".
         */
        let placements = {}

        for (let node of this.nodes)
            for (let {agent, role} of node.agents) {
                let agent_role = _agent_role(agent, role);
                (placements[agent_role] ??= []).push(node)
            }

        for (let node of this.nodes) {
            let agent_role = _agent_role(node, '$master')   // there are $worker deployments, too, but they shouldn't be needed
            assert(placements[agent_role] === undefined)
            placements[agent_role] = [node]                 // node as an agent is deployed on itself and nowhere else
        }
        return placements
    }

    find_node(agent, role) {  // host_node() locate_node()
        /* Return the node where the `agent` running in a given `role` can be found. If `agent` is deployed
           on multiple nodes, one of them is chosen at random, or by hashing (TODO), or according to a routing policy...
           If `agent` is deployed here, on the current node, this location is always returned.
         */
        agent = schemat.as_object(agent)
        let agent_role = _agent_role(agent, role)
        let nodes = this.agent_placements[agent_role]

        if (!nodes?.length) throw new Error(`agent ${agent} not deployed on any node`)
        if (nodes.some(node => node.id === this.id)) return this
        return nodes[0]
        // return nodes.random()
    }

    find_nodes(agent, role) {
        /* Array of all nodes where `agent` is currently deployed. */
    }

    async '$leader.create_node'(state, settings = {}) {
        /* Create a new Node object and add it to this cluster. */
    }
}
