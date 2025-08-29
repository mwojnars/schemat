import {AgentRole} from "../common/globals.js";
import {assert, print, min, T} from "../common/utils.js";
import {Agent} from "./agent.js";
import {ObjectsMap} from "../common/structs.js";


const MASTER = 0        // ID of the master process; workers are numbered 1,2,...,N

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

// export class Nodes {
//     /* Most recent statistics on all nodes in the cluster: their health and activity. */
// }

/**********************************************************************************************************************/

export class Placements {

    _placements = {}

    __getstate__() {
        let placements = {...this._placements}

        // drop numeric [id] tags and "<node>_$master/$worker" tags in `placements`
        for (let [tag, place] in Object.entries(placements)) {
            let [id, role] = tag.split('_')
            if (!role || this._is_hidden(tag, place))
                delete placements[tag]
        }
        return placements
    }

    static __setstate__(state) { return new this(state) }

    tag(id, role = null) {
        /* Placement tag. A string that identifies agent by its ID and particular role, like "1234_$agent". */
        role ??= AgentRole.GENERIC
        assert(role[0] === '$', `incorrect name of agent role (${role})`)
        assert(id && typeof id !== 'object')
        return `${id}_${role}`
    }

    add(place, agent, role = null) {
        if (typeof place === 'object') place = place.id     // convert node & agent objects to IDs
        if (typeof agent === 'object') agent = agent.id

        let tag = this.tag(agent, role)
        this._add(place, tag)
        this._add(place, agent)
    }

    _add(place, key) {
        let places = (this._placements[`${key}`] ??= [])
        if (places.includes(place)) return                  // ignore duplicate IDs
        if (this._is_local(place)) places.unshift(place)    // always put the local node/process ID at the beginning
        else places.push(place)                             // put other node IDs at the end of the list
    }

    _is_local()  {}
    _is_hidden() {}

    find_all(agent, role = null) {
        /* Return an array of places where (agent, role) is deployed; `agent` is an object or ID. */
        if (typeof agent === 'object') agent = agent.id
        role ??= AgentRole.GENERIC
        let tag = (role === AgentRole.GENERIC) ? `${agent}` : this.tag(agent, role)
        return this._placements[tag] || []
    }
}

export class LocalPlacements extends Placements {
    /* Map of agent deployments across worker processes of a node, as a mapping of agent-role tag -> array of worker IDs
       where the agent is deployed.
     */
    constructor(node) {
        super()
        for (let {worker, id, role} of node.agents)
            this.add(worker, id, role)                      // add regular agents to placements

        this.add(MASTER, node, '$master')                   // add node.$master agent

        for (let worker = 1; worker <= this.num_workers; worker++)
            this.add(worker, node, '$worker')               // add node.$worker agents
    }

    _is_local(worker)       { return worker === schemat.kernel.worker_id }
    _is_hidden(tag, worker) { return worker === MASTER }    // placements on master process are excluded from serialization
}

export class GlobalPlacements extends Placements {
    /* Map of agent deployments across the cluster, as a mapping of agent-role tag -> array of node IDs
       where the agent is deployed; agent-role tag is a string of the form `${id}_${role}`, like "1234_$leader".
       Additionally, ID-only tags are included to support role-agnostic queries (i.e., when role="$agent").
     */

    constructor(nodes) {
        super()
        for (let node of nodes) {
            for (let {id, role} of node.agents)
                this.add(node, id, role)                    // add regular agents to placements

            // add node.$master/$worker agents (not on node.agents lists), they are deployed on itself and nowhere else
            this.add(node, node, '$master')
            this.add(node, node, '$worker')
        }
    }

    _add_hidden() {}

    _is_local(node_id)       { return node_id === schemat.kernel.node_id }
    _is_hidden(tag, node_id) { return tag.startsWith(`${node_id}_`) }   // node-on-itself placements are excluded from serialization

    find_nodes(agent, role = null) {
        /* Return an array of nodes where (agent, role) is deployed; `agent` is an object or ID. */
        let places = this.find_all(agent, role)
        return places.map(id => schemat.get_object(id))
    }

    find_node(agent, role = null) {
        /* Return the first node where (agent, role) is deployed, or undefined if none found. */
        let id = this.find_all(agent, role)[0]    //.random()
        if (id) return schemat.get_object(id)
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

    global_placements() { return new GlobalPlacements(this.nodes) }


    /***  Agent operations  ***/

    async __start__({role}) {
        assert(role === '$leader')
        let nodes = new ObjectsMap(this.nodes.map(n => [n, new NodeState(n)]))
        let global_placements = new GlobalPlacements(this.nodes)
        return {nodes, global_placements}
    }

    async '$leader.deploy_agent'(agent, role = null) {
        /* Find the least busy node and deploy `agent` there. */
        // TODO: only look among nodes where (agent, role) is not deployed yet (!)
        let nodes = [...this.$state.nodes.values()]
        let {id} = nodes[0]  //min(nodes, n => n.avg_agents)   // TODO: temporary (FIXME)
        let node = schemat.get_object(id)

        // this._print(`$leader.deploy() node states:`, nodes)
        // this._print(`$leader.deploy() node avg_agents:`, nodes.map(n => n.avg_agents))
        // this._print(`$leader.deploy() deploying ${agent} at ${node}`)

        await node.$master.deploy_agent(agent, role)
        this.$state.nodes.get(node).num_agents++
        this.$state.global_placements.add(node, agent, role)

        // TODO: node.$$master.update_placements(this.$state.global_placements)
    }

    async '$leader.dismiss_agent'(agent, role = null) {
        /* Find and stop all deployments of `agent` across the cluster. */
        let nodes = this.$state.global_placements.find_nodes(agent, role)
        await Promise.all(nodes.map(node => node.$master.dismiss_agent(agent, role)))
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
