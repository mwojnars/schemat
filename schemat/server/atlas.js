import {AgentRole} from "../common/globals.js";
import {assert, random} from "../common/utils.js";
import {Counter} from "../common/structs.js";
import {Struct} from "../common/catalog.js";


export const MASTER = 0        // ID of the master process; workers are numbered 1,2,...,N


function _as_id(obj) {
    return typeof obj === 'object' ? obj.id : obj
}

/**********************************************************************************************************************/

export class Table {
    /* List of records of a fixed shape, {x,y,z,...}, with indexes that provide fast queries by a specific field
       or combination of fields.
     */

    _records = new Map()    // all records of this Table keyed by the record itself: record -> record
    _index = {}             // _index[desc] is a Map of the form {key -> array-of-records}, where key is built by _key[desc](query) function
    _key = {}               // _key[desc] is a key generation function, key(...fields), where `fields` match the descriptor, `desc`

    // NOTE: the identity of records is preserved between _records and indexes, so it is valid to get a record, `rec`,
    // from _index[desc], and then use it as a key into _records, like in _records.delete(rec)

    _desc(query) {
        /* Index descriptor built by combining field names occurring in query. */
        return Object.keys(query).sort().join('_')
    }

    add(record) {
        /* Add an {x,y,z,...} record to _records and to all indexes. */
        this._records.set(record, record)
    }

    get(query = {}) {
        /* Get the first record of _index[desc].get(key) list, where `desc` and `key` are created according to fields
           and their values as present in `query`. The query may contain a subset of all record fields, the subset
           matching one of indexes.
         */
    }

    get_all(query = {}) {
        /* Like get(), but returns an array of all matching records, not the first one. */
    }

    remove(query = {}) {
        /* Find all records matching the query and remove them from _records and indexes. */
    }
}

/**********************************************************************************************************************/

export class Atlas {
    /* List of all agent frames deployed across the cluster (GlobalAtlas) or node (LocalAtlas): their exact locations
       (node, worker, FID), types (agent ID, role) and status (stopped, migrating); with methods for efficient routing
       of RPC requests to appropriate frames: by FID, agent.id, or (agent.id, role) specifiers.
     */
    PLACE

    _frames = []        // array of {node, worker, fid, id, role} specifications (status objects) of agent frames

    _routes = {}        // {tag: array-of-place-ids} mapping, where `tag` is a string, "<id>-<role>" or "<id>",
                        // and place is a node ID or worker process ID

    constructor(nodes = []) {
        for (let node of nodes) {
            let specs = node.agents.map(status => ({...status, node: node.id}))
            this._frames.push(...specs)
        }
        // schemat._print(`Atlas.constructor() _frames:`, this._frames)
    }

    // clone() { return Struct.clone(this) }

    __getstate__() {
        // create fake node objects that can be passed to Local/GlobalAtlas.constructor() in place of real nodes;
        // the returned array has the shape: nodes[i].id, nodes[i].agents

        let nodes = new Map()
        for (let {node: id, ...status} of this._frames) {
            let node = nodes.get(id) || {id, agents: []}
            node.agents.push(status)
            nodes.set(id, node)
        }
        return [...nodes.values()]
    }

    static __setstate__(nodes) { return new this(nodes) }

    // __getstate__() { return this.compactify() }
    //
    // static __setstate__(routes) {
    //     let obj = new this()
    //     obj._routes = routes
    //
    //     for (let [tag, places] of Object.entries(routes)) {
    //         if (!Array.isArray(places))
    //             routes[tag] = places = [places]              // recover singleton arrays
    //
    //         let [id] = tag.split('-')
    //         for (let place of places) obj._add(place, id)       // add ID-only entries
    //     }
    //     return obj
    // }
    //
    // compactify() {
    //     let routes = {...this._routes}
    //
    //     // clean up and compactify `routes`
    //     for (let [tag, places] of Object.entries(routes)) {
    //         places = places.filter(place => !this._is_hidden(tag, place))   // drop hidden (implicit) placements
    //         let [id, role] = tag.split('-')
    //         if (!role || !places.length) delete routes[tag]                 // drop ID-only (no role) entries
    //         else if (places.length === 1) routes[tag] = places[0]           // compact representation of singleton arrays
    //     }
    //     return routes
    // }
    //
    // _reorder_locals() {
    //     /* After deserialization on a different node, fix the ordering of places in each array so that the "local" place is listed first. */
    //     for (let places of Object.values(this._routes)) {
    //         let pos = places.findIndex(place => this._is_prime(place))      // position of the "local" place
    //         if (pos > 0) {
    //             let local = places[pos]
    //             places.splice(pos, 1)       // remove "local" from the list
    //             places.unshift(local)       // put it at the beginning of the list
    //         }
    //     }
    // }

    tag(id, role = AgentRole.GENERIC) {
        /* Placement tag. A string that identifies agent by its ID and particular role, like "1234-$agent". */
        assert(role[0] === '$', `incorrect name of agent role (${role})`)
        assert(id && typeof id !== 'object')
        return `${id}-${role}`
    }

    add_frame(status) {
        // schemat._print(`add_frame():`, status)
        let {id, role} = status
        this.add_route(status[this.PLACE], id, role)
        this._frames.push(status)
    }

    add_route(place, agent, role = AgentRole.GENERIC) {
        place = _as_id(place)           // convert node & agent objects to IDs
        agent = _as_id(agent)
        let tag = this.tag(agent, role)
        this._add(place, tag)
        this._add(place, agent)
    }

    _add(place, key) {
        let places = (this._routes[`${key}`] ??= [])
        if (places.includes(place)) return                  // ignore duplicate IDs
        if (this._is_prime(place)) places.unshift(place)    // always put the local node/process ID at the beginning
        else places.push(place)                             // put other node IDs at the end of the list
    }

    remove_frame(fid) {
        /* Find and remove a frame by FID. */
        assert(fid)
        let pos = this._frames.findIndex(f => f.fid === fid)
        if (pos === -1) {
            schemat._print(`WARNING: frame @${fid} not found by remove_frame()`)
            return
        }
        let [status] = this._frames.splice(pos, 1)
        let {id, role} = status
        // schemat._print(`remove_frame():`, {id, role})
        this.remove_route(status[this.PLACE], id, role)
    }

    remove_route(place, agent, role = AgentRole.ANY) {
        /* Remove the entry: (agent, role) -> place. If role=ANY, all entries for different roles are removed. */
        agent = _as_id(agent)
        place = _as_id(place)

        if (role === AgentRole.ANY) {
            this._role_tags(agent).forEach(tag => this._remove(place, tag))     // remove all agent-role tags for this agent
            this._remove(place, agent)                                          // remove the ID-only entry since we're removing all roles
            return
        }

        this._remove(place, this.tag(agent, role))

        // check if agent -> place link remains elsewhere (in a different role), and if not, remove the ID-only entry
        let remain = this._role_tags(agent).some(tag => this._routes[tag].includes(place))
        if (!remain) this._remove(place, agent)
    }

    _remove(place, key) {
        let places = this._routes[`${key}`]
        if (!places?.length) return
        this._routes[`${key}`] = places = places.filter(p => p !== place)
        if (!places.length) delete this._routes[`${key}`]
    }

    _role_tags(agent_id) {
        /* Array of all agent-role tags that match a given agent_id, no matter the role. */
        return Object.keys(this._routes).filter(tag => tag.startsWith(`${agent_id}-`))
    }

    _is_prime(place)  {}     // true if `place` should be kept at the beginning of matching places
    // _is_hidden() {}

    count_places() {
        /* Return the number of places occurring in placements, deduplicated. */
        return this.get_places().length
    }

    get_places() {
        /* Return an array of place IDs occurring in placements, deduplicated. */
        return [...new Set(Object.values(this._routes).flat())]
    }

    has(agent, role)    { return this.find_first(agent, role) != null }

    count_all(agent, role) { return this.find_all(agent, role).length }

    find_all(agent, role = AgentRole.ANY) {
        /* Return an array of places where (agent, role) is deployed; `agent` is an object or ID. */
        agent = _as_id(agent)
        role ??= AgentRole.GENERIC      // FIXME: remove + treat GENERIC as a regular role
        let tag = (role === AgentRole.GENERIC || role === AgentRole.ANY) ? `${agent}` : this.tag(agent, role)
        return this._routes[tag] || []
    }

    find_first(agent, role) {
        /* Return the first place where (agent, role) is deployed, or undefined if none found. */
        return this.find_all(agent, role)[0]
    }

    find_random(agent, role) {
        /* Return a randomly selected place from all those where (agent, role) is deployed. */
        return random(this.find_all(agent, role))
    }

    find_fid(fid) {
        /* Find node/worker ID that corresponds to a given frame ID. */
        // TODO: add `fid` to _routes and use constant-time read access instead of _frames.find()
        assert(fid)
        let status = this._frames.find(f => f.fid === fid)
        return status[this.PLACE]
    }

    // list_agent_ids() {
    //     /* Array of agent IDs occurring as keys in placement tags. */
    //     return Object.keys(this._routes).filter(tag => !tag.includes('-')).map(tag => Number(tag))
    // }

    rank_places() {
        /* Order places by utilization, from least to most busy, and return as an array of place IDs. */
        let routes = Object.entries(this._routes).filter(([tag]) => tag.includes('-'))
        let places = routes.map(([tag, places]) => places).flat()
        // let places = agents.map(status => status.worker).filter(w => w >= 1)     // pull out worker IDs, skip the master process (0)

        let counts = new Counter(places)
        counts.delete(0)                        // remove master process from the result
        let sorted = counts.least_common()
        return sorted.map(entry => entry[0])
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

        for (let {worker, id, role} of node.agents)
            this.add_route(worker, id, role)                    // add regular agents to routes

        this.add_route(MASTER, node, '$master')                 // add node.$master agent
        // for (let worker = 1; worker <= node.num_workers; worker++)
        //     this.add_route(worker, node, '$worker')          // add node.$worker agents
    }

    get_frames() {
        /* For saving node.agents in DB; node ID can be removed. */
        return this._frames.map(({node, worker, fid, id, role, ...rest}) => ({id, role, worker, ...rest, fid}))
    }

    // get_status() {
    //     /* Produce a list of agent configurations for saving in DB. */
    //     let routes = this.compactify()
    //     return Object.entries(routes).map(([tag, workers]) => {
    //         let [id, role] = tag.split('-')
    //         if (!Array.isArray(workers)) workers = [workers]
    //         return workers.map(worker => ({id: Number(id), role, worker}))
    //     }).flat()
    // }

    _is_prime(worker)       { return worker === Number(process.env.WORKER_ID) || 0 }    // schemat.kernel.worker_id
    // _is_hidden(tag, worker) { return Number(tag.split('-')[0]) === this.node_id }       // routes of node.$master/$worker excluded
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

        for (let node of nodes)
            for (let {id, role} of node.agents)
                this.add_route(node, id, role)              // add regular agents to routes

        // add node.$master/$worker agents, they are deployed on <node> and nowhere else
        for (let node of nodes) {
            this.add_route(node, node, '$master')
            this.add_route(node, node, '$worker')
        }
    }

    _is_prime(node_id)      { return node_id === schemat.kernel.node_id }
    // _is_hidden(tag, node)   { return tag.startsWith(`${node}-`) }       // node-on-itself routes are excluded from serialization

    find_nodes(agent, role) {
        /* Return an array of nodes where (agent, role) is deployed; `agent` is an object or ID. */
        let places = this.find_all(agent, role)
        return places.map(id => schemat.get_object(id))
    }

    find_node(agent, role) {
        /* Return the first node where (agent, role) is deployed, or undefined if none found. */
        let id = this.find_first(agent, role)
        if (id) return schemat.get_object(id)
    }
}
