import {assert, print} from '../common/utils.js'
import {WebObject} from "../core/object.js";

/**********************************************************************************************************************/

export class Controller extends WebObject {
    /* Agent controller. Manages a group of related agent deployments running on different nodes across the cluster.
       Receives signals of cluster reshaping and decides whether a particular deployment should be stopped/started/migrated.
       Represents the strategy of agent replication.
     */
}

export class BlocksController extends WebObject {
    /* Manages deployments of data & index blocks of all rings: 1x block.$master per cluster + N x block.$replica,
       or full replication for bootstrap blocks. Migration of block.$master to a different node when its host node fails or goes down.
     */
}
