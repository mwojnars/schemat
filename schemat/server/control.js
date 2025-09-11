import {assert, print} from '../common/utils.js'
import {AgentRole} from "../common/globals.js";

/**********************************************************************************************************************/

export class Controller {   //extends WebObject
    /* Agent controller. Manages a group of related agent deployments running on different nodes across the cluster.
       Receives signals of cluster reshaping and decides whether a particular deployment should be stopped/started/migrated.
       Represents the strategy of agent replication. Controller is tightly coupled to cluster.$leader as a part
       of its $state and should only be executed in cluster.$leader's process.
     */

    // saturate_workers     -- if true, agents managed by this controller should be deployed locally in multiple copies, on every worker process at a given node

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

        let replicas = this.get_num_replicas(agent)
        let roles = Array.from({length: 1 + replicas}, () => role_replica)
        roles[0] = role_leader

        // TODO: start multiple copies on different worker processes

        for (let role of roles) {
            // TODO: make sure that `node` is not the same as any previously used node (don't put two replicas together etc.)
            let node = this.cluster._least_busy_node()
            await this.cluster._start_agent(node, agent, role)
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

    get_num_workers(agent, role, node) {
        /* Calculate the no. of copies of `agent` that should be started at `node`, each copy running in a separate worker process.
           If -1 is returned, it means "as many as there are workers".
         */
        return 1
    }
}

export class BlocksController extends Controller {
    /* Manages deployments of data & index blocks of all rings: 1x block.$master per cluster + N x block.$replica,
       or full replication for bootstrap blocks. Migration of block.$master to a different node when its host node fails or goes down.
       It's assumed that agents to be deployed are instances of [Block], so their replication config can be found in sequence or ring.
     */
    get_roles()     { return ['$master', '$replica'] }
}
