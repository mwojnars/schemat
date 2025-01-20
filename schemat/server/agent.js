import {WebObject} from "../core/object.js"


export class Agent extends WebObject {
    /* A web object that can be installed on a particular machine(s) in the cluster to run a perpetual operation there.
       Typically, the agent runs a web server, or a microservice of any kind, with a perpetual event loop.
       The agent is allowed to use local resources of the host machine: files, sockets, etc.
    */

    // __meta.state     -- the state object returned by __start__()

    async __start__()     {}
    async __stop__(state) {}
}

