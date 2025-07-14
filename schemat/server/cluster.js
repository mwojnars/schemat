import {assert, print} from "../common/utils.js";
import {Agent} from "./agent.js";


function _agent_role(id, role = null) {
    /* Utility function for building a specification string that identifies an agent (by ID) together with its particular role. */
    role ??= schemat.GENERIC_ROLE
    assert(role[0] === '$', `incorrect name of agent role (${role})`)
    return `${id}_${role}`        // 1234_$agent
}

/**********************************************************************************************************************/

// Cluster extends System
// Application extends System

export class Cluster extends Agent {

    nodes       // array of Node objects representing physical nodes of this cluster

    async __load__() {
        if (SERVER) await Promise.all(this.nodes.map(node => node.load()))
    }

    async __start__({role} = {}) {
        // assert(role === '$leader')
        // let nodes = [...this.nodes]
        // return {nodes}
        let node_ids = this.nodes.map(n => n.id)
        return {node_ids}
    }

    get agent_placements() {
        /* Map of agent_role --> array of nodes where this agent is deployed, where `agent_role` is a string
           of the form `${id}_${role}`, like "1234_$agent".
         */
        let placements = {}

        for (let node of this.nodes)
            for (let {id, role} of node.agents) {
                assert(id)
                let agent_role = _agent_role(id, role);
                (placements[agent_role] ??= []).push(node)
            }

        for (let node of this.nodes) {
            let agent_role = _agent_role(node.id, '$master')    // there are $worker deployments, too, but they shouldn't be needed
            assert(placements[agent_role] === undefined)
            placements[agent_role] = [node]                     // node as an agent is deployed on itself and nowhere else
        }
        return placements
    }

    find_node(agent, role) {  // host_node() locate_node()
        /* Return the node where the `agent` running in a given `role` can be found. If `agent` is deployed
           on multiple nodes, one of them is chosen at random, or by hashing (TODO), or according to a routing policy...
           If `agent` is deployed here on the current node, this location is always returned.
         */
        agent = schemat.as_object(agent)
        let agent_role = _agent_role(agent.id, role)
        let nodes = this.agent_placements[agent_role]

        if (!nodes?.length) throw new Error(`agent ${agent} not deployed on any node`)
        if (nodes.some(node => node.id === this.id)) return this
        return nodes[0]
        // return nodes.random()
    }

    find_nodes(agent, role) {
        /* Array of all nodes where `agent` is currently deployed. */
    }

    /***  Agent operations  ***/

    async '$leader.deploy'(agent) {
        /* Find the least loaded node and deploy `agent` there. */

    }

    async '$leader.create_node'(props = {}) {
        /* Create a new Node object and add it to this cluster.
           The newly created node is *first* saved to the DB and only later added to the local state; if we tried to change
           this order, the state would contain a newborn object (no ID) for a while breaking the state's consistency!

           GENERAL RULES:
           1) When doing mixed DB + $state modifications, first update the DB, and the state only later. In this way,
              if the DB update fails, $state is NOT left with incompatible content. This is important for other agents
              in the cluster which may condition their actions on this agent's state, but can only observe it through the DB.

           2) The $state should only be modified outside a transaction, otherwise the DB changes could be rolled back
              at the end by the caller, leaving $state incompatible with DB.
        */
        assert(!schemat.tx, `$state should only be modified outside a transaction`)

        // this._print_stack()
        this._print(`$leader.create_node() context: ${schemat.db}, ${schemat.app}, ${schemat.tx}`)

        let args = typeof props === 'string' ? [{}, props] : [props]
        let node = await schemat.std.Node.action.insert(...args)
        node = await node.reload()

        this._print(`$leader.create_node() node: is_loaded=${node.is_loaded()}`, node.__content)

        let nodes = [...this.$state.node_ids, node.id].map(id => schemat.get_object(id))
        await this.action.update({nodes})

        this.$state.node_ids = nodes.map(n => n.id)
    }
}
