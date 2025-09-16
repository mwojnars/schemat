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

    get _placements() { return this.cluster.$state.global_placements }

    async deploy(agent) {
        /* Find the least busy node(s) and deploy `agent` there. */
        await agent.load()
        let [role_leader, role_replica] = this.get_roles(agent)

        this._check_not_deployed(agent, role_leader)
        if (role_replica) this._check_not_deployed(agent, role_replica)

        let replicas = this._normalize_replicas(this.get_num_replicas(agent))
        let roles = Array.from({length: 1 + replicas}, () => role_replica)
        roles[0] = role_leader

        let skip = []
        let copies = this.get_num_workers(agent)
        if (copies !== 1 && replicas) throw new Error(`cannot deploy multiple local copies when replicas are deployed too`)

        for (let role of roles) {
            let node = this.cluster._least_busy_node(skip)
            skip.push(node)
            await this.cluster._start_agent(node, agent, role, {copies})
        }
    }

    async adjust_replicas(agent, num_replicas) {
        /* Bring the actual number of replicas for `agent` to the desired value of `num_replicas`
           by starting new deployments or stopping unneeded ones.
         */
        let [role_leader, role] = this.get_roles(agent)
        if (!role) throw new Error(`cannot adjust the no. of replicas for ${agent}: no role name for replicas`)

        // calculate the current no. of replicas
        let current = this._placements.count_all(agent, role)
        num_replicas = this._normalize_replicas(num_replicas)

        if (current > num_replicas) {               // too many replicas? choose one(s) at random and terminate
            let count = current - num_replicas
            for (let i = 0; i < count; i++) {
                let node = this._placements.find_random(agent, role)
                if (node) await this.cluster._stop_agent(node, agent, role)
            }
        }
        else if (current < num_replicas) {          // too few replicas? start replica(s) on idle nodes, copy data from leader
            let count = num_replicas - current
            let skip = this._placements.find_all(agent, role)
            let leader = this._placements.find_first(agent, role_leader)
            if (!leader) throw new Error(`leader not found, cannot create replica(s) of ${agent}`)

            for (let i = 0; i < count; i++) {           // choose one of replicas at random and terminate
                let node = this.cluster._least_busy_node(skip)
                skip.push(node)
                await this.cluster._start_agent(node, agent, role, {})
            }
        }
    }

    _check_not_deployed(agent, role) {
        /* Check that (agent,role) is not deployed yet in the cluster, raise an error otherwise. */
        let exists = this._placements.find_all(agent, role)
        if (exists.length) throw new Error(`agent ${agent}.${role} is already deployed in the cluster (nodes ${exists})`)
    }

    _normalize_replicas(n) {
        /* Normalize a num_replicas number: convert -1 to N-1 if needed, where N is the cluster size. */
        assert(typeof n === 'number' && n >= -1)
        return n === -1 ? this._placements.count_places() - 1 : n
    }

    get_roles(agent) {
        /* Return a pair of role names, [<leader>, <replica>], that denote the leader and replicas of `agent`, respectively.
           If <replica> is empty (undefined), it means that no replicas are created for this type of agent.
         */
        return [AgentRole.GENERIC]
    }

    get_num_replicas(agent) {
        /* Calculate the no. of replicas that should be created for `agent` across the cluster in addition to the leader deployment.
           -1 means that a replica should run on every node except the one that hosts the leader.
         */
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
    get_num_replicas(block) {
        assert(block.is_loaded())
        return block.sequence.num_replicas
    }
}
