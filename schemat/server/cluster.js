import {AgentRole} from "../common/globals.js";
import {assert, print, min, T} from "../common/utils.js";
import {ObjectsMap} from "../common/structs.js";
import {Agent} from "./agent.js";
import {GlobalAtlas} from "./atlas.js";
import {BlocksController} from "./control.js";


/**********************************************************************************************************************/

export class NodeStatus {
    /* Statistics of how a particular node in the cluster is doing: health, load, heartbeat etc. */

    // general:
    id              // node.id
    status          // running / stopped / crashed
    heartbeat       // most recent heartbeat info with a timestamp

    // load:
    num_workers     // no. of worker processes
    num_frames      // total no. of agent frames deployed on the node, excluding node.$master/$worker itself

    // average no. of individual agent-role deployments per worker process
    get avg_agents() { return this.num_frames / (this.num_workers || 1) }

    // resource utilization (mem, disk, cpu), possibly grouped by agent category ...

    constructor(node) {
        /* Initial stats pulled from node's info in DB. */
        this.id = node.id
        this.num_workers = node.num_workers
        this.num_frames = node.agents.length
    }
}

// export class Nodes {
//     /* Most recent statistics on all nodes in the cluster: their health and activity. */
// }

/**********************************************************************************************************************/

export class Cluster extends Agent {

    /*
    DB-persisted properties:
        nodes           array of Node objects representing physical nodes of this cluster
                        TODO: broken/stopped nodes should still be included in `nodes` but with a status flag

        controllers     {name: controller} listing of all controllers that are active in the cluster

    State attributes:
        $leader.nodes   ObjectsMap of NodeStatus objects keeping the most recent stats on node's health and activity
                        // topology

        $leader.atlas
                        atlas of all agent deployments across the cluster; similar to .atlas(), but available on $leader only
                        and updated immediately when an agent is deployed/dismissed to a node;
                        high-level routing table for directing agent requests to proper nodes in the cluster;
                        each node additionally has a local routing table for directing requests to a proper worker process;

        $leader.controllers
                        like [cluster].controllers, but as a cluster-wide singleton object representing the most recent state
    */


    async __load__() {
        if (SERVER) await Promise.all(this.nodes.map(node => node.load()))
    }

    atlas() { return new GlobalAtlas(this.nodes) }


    /***  Agent methods  ***/

    async __start__({role}) {
        assert(role === '$leader')
        let nodes = new ObjectsMap(this.nodes.map(n => [n, new NodeStatus(n)]))
        let atlas = new GlobalAtlas(this.nodes)
        let controllers = this._create_controllers()
        return {nodes, atlas, controllers}
    }

    async __restart__() {}      // $state variables must be preserved during restarts

    _create_controllers() {
        /* For now, controllers are plain local objects, not web objects, so they don't have any internal state (no persistence). */
        return {
            'BLOCKS':       new BlocksController(this),
            'WEBSERVERS':   null,
            'UTILITIES':    null,
        }
    }

    get_nodes() {
        /* An array of node objects retrieved from the current $state information and converted to objects. */
        return [...this.$state.nodes.keys()]
    }

    get_controller(agent) {
        assert(agent.is_loaded())
        let controller_name = agent.controller
        if (!controller_name) throw new Error(`missing controller name for ${agent}`)

        let controller = this.$state.controllers[controller_name]
        if (!controller) throw new Error(`unknown controller name, '${controller_name}'`)

        return controller
    }

    async '$leader.deploy_agent'(agent, role) {
        /* Find the least busy node and deploy `agent` there. */
        await agent.load()
        return this.get_controller(agent).deploy(agent, role)
    }

    async '$leader.remove_agent'(agent, role = AgentRole.ANY) {
        /* Find and stop all deployments of `agent` across the cluster. */

        if (this.is(agent)) throw new Error(`cannot directly remove cluster leader agent, ${agent}`)
        if (this.get_nodes().some(n => n.is(agent))) throw new Error(`cannot directly remove a node agent, ${agent}`)

        let nodes = this.$state.atlas.find_nodes({agent, role})
        await Promise.all(nodes.map(node => this._stop_agent(node, agent, role)))
    }

    async '$leader.adjust_replicas'(agent, num_replicas) {
        await agent.load()
        return this.get_controller(agent).adjust_replicas(agent, num_replicas)
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
        assert(!schemat.session?.tid, `$state should only be modified outside a transaction`)

        // this._print_stack()
        this._print(`$leader.create_node() context: ${schemat.db}, ${schemat.app}, ${schemat.session}`)

        let args = typeof props === 'string' ? [{}, props] : [props]
        let node = await schemat.std.Node.new(...args).save()

        this._print(`$leader.create_node() node: is_loaded=${node.is_loaded()}`, node.__content)

        this.$state.nodes.set(node, new NodeStatus(node))
        this.nodes = [...this.$state.nodes.keys()]
        // await this.update_self({nodes: [...this.$state.nodes.keys()]}).save()
    }

    async _start_agent(node, agent, role, opts) {
        /* For use by Controller. */
        // this._print(`$leader.deploy() deploying ${agent} at ${node}`)
        let {nodes, atlas} = this.$state
        let frames = await node.$master.start_agent(agent, role, opts)
        nodes.get(node).num_frames += frames.length
        frames.map(status => atlas.add_frame(status))
        await this._broadcast_placements()
    }

    async _stop_agent(node, agent, role, opts) {
        let {nodes, atlas} = this.$state
        let fids = await node.$master.stop_agent(agent, role)
        nodes.get(node).num_frames -= fids.length
        fids.map(fid => atlas.remove_frame(fid))
        await this._broadcast_placements()
    }

    async _broadcast_placements() {
        /* Send updated atlas to all nodes in the cluster. */
        let nodes = this.get_nodes()
        let atlas = this.$state.atlas
        return Promise.all(nodes.map(node => node.$master.update_atlas(atlas)))
    }


    /***  Utilities  ***/

    _least_busy_node(skip = []) {
        /* Find the least busy node in cluster, `skip` nodes excluded. Return null if `skip` covers the entire cluster. */
        // this._print(`$leader.deploy() node states:`, nodes)
        // this._print(`$leader.deploy() node avg_agents:`, nodes.map(n => n.avg_agents))
        let skip_id = skip.map(n => typeof n === 'object' ? n.id : n)
        let nodes = [...this.$state.nodes.values()]
        let avail = nodes.filter(n => !skip_id.includes(n.id))
        if (!avail.length) return null
        // if (!avail.length) avail = nodes        // if `skip` covers the entire cluster (no nodes left), ignore it entirely

        let {id} = min(avail, n => n.avg_agents)
        return schemat.get_object(id)
    }

}
