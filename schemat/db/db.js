import {T, assert, print, merge, fileBaseName, sleep} from '../common/utils.js'
import {DataAccessError, DatabaseError, ObjectNotFound} from "../common/errors.js"
import {WebObject} from "../core/object.js"
import {DataOperator} from "./sequence.js";
import {data_schema, Record} from "./records.js";
import {DataRequest} from "./data_request.js";
import {DataSequence} from "./sequence.js";
import {Catalog} from "../core/catalog.js";


/**********************************************************************************************************************
 **
 **  Database RING
 **
 */

export class Ring extends WebObject {
    /* Collection of (named) data streams. The primary one is the "objects" stream that contains web objects and supplies
       input data to other (derived) streams: indexes, aggregations etc. Some streams may have special type (e.g., "blobs").
     */

    static __category = 12  // ID of Ring category in the kernel
    static role = 'ring'    // Actor.role, for use in requests (DataRequest)

    file_prefix
    data_sequence           // DataSequence containing all primary data of this ring

    streams                 // logical sequences of structured data records produced by particular data operators in this ring
    // storage              // distributed key-value stores of different type and characteristic ('objects', 'blobs', 'indexes', 'aggregates', ...) for keeping stream outputs

    name                    // human-readable name of this ring for find_ring()
    readonly                // if true, the ring does NOT accept modifications: inserts/updates/deletes

    lower_ring              // reference to the base Ring (lower ring) of this one
    lower_ring_writable     // if true, the requests going down through this ring are allowed to save their updates in lower ring(s)

    // validity range [start, stop) for IDs of NEWLY-INSERTED objects in this ring;
    // UPDATED objects (re-inserted here from lower rings) can still have IDs from outside this range (!)
    min_id_exclusive = 0
    min_id_forbidden

    get stack() {
        /* Array of all rings in the stack, starting from the innermost ring (bottom of the stack) up to this one, included. */
        let stack = this.lower_ring?.stack || []
        return [...stack, this]
    }


    __new__({name, lower_ring, file_prefix, file, min_id_exclusive = 0, min_id_forbidden, readonly = false} = {}) {
        this.name = name || (file && fileBaseName(file))
        this.lower_ring = lower_ring

        // if (!name && file)
        //     this.name = file.replace(/^.*\/|\.[^.]*$/g, '')         // extract the name from the file path (no directory, no extension)
        //     // this.name = file.substring(file.lastIndexOf('/') + 1, file.lastIndexOf('.') >= 0 ? file.lastIndexOf('.') : undefined)
        //     // this.name = path.basename(file, path.extname(file))

        this.file_prefix = file_prefix
        this.readonly = readonly
        this.min_id_exclusive = min_id_exclusive
        this.min_id_forbidden = min_id_forbidden
    }

    async __setup__({}) {
        /* Create `data_sequence` and all the same indexes as in the lower ring. */

        let DataSequence = await schemat.import('/$/sys/DataSequence')
        this.data_sequence = DataSequence.new(this)
        this.streams = new Catalog()

        if (!this.lower_ring) return
        await this.lower_ring.load()
        let IndexStream = await schemat.import('/$/sys/IndexStream')

        for (let stream of this.lower_ring.streams?.values() || []) {
            let name = stream.operator.name
            this.streams.set(name, IndexStream.new(this, stream.operator))
        }
    }

    async __init__() {
        /* Initialize the ring after it's been loaded from DB. */
        if (CLIENT) return
        // print(`... ring [${this.__id || '---'}] ${this.name} (${this.readonly ? 'readonly' : 'writable'})`)

        await this.lower_ring?.load()
        await this.data_sequence.load()

        for (let stream of this.streams?.values() || [])
            await stream.load()
    }

    async erase(req) {
        /* Remove all records from this ring; open() should be called first. */
        if (this.readonly) throw new DataAccessError("the ring is read-only and cannot be erased")
        return this.data_sequence.erase(req)
    }

    async flush() { return this.data_sequence.flush() }


    /***  Errors & internal checks  ***/

    writable(id)    { return !this.readonly && (id === undefined || this.valid_id(id)) }    // true if `id` is allowed to be inserted here (only when inserting a new object, not updating an existing one from a lower ring)
    valid_id(id)    { return this.min_id_exclusive <= id && (!this.min_id_forbidden || id < this.min_id_forbidden) }


    /***  Data access & modification  ***/

    _find_block(id) {
        assert(this.__meta.active, `trying to access uninitialized ring '${this.name}' [${this.id}] for object [${id}]`)
        return this.data_sequence.find_block_id(id)
    }

    _random_block() {
        assert(this.__meta.active, `trying to access uninitialized ring '${this.name}' [${this.id}] for insert`)
        return this.data_sequence.blocks[0]
    }

    async select(id, req) {
        // return this._find_block(id).remote.select(id, req || new DataRequest())
        return this._find_block(id)._select(id, req || new DataRequest())
    }

    async delete(id, req) {
        return this._find_block(id).cmd_delete(id, req || new DataRequest())
    }

    async insert(data, req) {
        return this._random_block().cmd_insert(null, data)
    }

    async insert_at(id, data) {
        return this._find_block(id).cmd_insert(id, data)
    }

    async update(id, edits, req) {
        /* Apply `edits` to an item's data and store under the `id` in top-most ring that allows writing this particular `id`.
           Return an {id, data} record as written to the data block.
           FUTURE: `edits` may perform tests or create side effects, for example, to check for a specific item version
                   to apply the edits to; or to perform a sensitive operation inside the record-level exclusive lock,
                   even without changing the record's data.
         */
        assert(edits.length, 'missing edits')
        return this._find_block(id).cmd_update(id, edits, req || new DataRequest())
    }

    async update_full(id_or_obj, data = null, req = null) {
        let obj = T.isNumber(id_or_obj) ? null : id_or_obj
        let id  = obj?.id || id_or_obj
        data ??= obj.__data //__json
        let edits = [['overwrite', data]]

        return this._find_block(id).cmd_update(id, edits, req || new DataRequest())
    }

    async upsave(id, data, req) {
        return this._find_block(id).cmd_upsave(id, data, req || new DataRequest())
    }


    /***  Indexes and Transforms  ***/

    async *scan(name, {start, stop, limit=null, reverse=false, batch_size=100} = {}) {
        /* Scan a given data stream, `name`, in the range [`start`, `stop`) and yield the results.
           If `limit` is not null, yield at most `limit` items.
           If `reverse` is true, scan in the reverse order.
           If `batch_size` is not null, yield items in batches of `batch_size` items.
         */
        let stream = this.streams.get(name)
        yield* stream.scan({start, stop, limit, reverse, batch_size})
    }

    async* scan_all() {
        /* Yield all objects in this ring as {id, data} records. For rebuilding indexes from scratch. */
        let data = DataOperator.new()
        for await (let record of data.scan(this.data_sequence))
            yield record.decode_object()
    }

    async 'action.create_stream'(operator) {
        // TODO SEC: check permissions
        let name = operator.name
        if (this.streams[name]) throw new Error(`this stream name already exists: ${name}`)
        if (this.readonly) throw new Error("the ring is read-only")

        let opts = {ring: this.__ring, broadcast: true}
        let Stream = await schemat.import('/$/sys/Stream')
        this[`streams.${name}`] = await Stream.new(this, operator).save(opts)
        await this.save(opts)
        // await stream.build()
    }

    async rebuild_indexes() {
        /* Rebuild all derived streams by making a full scan of the data sequence. */
        for (let stream of this.streams.values())
            await stream.rebuild()
    }
}

export class BootRing extends Ring {
    /* During boot, we don't have access to category objects, so we cannot create full web objects (with __category)
       comprising the database rings. Also, the objects created are only temporary and *not* inserted to DB, so their
       __setup__() is *not* executed, hence all initialization must be done in __new__().
     */

    __new__(opts = {}) {
        let {file, ..._opts} = opts
        super.__new__(_opts)

        // the object here is created from a class and lacks __category; this kind of hack is only allowed during boot
        this.data_sequence = DataSequence._draft(this, {boot_file: file})
    }

    // select(id, req)  {
    //     print('boot ring select()')
    //     return this._find_block(id)._select(id, req || new DataRequest())
    // }

    insert() {assert(false)}
    update() {assert(false)}
    delete() {assert(false)}
    scan()   {assert(false)}
}


/**********************************************************************************************************************
 **
 **  DATABASE
 **
 */

export class Database extends WebObject {
    /* A number of Rings stacked on top of each other. Each select/insert/delete is executed on the outermost
       ring possible; while each update - on the innermost ring starting at the outermost ring containing a given ID.
       If ObjectNotFound/ReadOnly is caught, the next ring is tried.
       This class is only instantiated on the server, while the client uses a ClientDB proxy instead.
     */
    static __category = 11  // ID of Database category

    // properties:
    top_ring


    /***  Rings manipulation  ***/

    get rings()             { return this.top_ring.stack }      // [0] is the innermost ring (bottom of the stack), [-1] is the outermost ring (top)
    get rings_reversed()    { return this.rings.toReversed() }
    get bottom_ring()       { return this.rings[0] }

    async __init__() {
        if (CLIENT) return
        // print(`initializing database [${this.__id}] ...`)
        // assert(this.top_ring, 'missing rings in the database')
        await this.top_ring?.load()
    }

    locate_ring(ring_or_id) {
        /* Return the position [0,1,...] in `rings` of the top-most ring with a given ID. */
        let id = Number.isInteger(ring_or_id) ? ring_or_id : ring_or_id.id
        return this.rings.findLastIndex(ring => ring.id === id)
    }

    find_ring(name) {
        /* Return the top-most ring with a given `name`, or undefined if not found. Can be called to check if a ring name exists. */
        return this.rings_reversed.find(ring => ring.name === name)
    }

    async insert(data, {ring} = {}) {
        /* Find the top-most writable ring and insert `data` as a new entry there. Return {id, data} record.
           `ring` is an optional name of a ring to use.
         */
        if (typeof ring === 'string') {                             // find the ring by name
            let name = ring
            ring = this.find_ring(name)
            if (!ring) throw new DataAccessError(`target ring not found: '${name}'`)
            // if (!ring) return req.error_access(`target ring not found: '${name}'`)
        }
        if (!ring) {
            ring = this.rings_reversed.find(r => r.writable())      // find the first writable ring
            if (!ring) throw new DataAccessError("all ring(s) are read-only")
            // if (!ring) return req.error_access("all ring(s) are read-only")
        }
        if (!ring.writable()) throw new DataAccessError("the ring is read-only")
        // if (!ring.writable()) return req.error_access("the ring is read-only")

        return ring.insert(data)
    }


    /***  Indexes  ***/

    async *scan(name, {offset, limit, ...opts} = {}) {
        /* Yield a stream of plain Records from the index, merge-sorted from all the rings. */
        let streams = this.rings.map(r => r.scan(name, opts))
        let merged = merge(Record.compare, ...streams)
        
        if (offset)
            for (let i = 0; i < offset; i++) {
                let next = await merged.next()
                if (next.done) return
            }

        if (limit !== undefined && limit !== null) {
            let count = 0
            for await (let record of merged)
                if (++count > limit) break
                else yield record
        }
        else yield* merged

        // TODO: apply `batch_size` to the merged stream and yield in batches
    }

    // async *scan_all() {
    //     /* Scan each ring and merge the sorted streams of entries. */
    //     // TODO: remove duplicates while merging
    //     let streams = this.rings.map(r => r.scan_all())
    //     yield* merge(WebObject.compare, ...streams)
    // }

    async 'action.create_index'(name, key, payload = undefined, {ring = this.bottom_ring} = {}) {
        /* Add a new index in `ring` and all rings above. If not provided, `ring` is the bottom of the ring stack (the kernel).
           Schema of the new index is defined by `key` and `payload` (arrays of property names).
         */
        if (!Array.isArray(key) || key.length === 0) throw new Error(`index key must be an array with at least one element: ${key}`)
        if (payload && !Array.isArray(payload)) throw new Error(`index payload must be an array: ${payload}`)

        if (typeof ring === 'string') ring = this.find_ring(ring)

        let pos = this.locate_ring(ring)
        if (pos < 0) throw new Error(`ring not found in the database: ${ring}`)

        // create index specification
        let ObjectIndexOperator = await schemat.import('/$/sys/ObjectIndexOperator')
        let index = ObjectIndexOperator.new(name, key, payload)
        index = await index.save({ring})
        // schemat._transaction.getStore()?.log_modified(index)

        // create streams for `index`, in `ring` and all higher rings
        for (let i = pos; i < this.rings.length; i++) {
            ring = this.rings[i]
            await ring.action.create_stream(index)
        }
    }

    async rebuild_indexes() {
        for (let ring of this.rings)
            await ring.rebuild_indexes()
        return true
    }
}


export class BootDatabase extends Database {
    async open(ring_specs) {
        /* Create bootstrap rings according to `ring_specs` specification. */

        // assert(this.is_newborn())           // open() is a mutating operation, it can only be called on a newborn object (not in DB)
        print(`creating bootstrap database...`)
        let top

        for (const spec of ring_specs) {
            let ring = await BootRing.new(spec).load()
            ring.lower_ring = top
            top = ring
        }
        this.top_ring = top
    }

    insert() {assert(false)}
    scan() {assert(false)}
}
