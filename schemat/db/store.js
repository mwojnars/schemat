/*
    Distributed no-sql data store for data records (items) and indexes.
*/

import {assert, print, T} from "../utils.js";
import {JSONx} from "../serialize.js";
import {BinaryInput, BinaryOutput, BinaryMap, compareUint8Arrays} from "../util/binary.js"
import {INTEGER} from "../type.js";
import {BinaryRecord, PlainRecord, SequenceSchema} from "./records.js";
import {Item} from "../item.js";


// Section, Block, Partition

class Sequence__ {
    /* Ordered sequence of key-value records, possibly distributed and/or replicated.
       Keys and values (payload) can be composite.
       May consist of multiple - possibly overlapping (replicated) - Blocks.
       Maintains a map of blocks. Allows reshaping (splitting, merging) of blocks.
     */
}

class DataSequence extends Sequence__ {}
class IndexSequence extends Sequence__ {}

class AggregateSequence extends Sequence__ {}     // or Cube like in OLAP databases e.g. Apache Druid ?
    /* Aggregates can only implement *reversible* operations, like counting or integer sum.
       Min/max must be handled through a full index over the min/max-ed field.
       OR, we must somehow guarantee that the source data is never modified, only appended to (immutable source).
     */

class Store {
    /* A Data sequence coupled with any number of Indexes and Aggregates.
       Like a database, but with custom query API (no SQL) and the ability to fall back on another store (ring)
       when  a particular read or write cannot be performed here (multi-ring architecture).
     */
}

/**********************************************************************************************************************/

// class FieldDescriptor {
//     /* Descriptor of a field of a record in a data/index sequence. */
//
//     name            // name of a field/property of an input record/item; also used as the output name of this field
//     // collator        // optional collator object that defines the sort order of this field
//     // reverse         // (?) if true, the field sorts in descending order inside an ArrayField
// }

// export class SequenceDescriptor {  // ShapeOfSequence, Shape
//     /* Specification of a sequence of objects translated to records, each record consisting
//        of a binary `key` and a json `value`. The sequence is sorted by the key and allows to retrieve the value
//        for a given key or range of keys. Typically, the objects are derived from items by selecting a subset of fields
//        and/or cloning the record when a repeated field is encountered.
//        The decoding is a reverse operation to encoding and should yield the original object. Note, however, that the
//        decoded object may lack some fields that were not included in the index.
//      */
//
//     *encode_key(item) {
//         // array of arrays of encoded field values to be used in the key(s); only the first field can have multiple values
//         let length = this.schema_key.size
//         let bin_values = []
//
//         for (const [name, type] of this.schema_key) {
//             const values = item.propsList(name)
//             if (!values.length) return              // no values (missing field), skip this item
//             if (values.length >= 2 && bin_values.length)
//                 throw new Error(`field ${name} has multiple values, which is allowed only for the first field in the index`)
//
//             // encode `values` through the field type
//             const last = (bin_values.length === length - 1)
//             const binary = values.map(v => type.binary_encode(v, last))
//             bin_values.push(binary)
//         }
//
//         // flat array of encoded values of all fields except the first one
//         const tail = bin_values.slice(1).map(values => values[0])
//
//         // iterate over the first field's values to produce all key combinations
//         for (const head of bin_values[0]) {
//             let output = new BinaryOutput()
//             output.write(head, ...tail)
//             yield output.result()
//         }
//     }
//
//     encode_value(value)  { return value !== undefined ? JSON.stringify(value) : undefined }
//     decode_value(value)  { return value !== undefined ? JSON.parse(value) : undefined }
//
//     decode_object(key, value) {
//         /* Decode a binary record into an object. If the same field occurs in both key and value, the value's field
//             overwrites the key's field, as the former typically contains more information than the latter
//            (e.g. the full string instead of just the prefix).
//          */
//         return {...this.decode_key(key), ...this.decode_value(value)}
//     }
//
//     decode_key(record) {
//         const input = new BinaryInput(record)
//         const length = this.schema_key.length
//         let entry = {}
//
//         for (let i = 0; i < length; i++) {
//             const [name, type] = this.schema_key[i]
//             const last = (i === length - 1)
//             entry[name] = type.binary_decode(input, last)
//         }
//         assert(input.pos === record.length)
//
//         return entry
//     }
// }

// export class DataDescriptor extends SequenceDescriptor {
//     /* Specification of a data sequence. */
//
//     schema_key = new Map([['id', new INTEGER()]]);
//
//     *generate_keys(item) {
//         yield [item.id]
//     }
//
//     generate_value(item) {
//         /* In the main data sequence, `value` of a record is the full .data of the item stored in this record. */
//         assert(item.isLoaded)
//         return JSONx.encode(item.data)          // return a plain object that can be stringified with JSON
//     }
// }


/**********************************************************************************************************************/

export class Block {
    /* A continuous subrange of a Sequence physically located on a single machine.
       Unit of data replication and distribution (in the future).
     */

    get(key)            { assert(false) }
    put(key, value)     { assert(false) }
    del(key)            { assert(false) }
}

export class MemoryBlock extends Block {

    records = new BinaryMap()

    get(key)            { return this.records.get(key) }
    put(key, value)     { this.records.set(key, value) }
    del(key)            { this.records.delete(key) }

    *scan_block(start = null /*Uint8Array*/, stop = null /*Uint8Array*/) {
        /* Iterate over records in this block whose keys are in the [start, stop) range, where `start` and `stop`
           are binary keys (Uint8Array).
         */
        let sorted_keys = [...this.records.keys()].sort(compareUint8Arrays)
        let start_index = start ? sorted_keys.findIndex(key => compareUint8Arrays(key, start) >= 0) : 0
        let stop_index = stop ? sorted_keys.findIndex(key => compareUint8Arrays(key, stop) >= 0) : sorted_keys.length
        for (let key of sorted_keys.slice(start_index, stop_index))
            yield [key, this.records.get(key)]
    }
}

/**********************************************************************************************************************/

export class Sequence {    // Series?

    schema          // SequenceSchema that defines this sequence's key and value
    blocks          // array of Blocks that make up this sequence
    splits          // array of split points between blocks

    constructor() {
        this.blocks = [new MemoryBlock()]
    }

    _find_block(key) { return this.blocks[0] }

    generate_value(input_object) {
        /* Generate a JS object that will be stringified through JSON and stored as `value` in this sequence's record.
           If undefined is returned, the record will consist of a key only.
         */
        return undefined
    }

    async *scan_sequence(start = null, stop = null, {limit = null, reverse = false, batch_size = 100} = {}) {
        /* Scan this sequence in the [`start`, `stop`) range and yield BinaryRecords.
           If `limit` is defined, yield at most `limit` items.
           If `reverse` is true, scan in the reverse order.
           If `batch_size` is defined, yield items in batches of `batch_size` items.
         */
        let block = this._find_block(start)
        for await (let [key, value] of block.scan_block(start, stop))
            yield new BinaryRecord(this.schema, key, value)
    }
}

export class Index extends Sequence {
    /* Sequence of records consisting of a binary `key` and a json `value`. The sequence is sorted by the key and
       allows to retrieve the value for a given key or range of keys.
     */

    // source              // Sequence that this index is derived from

    async apply(change) {
        /* Update the index to apply a change that originated in the source sequence. */

        const {key, value_old, value_new} = change
        print(`apply(), binary key [${key}]:\n   ${value_old} \n->\n   ${value_new}`)

        // del_records and put_records are BinaryMaps, {binary_key: string_value}, or null/undefined
        const [del_records, put_records] = await this._make_plan(change)

        // delete old records
        for (let [key, value] of del_records || [])
            this._find_block(key).del(key) //|| print(`deleted [${key}]`)

        // (over)write new records
        for (let [key, value] of put_records || [])
            this._find_block(key).put(key, value) //|| print(`put [${key}]`)
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

        // const _data_schema = [new INTEGER()]        // TODO: use this.source.schema instead

        let in_record_old = change.record_old(_data_schema)
        let in_record_new = change.record_new(_data_schema)

        // map each source record (old & new) to an array of 0+ index records
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

    accept(item) { return item && (!this.category || item.category?.is(this.category)) }

    generate_value(item) {
        /* Generate an object that will be stringified through JSON and stored as `value` in the index record. */
        if (this.schema.empty_value()) return undefined
        return item.propObject(...this.schema.properties)
    }

    *generate_keys(item) {
        /* Generate a stream of keys, each being an array of field values (not encoded). */

        // array of arrays of encoded field values to be used in the key(s); only the first field can have multiple values
        let field_values = []

        for (const name of this.schema.field_names) {
            const values = item.propsList(name)
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
        yield [item.category?.id, item.id]
    }
}


export const _data_schema = new SequenceSchema(
    new Map([['id', new INTEGER()]]),
)

