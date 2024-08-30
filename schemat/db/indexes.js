import {assert, print, T} from "../common/utils.js";
import {BinaryMap} from "../util/binary.js"
import {INTEGER} from "../types/type.js";
import {ItemRecord, PlainRecord, RecordSchema, BinaryRecord, data_schema} from "./records.js";
import {DataRequest} from "./data_request.js";


// Section, Block, Partition ... Aggregate


/**********************************************************************************************************************/

export class Operator extends Item {

    record_schema       // RecordSchema that defines keys and values of records produced by this operator
}


export class Index extends Operator {
    /* Sequence of records consisting of a binary `key` and a json `value`. The sequence is sorted by the key and
       allows to retrieve the value for a given key or range of keys.
     */
    static role = 'index'       // for use in ProcessingStep and DataRequest

    // source                      // Sequence that this index is derived from
    //
    // __create__(source) {
    //     this.source = source
    //     assert(source instanceof Operator)
    //     source.add_derived(this)                // make connection: data > index, for change propagation
    // }

    apply(change, sequence /*Sequence or Subsequence*/, ring) {
        /* Update the target `sequence` of this operator+ring combination to apply a change that originated
           in the source sequence of this operator. */

        // const {key, value_old, value_new} = change
        // print(`apply(), binary key [${key}]:\n   ${value_old} \n->\n   ${value_new}`)

        // let sequence = ring.get_sequence('index', this.iid)

        // TODO: request object, only used when another propagation step is to be done
        let req = new DataRequest(this, 'apply', {change})

        // del_records and put_records are BinaryMaps, {binary_key: string_value}, or null/undefined
        const [del_records, put_records] = this._make_plan(change)

        // delete old records
        for (let [key, value] of del_records || [])
            sequence.del(req.safe_step(this, 'del', {key})) //|| print(`deleted [${key}]`)

        // (over)write new records
        for (let [key, value] of put_records || [])
            sequence.put(req.safe_step(this, 'put', {key, value})) //|| print(`put [${key}]`)
    }

    _make_plan(change) {
        /* Make an update execution plan in response to a `change` in the source sequence.
           The plan is a pair of BinaryMaps, {key: value}, one for records to be deleted, and one for records
           to be written to the index sequence.
         */
        const source_schema = this._source_schema()
        let in_record_old = change.record_old(source_schema)
        let in_record_new = change.record_new(source_schema)

        // map each source record (old & new) to an array of 0+ output records to be saved/removed in the index
        let out_records_old = in_record_old && [...this.map_record(in_record_old)]
        let out_records_new = in_record_new && [...this.map_record(in_record_new)]

        // del/put plan: records to be deleted from, or written to, the index
        let del_records = out_records_old && new BinaryMap(out_records_old.map(rec => [rec.binary_key, rec.string_value]))
        let put_records = out_records_new && new BinaryMap(out_records_new.map(rec => [rec.binary_key, rec.string_value]))

        this._prune_plan(del_records, put_records)

        return [del_records, put_records]
    }

    _prune_plan(del_records, put_records) {
        /* Prune the del/put index update plan:
           1) skip the records that are identical in `del_records` and `put_records`;
           2) don't explicitly delete records that will be overwritten with a new value anyway
         */
        if (!del_records?.size || !put_records?.size) return
        for (let key of del_records.keys())
            if (put_records.has(key)) {
                if (put_records.get(key) === del_records.get(key))      // "put" not needed when old/new values are equal
                    put_records.delete(key)
                del_records.delete(key)
            }
    }

    _source_schema() {
        throw new Error('not implemented')
        // return this.source.record_schema
    }

    *map_record(input_record) {
        /* Perform transformation of the input Record, as defined by this index, and yield any number (0+)
           of output Records to be stored in the index.
         */
        throw new Error('not implemented')
    }

    async* scan(sequence, opts = {}) {
        /* Scan this operator's output in the [`start`, `stop`) range and yield BinaryRecords.
           See Sequence.scan() for details.
         */
        let {start, stop} = opts
        let rschema = this.record_schema

        start = start && rschema.encode_key(start)          // convert `start` and `stop` to binary keys (Uint8Array)
        stop = stop && rschema.encode_key(stop)

        for await (let [key, value] of sequence.scan_binary({...opts, start, stop}))
            yield new BinaryRecord(rschema, key, value)
    }
}

export class PrimaryIndexSequence extends Index {
    /* An index that receives record updates from the base data sequence, so input records represent items.
       Output records are created by selecting 1+ item properties as fields in a sort key; the record is cloned
       when a repeated field is encountered; the (optional) value is generated by selecting a subset of item properties,
       without repetitions (for repeated fields, only the first value gets included in the record).
     */

    category            // category of items allowed in this index

    _source_schema() {
        return data_schema
    }

    *map_record(input_record /*Record*/) {
        /* Generate a stream of records, each one being a {key, value} pair, NOT encoded.
           The key is an array of field values; the value is a plain JS object that can be stringified through JSON.
           The result stream can be of any size, including:
           - 0, if the input_record is not allowed in this index or doesn't contain the required fields,
           - 2+, if some of the fields to be used in the key contain repeated values.
         */
        let item_record = ItemRecord.from_binary(input_record)
        if (!this.accept(item_record)) return undefined

        const value = this.generate_value(item_record)
        for (const key of this.generate_keys(item_record))
            yield new PlainRecord(this.record_schema, key, value)
    }

    accept(record) {
        return !this.category || this.category.is_equivalent(record.data.get('_category_'))
    }

    generate_value(item_record) {
        /* Generate a JS object that will be stringified through JSON and stored as `value` in this sequence's record.
           If undefined is returned, the record will consist of a key only.
         */
        let rschema = this.record_schema
        if (rschema.no_value()) return undefined
        let entries = rschema.properties.map(prop => [prop, item_record.data.get(prop)])     // only the first value of a repeated field is included (!)
        return Object.fromEntries(entries)
    }

    *generate_keys(item_record) {
        /* Generate a stream of keys, each being an array of field values (not encoded). */

        // array of arrays of encoded field values to be used in the key(s); only the first field can have multiple values
        let field_values = []
        let data = item_record.data

        for (const field of this.record_schema.field_names) {
            const values = data.get_all(field)
            if (!values.length) return              // no values (missing field), skip this item
            if (values.length >= 2 && field_values.length)
                throw new Error(`key field ${field} has multiple values, which is allowed only for the first field in the index`)
            field_values.push(values)
        }

        // flat array of encoded values of all fields except the first one
        const tail = field_values.slice(1).map(values => values[0])

        // iterate over the first field's values to produce all key combinations
        for (const head of field_values[0])
            yield [head, ...tail]
    }
}

export class IndexByCategory extends PrimaryIndexSequence {
    /* An index that maps category IDs to item IDs: the key is [category ID, item ID], empty value. */

    static _category_ = 17

    record_schema = new RecordSchema(new Map([
        ['cid', new INTEGER({blank: true})],
        ['id',  new INTEGER()],
    ]));

    *generate_keys(item_record) {
        let category_id = item_record.data.get('_category_')?._id_      // can be undefined, such records are also included in the index
        yield [category_id, item_record.id]
    }
}

/**********************************************************************************************************************/

// class AggregateSequence extends Sequence {}     // or Cube like in OLAP databases e.g. Apache Druid ?
//     /* Aggregates can only implement *reversible* operations, like counting or integer sum.
//        Min/max must be handled through a full index over the min/max-ed field.
//        OR, we must somehow guarantee that the source data is never modified, only appended to (immutable source).
//      */

