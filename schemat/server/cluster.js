import {AgentRole} from "../common/globals.js";
import {assert, print, min} from "../common/utils.js";
import {Agent} from "./agent.js";
import {ObjectsMap} from "../common/structs.js";


export function _agent_role(id, role = null) {
    /* A string that identifies an agent by ID together with its particular role, like "1234_$agent". */
    role ??= AgentRole.GENERIC
    assert(role[0] === '$', `incorrect name of agent role (${role})`)
    return `${id}_${role}`
}

/**********************************************************************************************************************/

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

export class Placement {      // AgentInstance Run Placement Lineup Spec Allocation Provision Card Sheet Ticket Slip
    id
    role
    node_id
}

/**********************************************************************************************************************/

// export class Nodes {
//     /* Most recent statistics on all nodes in the cluster: their health and activity. */
// }

export class GlobalPlacements {
    /* Map of deployments of all agents across the cluster, as a mapping of agent-role tag to array of nodes
       where the agent is deployed; agent-role tag is a string of the form `${id}_${role}`, like "1234_$leader".
       Additionally, ID-only tags are included to support role-agnostic queries (i.e., when role="$agent").
     */

    _placements = {}

    constructor(nodes) {
        /* POJO mapping of agent-role tags to arrays of nodes where this agent is deployed; agent-role tag is a string
           of the form `${id}_${role}`, like "1234_$leader". Additionally, ID-only placements are included
           to support role-agnostic queries (i.e., when role="$agent").
         */
        let placements = this._placements

        // index regular agents and their deployment nodes
        for (let node of nodes)
            for (let {id, role} of node.agents) {
                assert(id)
                let tag = _agent_role(id, role);
                (placements[tag] ??= []).push(node);
                (placements[id] ??= []).push(node);
            }

        // index Node objects running as agents, they're excluded from node.agents lists
        for (let node of nodes) {
            let tag = _agent_role(node.id, '$master')       // there are $worker deployments, too, but they are not needed for global routing
            assert(placements[tag] === undefined)
            placements[tag] = [node]                        // node.$master is deployed on itself and nowhere else
        }
    }

    add(node_id, agent_id, role = null) {
        // if (typeof node_id === 'object') node_id = node_id.id
        assert(agent_id)
        let tag = _agent_role(agent_id, role);
        (this._placements[tag] ??= []).push(node_id);
        (this._placements[agent_id] ??= []).push(node_id);
    }

    find(agent_id, role = AgentRole.GENERIC) {
        let tag = (role === AgentRole.GENERIC) ? agent_id : _agent_role(agent_id, role)
        return this._placements[tag]
    }
}

/**********************************************************************************************************************/

export class Cluster extends Agent {

    /*
    DB-persisted properties:
        nodes           array of Node objects representing physical nodes of this cluster

    $leader state attributes:
        $state.nodes    ObjectsMap of NodeState objects keeping the most recent stats on node's health and activity
        $state.agents   map of (id -> node) + (id_role -> node) placements of agents across the cluster (global placements), no worker info;
                        similar to .global_placements, but available on $leader only and updated immediately when an agent is deployed/dismissed to a node;
                        high-level routing table for directing agent requests to proper nodes in the cluster;
                        each node additionally has a low-level routing table for directing requests to a proper worker process;
        $state.global_placements
    */


    async __load__() {
        if (SERVER) await Promise.all(this.nodes.map(node => node.load()))
    }

    get global_placements() { return new GlobalPlacements(this.nodes) }


    /***  Agent operations  ***/

    async __start__({role}) {
        assert(role === '$leader')
        let nodes = new ObjectsMap(this.nodes.map(n => [n, new NodeState(n)]))
        let global_placements = this.global_placements
        return {nodes, global_placements}
    }

    _find_nodes(agent, role) {
        /* Array of all nodes where `agent` is currently deployed. */
        // this.$state.agents
    }

    async '$leader.deploy'(agent, role = null) {
        /* Find the least busy node and deploy `agent` there. */
        let nodes = [...this.$state.nodes.values()]
        let {id} = nodes[0]  //min(nodes, n => n.avg_agents)   // TODO: temporary (FIXME)
        let node = schemat.get_object(id)

        // this._print(`$leader.deploy() node states:`, nodes)
        // this._print(`$leader.deploy() node avg_agents:`, nodes.map(n => n.avg_agents))
        // this._print(`$leader.deploy() deploying ${agent} at ${node}`)

        await node.$master.deploy(agent, role)
        this.$state.nodes.get(node).num_agents++

        // this.$state.global_placements

        // TODO: update $state.global_placements + node.$$master.update_placements()
    }

    async '$leader.dismiss'(agent) {
        /* Find and stop all deployments of `agent` across the cluster. */
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
