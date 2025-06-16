import {assert, print} from "../common/utils.js";
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

    async __start__({role}) {
        assert(role === '$leader')
        let nodes = this.nodes
        return {nodes}
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

    async '$leader.create_node'({nodes}, props = {}) {
        /* Create a new Node object and add it to this cluster.
           The newly created node is *first* saved to the DB and only later added to the local state; if we tried to change
           this order, the state would contain a newborn object (no ID) for some time, which breaks the state's consistency!

           GENERAL RULE:
           When adding new system objects, always save them to DB first, only later add them to the state.
           Also, use the state to update the parent's content in DB, not the other way round ([agent] reflects $agent.state, not the opposite!).

           The correct order:
           1. create child object and save to DB
           2. add child object to parent state
           3. save parent state to DB 
        */
        // this._print_stack()
        // this._print(`$leader.create_node() context: ${schemat.db}, ${schemat.app}`)

        let node = await this.action._create_node(props)
        this._print(`$leader.create_node() node:\n`, node.__content)

        nodes.push(node)
        await this.action.set({nodes})

        // await this.set({nodes}).save({ring: this.__ring})    -- .set() will not work outside action
        // await this.action({ring: this.__ring}).set({nodes})
    }

    async 'action._create_node'(props) {
        // this._print_stack()
        // this._print(`action._create_node() context: ${schemat.db}, ${schemat.app}`)
        return schemat.std.Node.new(props)

        // let node = schemat.std.Node.new(props)
        // this._print(`action._create_node():\n`, node.__content)
        // return node

        // TX+DB operations performed in the background:
        // - the new object is registered in TX and receives a provisional ID
        // - a request is sent over HTTP to an edge server
        // - the edge server sends an RCP request over TCP to a data block agent
        // - the object is written to DB where its record receives a proper ID
        // - record + ID are transferred back to edge server & client
        // - TX writes the final ID into the object, so it can be serialized by JSONx when completing the action
        // - JsonPOST + JSONx write the ID in HTTP response (serialized representation of the "result" object);
        //   "records" are appended to the response, where the DB content of the object is included
        // - client deserializes "records" and saves the object's record in the Registry, then it deserializes the object itself
        //   from its ID via JSONx, which pulls the record from Registry and recreates the object with its full content and proper ID
    }
}
