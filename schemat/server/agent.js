import {WebObject} from "../core/object.js"


export class Agent extends WebObject {
    /* A web object that can be installed on a particular node(s) in the cluster to run a perpetual operation there (a microservice).
       Typically, the agent runs a web server, or an intra-cluster microservice of any kind, with a perpetual event loop.
       The agent is allowed to use local resources of the host node: files, sockets, etc.; with some of them (typically files)
       being allocated/deallocated in __install__/__uninstall__(), while some others (e.g., sockets) in __start__/__stop__().
    */

    // __node / __node$ -- the host node(s) where this agent is installed/running
    // __num_workers    -- 0/1/N, the number of concurrent workers per node that should execute this agent's loop at the same time; 0 = "all available"
    // __state          -- the state object returned by __start__(), to be passed to __stop__() when the microservice is to be terminated

    hard_restart

    async __install__(node) {}      // ideally, this method should be idempotent in case of failure and subsequent re-launch
    async __uninstall__(node) {}

    async __start__()     {}        // the returned state object is kept in this.__state and then passed to __stop__()
    async __stop__(state) {}

    async __restart__(state, prev) {
        /* In many cases, refreshing an agent in the worker process does NOT require full stop+start, which might have undesired side effects
           (temporary unavailability of the microservice). For this reason, __restart__() is called upon agent refresh - it can be customized
           in subclasses, and the default implementation either does nothing (default), or performs the full stop+start cycle (if hard_restart=true).
         */
        if (!this.hard_restart) return state
        await prev.__stop__(state)
        return this.__start__()
    }
}


/**********************************************************************************************************************/

// export class Driver extends WebObject {}

