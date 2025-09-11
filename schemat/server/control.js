import {assert, print} from '../common/utils.js'

/**********************************************************************************************************************/

export class Controller {   //extends WebObject
    /* Agent controller. Manages a group of related agent deployments running on different nodes across the cluster.
       Receives signals of cluster reshaping and decides whether a particular deployment should be stopped/started/migrated.
       Represents the strategy of agent replication. Controller is tightly coupled to cluster.$leader as a part
       of its $state and should only be executed in cluster.$leader's process.
     */

    // saturate_workers     -- if true, agents managed by this controller should be executed in multiple copies, on every single worker at a given node

    constructor(cluster_leader) {
        this.cluster = cluster_leader
    }

    get _global_placements() { return this.cluster.$state.global_placements }

    async deploy(agent, role) {
        /* Find the least busy node(s) and deploy `agent` there. */

        // check that (agent,role) is not deployed yet
        let exists = this._global_placements.find_all(agent, role)
        if (exists.length) throw new Error(`agent ${agent}.${role} is already deployed in the cluster (nodes ${exists})`)

        // TODO: start replicas, not just the leader
        // TODO: start multiple copies on different worker processes

        let node = this.cluster._least_busy_node()
        return this.cluster._start_agent(node, agent, role)
    }

    get_num_workers(agent, role, node) {
        /* Calculate the no. of copies of `agent` that should be started at `node`, each copy running in a separate worker process. */
    }
}

export class BlocksController extends Controller {
    /* Manages deployments of data & index blocks of all rings: 1x block.$master per cluster + N x block.$replica,
       or full replication for bootstrap blocks. Migration of block.$master to a different node when its host node fails or goes down.
       It's assumed that agents to be deployed are instances of [Block], so their replication config can be found in sequence or ring.
     */
}
