import {assert, print, min} from "../common/utils.js";
import {Agent} from "./agent.js";
import {ObjectsMap} from "../common/structs.js";


function _agent_role(id, role = null) {
    /* Utility function for building a specification string that identifies an agent (by ID) together with its particular role. */
    role ??= schemat.GENERIC_ROLE
    assert(role[0] === '$', `incorrect name of agent role (${role})`)
    return `${id}_${role}`        // 1234_$agent
}


export class NodeState {
    /* Statistics of how a particular node in the cluster is doing: health, load, heartbeat etc. */

    // general:
    id              // node.id
    status          // running / stopped / crashed
    heartbeat       // most recent heartbeat info with a timestamp

    // load:
    num_workers     // no. of worker processes
    num_agents      // total no. of individual agent-role deployments across the node excluding node.$master/$worker itself

    // average no. of individual agent-role deployments per worker process
    get avg_agents() { return this.num_agents / (this.num_workers || 1) }

    // resource utilization (mem, disk, cpu), possibly grouped by agent category ...

    constructor(node) {
        /* Initial stats pulled from node's info in DB. */
        this.id = node.id
        this.num_workers = node.num_workers
        this.num_agents = node.agents.length
    }
}

/**********************************************************************************************************************/

// Cluster extends System
// Application extends System

export class Cluster extends Agent {

    // nodes            array of Node objects representing physical nodes of this cluster
    // $state.nodes     map of NodeState objects keeping the most recent stats on the node's health and activity

    async __load__() {
        if (SERVER) await Promise.all(this.nodes.map(node => node.load()))
    }

    async __start__({role}) {
        assert(role === '$leader')
        let nodes = new ObjectsMap(this.nodes.map(n => [n, new NodeState(n)]))
        return {nodes}
    }

    get agent_placements() {
        /* Map of agent_role --> array of nodes where this agent is deployed, where `agent_role` is a string
           of the form `${id}_${role}`, like "1234_$leader". Additionally, generic placements by ID only are included
           to support role-agnostic requests (i.e., when role="$agent").
         */
        let placements = {}

        // index regular agents and their deployment nodes
        for (let node of this.nodes)
            for (let {id, role} of node.agents) {
                assert(id)
                let agent_role = _agent_role(id, role);
                (placements[agent_role] ??= []).push(node);
                (placements[id] ??= []).push(node);
            }

        // index Node objects running as agents, they're excluded from node.agents lists
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
           If role is the generic "$agent", every target deployment is accepted no matter its declared role.
         */
        role ??= schemat.GENERIC_ROLE
        agent = schemat.as_object(agent)
        let agent_role = _agent_role(agent.id, role)
        let nodes = (role === schemat.GENERIC_ROLE) ? this.agent_placements[agent.id] : this.agent_placements[agent_role]

        if (!nodes?.length) throw new Error(`agent ${agent}.${role} not deployed on any node`)
        if (nodes.some(node => node.id === this.id)) return this
        return nodes[0]
        // return nodes.random()
    }

    find_nodes(agent, role) {
        /* Array of all nodes where `agent` is currently deployed. */
    }

    /***  Agent operations  ***/

    async '$leader.deploy'(agent, role = null) {
        /* Find the least busy node and deploy `agent` there. */
        let nodes = [...this.$state.nodes.values()]
        let {id} = min(nodes, n => n.avg_agents)
        let node = schemat.get_object(id)
        await node.$master.deploy(agent, role)
        this.$state.nodes.get(node).num_agents++
    }

    async '$leader.dismiss'(agent) {}

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

              In general, agent operations are allowed to execute inside a (non-atomic) action, but not in a transaction.
              Apart from $state consistency, there are also performance reasons: in some cases, agent operations
              may last for a long time, e.g., when install/uninstall of local environment is involved,
              so running them in a transaction might block other DB transactions.
        */
        assert(!schemat.tx?.tid, `$state should only be modified outside a transaction`)

        // this._print_stack()
        this._print(`$leader.create_node() context: ${schemat.db}, ${schemat.app}, ${schemat.tx}`)

        let args = typeof props === 'string' ? [{}, props] : [props]
        let node = await schemat.std.Node.new(...args).save()

        this._print(`$leader.create_node() node: is_loaded=${node.is_loaded()}`, node.__content)

        this.$state.nodes.set(node, new NodeState(node))
        this.nodes = [...this.$state.nodes.keys()]
        // await this.update_self({nodes: [...this.$state.nodes.keys()]})
    }
}
