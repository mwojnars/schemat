import {assert, print, T} from "../common/utils.js";
import {BinaryMap} from "../util/binary.js"
import {INTEGER} from "../type.js";
import {PlainRecord, SequenceSchema} from "./records.js";
import {Item} from "../item.js";
import {IndexBlock} from "./block.js";
import {Sequence} from "./sequence.js";
import {DataRequest} from "./data_request.js";


// Section, Block, Partition

// class Store {
//     /* A Data sequence coupled with any number of Indexes and Aggregates.
//        Like a database, but with custom query API (no SQL) and the ability to fall back on another store (ring)
//        when  a particular read or write cannot be performed here (multi-ring architecture).
//      */
// }

/**********************************************************************************************************************/

export class Index extends Sequence {
    /* Sequence of records consisting of a binary `key` and a json `value`. The sequence is sorted by the key and
       allows to retrieve the value for a given key or range of keys.
     */
    static role = 'index'       // for use in ProcessingStep and DataRequest

    source                      // Sequence that this index is derived from

    __create__(ring, source, filename) {
        super.__create__(ring)
        assert(filename.endsWith('.jl'))
        this.source = source
        this.blocks = [IndexBlock.create(this, filename)]

        assert(source instanceof Sequence)
        source.add_derived(this)                // make connection: data > index, for change propagation
    }

    async apply(change) {
        /* Update the index to apply a change that originated in the source sequence. */

        // const {key, value_old, value_new} = change
        // print(`apply(), binary key [${key}]:\n   ${value_old} \n->\n   ${value_new}`)

        // TODO: request object, only used when another propagation step is to be done
        let req = new DataRequest(this, 'apply', {change})

        // del_records and put_records are BinaryMaps, {binary_key: string_value}, or null/undefined
        const [del_records, put_records] = await this._make_plan(change)

        // delete old records
        for (let [key, value] of del_records || []) {
            let block = this._find_block(key)
            if (!block.is_loaded()) block = await block.load()
            block.del(req.safe_step(null, 'del', {key})) //|| print(`deleted [${key}]`)
        }

        // (over)write new records
        for (let [key, value] of put_records || []) {
            let block = this._find_block(key)
            if (!block.is_loaded()) block = await block.load()
            block.put(req.safe_step(null, 'put', {key, value})) //|| print(`put [${key}]`)
        }
    }

    async *map_record(input_record) {
        /* Perform transformation of the input Record, as defined by this index, and yield any number (0+)
           of output Records to be stored in the index.
         */
        throw new Error('not implemented')
    }

    async _make_plan(change) {
        /* Make an update execution plan in response to a `change` in the source sequence.
           The plan is a pair of BinaryMaps, {key: value}, one for records to be deleted, and one for records
           to be written to the index sequence.
         */
        const source_schema = this.source.schema
        let in_record_old = change.record_old(source_schema)
        let in_record_new = change.record_new(source_schema)

        // map each source record (old & new) to an array of 0+ output records to be saved/removed in the index
        let out_records_old = in_record_old && await T.arrayFromAsync(this.map_record(in_record_old))
        let out_records_new = in_record_new && await T.arrayFromAsync(this.map_record(in_record_new))

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

}

export class BasicIndex extends Index {
    /* An index that receives record updates from the base data sequence, so input records represent items.
       Output records are created by selecting 1+ item properties as fields in a sort key; the record is cloned
       when a repeated field is encountered; the (optional) value is generated by selecting a subset of item properties,
       without repetitions (for repeated fields, only the first value gets included in the record).
     */

    category            // category of items allowed in this index

    async *map_record(input_record /*Record*/) {
        let item = await Item.from_binary(input_record)
        yield* this.generate_records(item)
    }

    *generate_records(item) {
        /* Generate a stream of records, each record being a {key, value} pair, NOT encoded.
           The key is an array of field values; the value is a plain JS object that can be stringified through JSON.
           The result stream can be of any size, including:
           - 0, if the item is not allowed in this index or doesn't contain the required fields,
           - 2+, if some of the item's fields to be used in the key contain repeated values.
         */
        if (!this.accept(item)) return
        const value = this.generate_value(item)
        for (const key of this.generate_keys(item))
            yield new PlainRecord(this.schema, key, value)
    }

    accept(item) { return item && (!this.category || schemat.equivalent(item._category_, this.category)) }

    generate_value(item) {
        /* Generate a JS object that will be stringified through JSON and stored as `value` in this sequence's record.
           If undefined is returned, the record will consist of a key only.
         */
        if (this.schema.empty_value()) return undefined
        return T.subset(item, ...this.schema.properties)
    }

    *generate_keys(item) {
        /* Generate a stream of keys, each being an array of field values (not encoded). */

        // array of arrays of encoded field values to be used in the key(s); only the first field can have multiple values
        let field_values = []

        for (const name of this.schema.field_names) {
            const values = item[`${name}_array`]
            if (!values.length) return              // no values (missing field), skip this item
            if (values.length >= 2 && field_values.length)
                throw new Error(`key field ${name} has multiple values, which is allowed only for the first field in the index`)
            field_values.push(values)
        }

        // flat array of encoded values of all fields except the first one
        const tail = field_values.slice(1).map(values => values[0])

        // iterate over the first field's values to produce all key combinations
        for (const head of field_values[0])
            yield [head, ...tail]
    }
}

export class IndexByCategory extends BasicIndex {
    /* Index that maps category IDs to item IDs: the key is [category ID, item ID], empty value. */

    schema = new SequenceSchema(new Map([
        ['cid', new INTEGER({blank: true})],
        ['id',  new INTEGER()],
    ]));

    *generate_keys(item) {
        yield [item._category_?._id_, item._id_]
    }
}

/**********************************************************************************************************************/

// class AggregateSequence extends Sequence {}     // or Cube like in OLAP databases e.g. Apache Druid ?
//     /* Aggregates can only implement *reversible* operations, like counting or integer sum.
//        Min/max must be handled through a full index over the min/max-ed field.
//        OR, we must somehow guarantee that the source data is never modified, only appended to (immutable source).
//      */

