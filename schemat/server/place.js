import {AgentRole} from "../common/globals.js";
import {assert} from "../common/utils.js";
import {Counter} from "../common/structs.js";
import {Struct} from "../common/catalog.js";


export const MASTER = 0        // ID of the master process; workers are numbered 1,2,...,N


function _as_id(obj) {
    return typeof obj === 'object' ? obj.id : obj
}

/**********************************************************************************************************************/

export class Placements {

    _placements = {}        // tag -> array-of-place-ids, where `tag` is a string, either "<id>-<role>" or "<id>",
                            // and place is a node ID or worker process ID

    clone() { return Struct.clone(this) }

    __getstate__() { return this._placements }          // no compactification as of now

    static __setstate__(placements) {
        let obj = new this()
        obj._placements = placements
        obj._reorder_locals()
        return obj
    }

    // __getstate__() { return this.compactify() }
    //
    // static __setstate__(placements) {
    //     let obj = new this()
    //     obj._placements = placements
    //
    //     for (let [tag, places] of Object.entries(placements)) {
    //         if (!Array.isArray(places))
    //             placements[tag] = places = [places]             // recover singleton arrays
    //
    //         let [id] = tag.split('-')
    //         for (let place of places) obj._add(place, id)       // add ID-only entries
    //     }
    //     return obj
    // }

    compactify() {
        let placements = {...this._placements}

        // clean up and compactify `placements`
        for (let [tag, places] of Object.entries(placements)) {
            places = places.filter(place => !this._is_hidden(tag, place))   // drop hidden (implicit) placements
            let [id, role] = tag.split('-')
            if (!role || !places.length) delete placements[tag]             // drop ID-only (no role) entries
            else if (places.length === 1) placements[tag] = places[0]       // compact representation of singleton arrays
        }
        return placements
    }

    _reorder_locals() {
        /* After deserialization on a different node, fix the ordering of places in each array so that the "local" place is listed first. */
        for (let places of Object.values(this._placements)) {
            let pos = places.findIndex(place => this._is_local(place))      // position of the "local" place
            if (pos > 0) {
                let local = places[pos]
                places.splice(pos, 1)       // remove "local" from the list
                places.unshift(local)       // put it at the beginning of the list
            }
        }
    }

    tag(id, role = null) {
        /* Placement tag. A string that identifies agent by its ID and particular role, like "1234-$agent". */
        role ??= AgentRole.GENERIC
        assert(role[0] === '$', `incorrect name of agent role (${role})`)
        assert(id && typeof id !== 'object')
        return `${id}-${role}`
    }

    add(place, agent, role = null) {
        place = _as_id(place)           // convert node & agent objects to IDs
        agent = _as_id(agent)
        let tag = this.tag(agent, role)
        this._add(place, tag)
        this._add(place, agent)
    }

    _add(place, key) {
        let places = (this._placements[`${key}`] ??= [])
        if (places.includes(place)) return                  // ignore duplicate IDs
        if (this._is_local(place)) places.unshift(place)    // always put the local node/process ID at the beginning
        else places.push(place)                             // put other node IDs at the end of the list
    }

    // remove_all(agent, role = null) {
    //     /* Remove all (agent, role) entries, no matter the place. */
    // }

    remove(place, agent, role = AgentRole.GENERIC) {
        /* Remove (agent, role) -> place entry. */
        agent = _as_id(agent)
        place = _as_id(place)

        this._remove(place, this.tag(agent, role))

        // check if agent -> place link occurs elsewhere (in a different role), and if not, remove the ID-only entry
        let remain = Object.keys(this._placements).filter(tag => tag.startsWith(`${agent}-`))
        let elsewhere = remain.some(tag => this._placements[tag].includes(place))
        if (!elsewhere) this._remove(place, agent)
    }

    _remove(place, key) {
        let places = this._placements[`${key}`]
        if (!places?.length) return
        this._placements[`${key}`] = places = places.filter(p => p !== place)
        if (!places.length) delete this._placements[`${key}`]
    }

    _is_local()  {}
    _is_hidden() {}

    has(agent, role = null) {
        return this.find_first(agent, role) != null
    }

    find_all(agent, role = AgentRole.ANY) {
        /* Return an array of places where (agent, role) is deployed; `agent` is an object or ID. */
        agent = _as_id(agent)
        role ??= AgentRole.GENERIC      // FIXME: remove + treat GENERIC as a regular role
        let tag = (role === AgentRole.GENERIC || role === AgentRole.ANY) ? `${agent}` : this.tag(agent, role)
        return this._placements[tag] || []
    }

    find_first(agent, role = null) {
        /* Return the first place where (agent, role) is deployed, or undefined if none found. */
        return this.find_all(agent, role)[0]    //.random()
    }

    list_agent_ids() {
        /* Array of agent IDs occurring as keys in placement tags. */
        return Object.keys(this._placements).filter(tag => !tag.includes('-')).map(tag => Number(tag))
    }

    rank_places() {
        /* Order places by utilization, from least to most busy, and return as an array of place IDs. */
        let placements = Object.entries(this._placements).filter(([tag]) => tag.includes('-'))
        let places = placements.map(([tag, places]) => places).flat()
        // let places = agents.map(status => status.worker).filter(w => w >= 1)     // pull out worker IDs, skip the master process (0)

        let counts = new Counter(places)
        counts.delete(0)                        // remove master process from the result
        let sorted = counts.least_common()
        return sorted.map(entry => entry[0])
    }
}

/**********************************************************************************************************************/

export class LocalPlacements extends Placements {
    /* Map of agent deployments across worker processes of a node, as a mapping of agent-role tag -> array of worker IDs
       where the agent is deployed.
     */

    node_id

    constructor(node) {
        super()
        if (!node) return
        this.node_id = node.id

        for (let {worker, id, role} of node.agents)
            this.add(worker, id, role)                      // add regular agents to placements

        // this.add_hidden(node)
        this.add(MASTER, node, '$master')                   // add node.$master agent
        for (let worker = 1; worker <= node.num_workers; worker++)
            this.add(worker, node, '$worker')               // add node.$worker agents
    }

    // add_hidden(node) {
    //     this.add(MASTER, node, '$master')                   // add node.$master agent
    //     for (let worker = 1; worker <= node.num_workers; worker++)
    //         this.add(worker, node, '$worker')               // add node.$worker agents
    // }

    get_status() {
        /* Produce a list of agent configurations for saving in DB. */
        let placements = this.compactify()
        return Object.entries(placements).map(([tag, workers]) => {
            let [id, role] = tag.split('-')
            if (!Array.isArray(workers)) workers = [workers]
            return workers.map(worker => ({id: Number(id), role, worker}))
        }).flat()
    }

    _is_local(worker)       { return worker === Number(process.env.WORKER_ID) || 0 }    // schemat.kernel.worker_id
    _is_hidden(tag, worker) { return Number(tag.split('-')[0]) === this.node_id }       // placements of node.$master/$worker excluded
    // _is_hidden(tag, worker) { return worker === MASTER }    // placements on master process are excluded
}

/**********************************************************************************************************************/

export class GlobalPlacements extends Placements {
    /* Map of agent deployments across the cluster, as a mapping of agent-role tag -> array of node IDs
       where the agent is deployed; agent-role tag is a string of the form `${id}-${role}`, like "1234-$leader".
       Additionally, ID-only tags are included to support role-agnostic queries (i.e., when role="$agent").
     */

    constructor(nodes) {
        super()
        if (!nodes) return

        for (let node of nodes)
            for (let {id, role} of node.agents)
                this.add(node, id, role)                    // add regular agents to placements

        // add node.$master/$worker agents, they are deployed on <node> and nowhere else
        for (let node of nodes) {
            this.add(node, node, '$master')
            this.add(node, node, '$worker')
        }
        // this.add_hidden(nodes)
    }

    // add_hidden(nodes) {
    //     // add node.$master/$worker agents, they are deployed on <node> and nowhere else
    //     for (let node of nodes) {
    //         this.add(node, node, '$master')
    //         this.add(node, node, '$worker')
    //     }
    // }

    _is_local(node_id)      { return node_id === schemat.kernel.node_id }
    _is_hidden(tag, node)   { return tag.startsWith(`${node}-`) }       // node-on-itself placements are excluded from serialization

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
