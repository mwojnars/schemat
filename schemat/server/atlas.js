import {AgentRole} from "../common/globals.js";
import {assert, random} from "../common/utils.js";
import {Counter, Table} from "../common/structs.js";


export const MASTER = 0        // ID of the master process; workers are numbered 1,2,...,N

function _id(obj) {
    return typeof obj === 'object' ? obj.id : obj
}

function _norm({fid, id, agent, role}) {
    /* Normalize the query for route frame retrieval by converting `agent` to ID if needed and handling role=ANY. */
    if (role === AgentRole.ANY) role = undefined
    return {fid, id: id || _id(agent), role}
}

/**********************************************************************************************************************/

export class RoutingTable extends Table {
    /* Base class for a table of records that identify agent frames across the cluster / node / worker process.
       Records are indexed by {fid}, {id}, {id, role}, for different routing modes.
     */
    static indexes = {
        'fid':      (fid) => fid,
        'id':       (id) => id,
        'id_role':  (id, role) => `${id}-${role}`,
    }
}


export class FramesTable extends RoutingTable {
    /* Routing table with records of the form {fid, id, role, frame}, for indexing frames in a worker process.
     */
    all()   { return this.get_all().map(rec => rec.frame) }
}


/**********************************************************************************************************************/

export class Atlas extends RoutingTable {
    /* Cluster-wide or node-wide routing table containing records of the form {node (ID), worker (ID), fid, id, role}.
     */
    PLACE

    constructor(nodes = []) {
        super()
        for (let node of nodes)
            node.agents.map(status => this.add({...status, node: node.id}))
    }

    __getstate__() {
        // exclude special records, i.e., those with missing `fid`
        return [...this._records.values()].filter(rec => !this._special(rec))
    }

    static __setstate__(frames) {
        // create fake node objects that can be passed to Local/GlobalAtlas.constructor() in place of real nodes
        let nodes = new Map()
        for (let {node: id, ...status} of frames) {
            let node = nodes.get(id) || {id, agents: []}
            node.agents.push(status)
            nodes.set(id, node)
        }
        return new this([...nodes.values()])        // each item in the array has shape: {id, agents}
    }


    _priority(record)  {}       // true if `record` should be kept at the beginning of matching records
    _special(record) { return !record.fid }

    add_frame(status) { this.add(status) }
    remove_frame(fid) { this.remove({fid}) }

    // find_first(query /*{fid, id, agent, role}*/) {
    //     /* Return the first place ID where `fid` frame, or agent `id`, or (agent, role) is deployed; undefined if none found. */
    //     return this.get_first(_norm(query))?.[this.PLACE]
    // }

    find_first(query) {
        /* First place ID matching `query`, or undefined if none found. */
        return this.find_all(query)[0]
    }

    find_random(query) {
        /* Return a randomly selected place from all those where (agent, role) is deployed. */
        return random(this.find_all(query))
    }

    find_all(query) {
        /* Return an array of place IDs that match the {fid, id, agent, role} query. */
        let places = this.get_all(_norm(query), rec => rec[this.PLACE])
        // schemat._print(`find_all()`, {query, n_query: _norm(query), places})
        return places
    }

    count_all(query) { return this.find_all(query).length }

    count_places() {
        /* Return the number of different place IDs occurring in routes, deduplicated. */
        return this.get_places().length
    }

    get_places() {
        /* Return an array of all different place IDs occurring in routes, deduplicated. */
        return [...new Set(this.get_all().map(rec => rec[this.PLACE]))]
    }

    rank_places() {
        /* Order places by utilization, from least to most busy, and return as an array of place IDs. */
        // extract all place IDs from records, skip special frames (fid=undefined)
        let places = this.get_all().filter(rec => !this._special(rec)).map(rec => rec[this.PLACE])
        let counts = new Counter(places)
        let sorted = counts.least_common()
        return sorted.map(([place, count]) => place)
    }
}

/**********************************************************************************************************************/

export class LocalAtlas extends Atlas {
    /* Map of agent deployments across worker processes of a node, as a mapping of agent-role tag -> array of worker IDs
       where the agent is deployed.
     */

    PLACE = 'worker'
    node_id

    constructor(node) {
        if (Array.isArray(node)) node = node[0]
        super([node])
        this.node_id = node.id
        this.add({node: node.id, worker: MASTER, id: node.id, role: '$master'})     // add node.$master agent, fid=undefined
    }

    get_frames() {
        /* For saving node.agents in DB; node ID can be removed. */
        let records = this.get_all().filter(rec => !this._special(rec))
        return records.map(({node, worker, fid, id, role, ...rest}) => ({id, role, worker, ...rest, fid}))
    }

    _priority({worker}) { return worker === (Number(process.env.WORKER_ID) || 0) }    // schemat.kernel.worker_id
}

/**********************************************************************************************************************/

export class GlobalAtlas extends Atlas {
    /* Map of agent deployments across the cluster, as a mapping of agent-role tag -> array of node IDs
       where the agent is deployed; agent-role tag is a string of the form `${id}-${role}`, like "1234-$leader".
       Additionally, ID-only tags are included to support role-agnostic queries (i.e., when role="$agent").
     */
    PLACE = 'node'

    constructor(nodes) {
        super(nodes)
        for (let node of nodes) {           // add node.$master/$worker agents, they are deployed on <node> and nowhere else
            this.add({node: node.id, id: node.id, role: '$master', worker: MASTER})     // fid=undefined
            this.add({node: node.id, id: node.id, role: '$worker'})                     // worker=undefined
        }
    }

    _priority({node}) { return node === schemat.kernel.node_id }

    find_node(query) {
        /* Like find_first(), but returns a web object (node) not ID. */
        let id = this.find_first(query)
        if (id) return schemat.get_object(id)
    }

    find_nodes(query) {
        /* Like find_all(), but returns web objects (nodes), not IDs. */
        let places = this.find_all(query)
        return places.map(id => schemat.get_object(id))
    }
}



/**********************************************************************************************************************/

// export class Atlas {
//     /* List of all agent frames deployed across the cluster (GlobalAtlas) or node (LocalAtlas): their exact locations
//        (node, worker, FID), types (agent ID, role) and status (stopped, migrating); with methods for efficient routing
//        of RPC requests to appropriate frames: by FID, agent.id, or (agent.id, role) specifiers.
//      */
//     PLACE
//
//     _frames = []        // array of {node, worker, fid, id, role} specifications (status objects) of agent frames
//
//     _routes = {}        // {tag: array-of-place-ids} mapping, where `tag` is a string, "<id>-<role>" or "<id>",
//                         // and place is a node ID or worker process ID
//
//     constructor(nodes = []) {
//         for (let node of nodes) {
//             let specs = node.agents.map(status => ({...status, node: node.id}))
//             this._frames.push(...specs)
//         }
//     }
//
//     __getstate__() { return this._frames }
//
//     static __setstate__(frames) {
//         // create fake node objects that can be passed to Local/GlobalAtlas.constructor() in place of real nodes;
//         let nodes = new Map()
//         for (let {node: id, ...status} of frames) {
//             let node = nodes.get(id) || {id, agents: []}
//             node.agents.push(status)
//             nodes.set(id, node)
//         }
//         return new this([...nodes.values()])        // the array has the shape: nodes[i] = {id, agents}
//     }
//
//     tag(id, role = AgentRole.GENERIC) {
//         /* Placement tag. A string that identifies agent by its ID and particular role, like "1234-$agent". */
//         assert(role[0] === '$', `incorrect name of agent role (${role})`)
//         assert(id && typeof id !== 'object')
//         return `${id}-${role}`
//     }
//
//     add_frame(status) {
//         // schemat._print(`add_frame():`, status)
//         let {id, role} = status
//         this.add_route(status[this.PLACE], id, role)
//         this._frames.push(status)
//     }
//
//     add_route(place, agent, role = AgentRole.GENERIC) {
//         place = _id(place)           // convert node & agent objects to IDs
//         agent = _id(agent)
//         let tag = this.tag(agent, role)
//         this._add(place, tag)
//         this._add(place, agent)
//     }
//
//     _add(place, key) {
//         let places = (this._routes[`${key}`] ??= [])
//         if (places.includes(place)) return                  // ignore duplicate IDs
//         if (this._priority(place)) places.unshift(place)    // always put the local node/process ID at the beginning
//         else places.push(place)                             // put other node IDs at the end of the list
//     }
//
//     remove_frame(fid) {
//         /* Find and remove a frame by FID. */
//         assert(fid)
//         let pos = this._frames.findIndex(f => f.fid === fid)
//         if (pos === -1) {
//             schemat._print(`WARNING: frame @${fid} not found by remove_frame()`)
//             return
//         }
//         let [status] = this._frames.splice(pos, 1)
//         let {id, role} = status
//         // schemat._print(`remove_frame():`, {id, role})
//         this.remove_route(status[this.PLACE], id, role)
//     }
//
//     remove_route(place, agent, role = AgentRole.ANY) {
//         /* Remove the entry: (agent, role) -> place. If role=ANY, all entries for different roles are removed. */
//         agent = _id(agent)
//         place = _id(place)
//
//         if (role === AgentRole.ANY) {
//             this._role_tags(agent).forEach(tag => this._remove(place, tag))     // remove all agent-role tags for this agent
//             this._remove(place, agent)                                          // remove the ID-only entry since we're removing all roles
//             return
//         }
//
//         this._remove(place, this.tag(agent, role))
//
//         // check if agent -> place link remains elsewhere (in a different role), and if not, remove the ID-only entry
//         let remain = this._role_tags(agent).some(tag => this._routes[tag].includes(place))
//         if (!remain) this._remove(place, agent)
//     }
//
//     _remove(place, key) {
//         let places = this._routes[`${key}`]
//         if (!places?.length) return
//         this._routes[`${key}`] = places = places.filter(p => p !== place)
//         if (!places.length) delete this._routes[`${key}`]
//     }
//
//     _role_tags(agent_id) {
//         /* Array of all agent-role tags that match a given agent_id, no matter the role. */
//         return Object.keys(this._routes).filter(tag => tag.startsWith(`${agent_id}-`))
//     }
//
//     _priority(place)  {}     // true if `place` should be kept at the beginning of matching places
//     // _is_hidden() {}
//
//     count_places() {
//         /* Return the number of places occurring in placements, deduplicated. */
//         return this.get_places().length
//     }
//
//     get_places() {
//         /* Return an array of place IDs occurring in placements, deduplicated. */
//         return [...new Set(Object.values(this._routes).flat())]
//     }
//
//     has(agent, role)    { return this.find_first(agent, role) != null }
//
//     count_all(agent, role) { return this.find_all(agent, role).length }
//
//     find_all(agent, role = AgentRole.ANY) {
//         /* Return an array of places where (agent, role) is deployed; `agent` is an object or ID. */
//         agent = _id(agent)
//         let tag = (role === AgentRole.ANY) ? `${agent}` : this.tag(agent, role)
//         return this._routes[tag] || []
//     }
//
//     find_first(agent, role) {
//         /* Return the first place where (agent, role) is deployed, or undefined if none found. */
//         return this.find_all(agent, role)[0]
//     }
//
//     find_random(agent, role) {
//         /* Return a randomly selected place from all those where (agent, role) is deployed. */
//         return random(this.find_all(agent, role))
//     }
//
//     find_fid(fid) {
//         /* Find node/worker ID that corresponds to a given frame ID. */
//         // TODO: add `fid` to _routes and use constant-time read access instead of _frames.find()
//         assert(fid)
//         let status = this._frames.find(f => f.fid === fid)
//         return status[this.PLACE]
//     }
//
//     // list_agent_ids() {
//     //     /* Array of agent IDs occurring as keys in placement tags. */
//     //     return Object.keys(this._routes).filter(tag => !tag.includes('-')).map(tag => Number(tag))
//     // }
//
//     rank_places() {
//         /* Order places by utilization, from least to most busy, and return as an array of place IDs. */
//         let routes = Object.entries(this._routes).filter(([tag]) => tag.includes('-'))
//         let places = routes.map(([tag, places]) => places).flat()
//         // let places = agents.map(status => status.worker).filter(w => w >= 1)     // pull out worker IDs, skip the master process (0)
//
//         let counts = new Counter(places)
//         counts.delete(0)                        // remove master process from the result
//         let sorted = counts.least_common()
//         return sorted.map(entry => entry[0])
//     }
// }
//
// export class LocalAtlas extends Atlas {
//     /* Map of agent deployments across worker processes of a node, as a mapping of agent-role tag -> array of worker IDs
//        where the agent is deployed.
//      */
//
//     PLACE = 'worker'
//     node_id
//
//     constructor(node) {
//         if (Array.isArray(node)) node = node[0]
//         super([node])
//         this.node_id = node.id
//
//         for (let {worker, id, role} of node.agents)
//             this.add_route(worker, id, role)                    // add regular agents to routes
//
//         this.add_route(MASTER, node, '$master')                 // add node.$master agent
//         // for (let worker = 1; worker <= node.num_workers; worker++)
//         //     this.add_route(worker, node, '$worker')          // add node.$worker agents
//     }
//
//     get_frames() {
//         /* For saving node.agents in DB; node ID can be removed. */
//         return this._frames.map(({node, worker, fid, id, role, ...rest}) => ({id, role, worker, ...rest, fid}))
//     }
//
//     _priority(worker)       { return worker === Number(process.env.WORKER_ID) || 0 }    // schemat.kernel.worker_id
//     // _is_hidden(tag, worker) { return Number(tag.split('-')[0]) === this.node_id }       // routes of node.$master/$worker excluded
// }
//
// export class GlobalAtlas extends Atlas {
//     /* Map of agent deployments across the cluster, as a mapping of agent-role tag -> array of node IDs
//        where the agent is deployed; agent-role tag is a string of the form `${id}-${role}`, like "1234-$leader".
//        Additionally, ID-only tags are included to support role-agnostic queries (i.e., when role="$agent").
//      */
//     PLACE = 'node'
//
//     constructor(nodes) {
//         super(nodes)
//
//         for (let node of nodes)
//             for (let {id, role} of node.agents)
//                 this.add_route(node, id, role)              // add regular agents to routes
//
//         // add node.$master/$worker agents, they are deployed on <node> and nowhere else
//         for (let node of nodes) {
//             this.add_route(node, node, '$master')
//             this.add_route(node, node, '$worker')
//         }
//     }
//
//     _priority(node_id)      { return node_id === schemat.kernel.node_id }
//     // _is_hidden(tag, node)   { return tag.startsWith(`${node}-`) }       // node-on-itself routes are excluded from serialization
//
//     find_nodes(agent, role) {
//         /* Return an array of nodes where (agent, role) is deployed; `agent` is an object or ID. */
//         let places = this.find_all(agent, role)
//         return places.map(id => schemat.get_object(id))
//     }
//
//     find_node(agent, role) {
//         /* Return the first node where (agent, role) is deployed, or undefined if none found. Like find_first(), but returns a web object not ID. */
//         let id = this.find_first(agent, role)
//         if (id) return schemat.get_object(id)
//     }
// }
