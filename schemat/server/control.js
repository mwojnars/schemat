import {assert, print} from '../common/utils.js'
import {WebObject} from "../core/object.js";

/**********************************************************************************************************************/

export class Controller {   //extends WebObject
    /* Agent controller. Manages a group of related agent deployments running on different nodes across the cluster.
       Receives signals of cluster reshaping and decides whether a particular deployment should be stopped/started/migrated.
       Represents the strategy of agent replication.
       Controller is tightly coupled with cluster.$leader and should only be executed in cluster.$leader's process.
     */

    constructor(cluster_leader) {
        this.cluster = cluster_leader
    }

    async deploy(agent, role) {
        /* Find the least busy node and deploy `agent` there. */

        // TODO: check that (agent,role) is NOT deployed yet



        // TODO: start replicas, not just the master agent

        let node = this.cluster._least_busy_node()
        return this.cluster._start_agent(node, agent, role)
    }
}

export class BlocksController extends Controller {
    /* Manages deployments of data & index blocks of all rings: 1x block.$master per cluster + N x block.$replica,
       or full replication for bootstrap blocks. Migration of block.$master to a different node when its host node fails or goes down.
       It's assumed that agents to be deployed are instances of [Block], so their replication config can be found in sequence or ring.
     */
}
