import {assert, print} from '../common/utils.js'
import {AgentRole} from "../common/globals.js";
// import {WebObject} from "../core/object.js";

/**********************************************************************************************************************/

export class Controller {  //extends WebObject
    /* Agent controller. Manages a group of related agent deployments running on different nodes across the cluster.
       Receives signals of cluster reshaping and decides whether a particular deployment should be stopped/started/migrated.
       Represents the strategy of agent replication. Controller is tightly coupled to cluster.$leader and most of its
       functionality is executed in cluster.$leader's process, as it relies on cluster.$leader's state.
     */

    // saturate_workers     -- if true, agents managed by this controller are deployed locally in multiple copies, on every worker process available at a given node

    constructor(cluster_leader) {
        this.cluster = cluster_leader
    }

    get _global_placements() { return this.cluster.$state.global_placements }

    async deploy(agent) {
        /* Find the least busy node(s) and deploy `agent` there. */

        let [role_leader, role_replica] = this.get_roles(agent)
        role_leader ??= AgentRole.GENERIC

        this._check_not_deployed(agent, role_leader)
        if (role_replica) this._check_not_deployed(agent, role_replica)

        let copies = this.get_num_workers(agent)
        let replicas = this.get_num_replicas(agent)
        let roles = Array.from({length: 1 + replicas}, () => role_replica)
        roles[0] = role_leader

        if (copies !== 1 && replicas) throw new Error(`cannot deploy multiple local copies when replicas are deployed too`)
        let skip = []

        for (let role of roles) {
            // TODO: make sure that `node` is not the same as any previously used node (don't put two replicas together etc.)
            let node = this.cluster._least_busy_node(skip)
            skip.push(node)
            await this.cluster._start_agent(node, agent, role, {copies})
        }
    }

    _check_not_deployed(agent, role) {
        /* Check that (agent,role) is not deployed yet in the cluster, raise an error otherwise. */
        let exists = this._global_placements.find_all(agent, role)
        if (exists.length) throw new Error(`agent ${agent}.${role} is already deployed in the cluster (nodes ${exists})`)
    }

    get_roles(agent) {
        /* Return a pair of role names, [<leader>, <replica>], that denote the leader and replicas of `agent`, respectively.
           If <replica> is empty (undefined), it means that no replicas are created for this type of agent.
           If <leader> is empty, it should be imputed with AgentRole.GENERIC.
         */
        return [AgentRole.GENERIC]
    }

    get_num_replicas(agent) {
        /* Calculate the no. of replicas that should be created for `agent` across the cluster in addition to the leader deployment. */
        return 0
    }

    get_num_workers(agent) {
        /* Calculate the no. of copies of `agent` that should be started at every node, each copy running
           in a separate worker process. If -1 is returned, it means "one copy per each worker".
         */
        return 1
    }
}

export class BlocksController extends Controller {
    /* Manages deployments of data & index blocks of all rings: 1x block.$master per cluster + N x block.$replica,
       or full replication for bootstrap blocks. Migration of block.$master to a different node when its host node fails or goes down.
       It's assumed that agents to be deployed are instances of [Block], so their replication config can be found in sequence or ring.
     */
    get_roles() { return ['$master', '$replica'] }
    // get_num_replicas() { return 1 }
}
