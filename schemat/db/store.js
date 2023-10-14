/*
    Distributed no-sql data store for data records (items) and indexes.
*/

import {assert, print} from "../utils.js";
import {JSONx} from "../serialize.js";
import {BinaryInput, BinaryOutput, BinaryMap} from "../util/binary.js"
import {INTEGER} from "../type.js";
import {PlainRecord} from "./records.js";
import {Item} from "../item.js";


// Section, Block, Partition

class Block {
    /* Non-replicated, non-distributed part of a Sequence, physically located on a single device.
       Optionally contains an unmutable specification of the [start,end) range of supported keys.
     */
}
// MasterBlock / SlaveBlock

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
//
//     value(item) {}
//
//     binary_length() {
//         /* Return the length of the binary representation of this field if the field has a fixed length, or undefined otherwise. */
//         return undefined
//     }
//     binary_encode(object) {
//         /* Encode a plain object into a binary record. Typically, object['name'] is read and converted to the output format. */
//     }
//     binary_decode(record) {
//         /* Decode a binary record into an object. */
//     }
// }

export class SequenceDescriptor {  // ShapeOfSequence, Shape
    /* Specification of a sequence of objects translated to records, each record consisting
       of a binary `key` and a json `value`. The sequence is sorted by the key and allows to retrieve the value
       for a given key or range of keys. Typically, the objects are derived from items by selecting a subset of fields
       and/or cloning the record when a repeated field is encountered.
       The decoding is a reverse operation to encoding and should yield the original object. Note, however, that the
       decoded object may lack some fields that were not included in the index.
     */

    fields_key              // array of field names to be included in the key
    fields_value            // array of field names to be included in the value

    schema_key              // {name: type}, a Map of fields to be included in the sort key and their Types
    schema_value            // array of item's property names to be included in the value object (for repeated fields, only the first value is included)

    *encode_item(item) {
        /* Encode an item as a stream of {key, value} record(s). The result stream can be of any size, including:
           - 0, if the item is not allowed in this index or doesn't contain the required fields,
           - 2+, if some of the item's fields to be used in the key contain repeated values
         */
        if (!this.allowed(item)) return
        const value = this.encode_value(this.generate_value(item))
        for (const key of this.encode_key(item))
            yield {key, value}                          // a record, {key: Uint8Array, value: json-string}
            // new Pair(key, value)
            // new KeyValue(key, value)
    }

    *encode_key(item) {
        // array of arrays of encoded field values to be used in the key(s); only the first field can have multiple values
        let length = this.schema_key.size
        let bin_values = []

        for (const [name, type] of this.schema_key) {
            const values = item.propsList(name)
            if (!values.length) return              // no values (missing field), skip this item
            if (values.length >= 2 && bin_values.length)
                throw new Error(`field ${name} has multiple values, which is allowed only for the first field in the index`)

            // encode `values` through the field type
            const last = (bin_values.length === length - 1)
            const binary = values.map(v => type.binary_encode(v, last))
            bin_values.push(binary)
        }

        // flat array of encoded values of all fields except the first one
        const tail = bin_values.slice(1).map(values => values[0])

        // iterate over the first field's values to produce all key combinations
        for (const head of bin_values[0]) {
            let output = new BinaryOutput()
            output.write(head, ...tail)
            yield output.result()
        }
    }

    generate_value(item) {
        /* Override this method to generate a `value` object that will be stringified through JSON and stored
           as a part of a record in the index. */
        if (!this.schema_value.length) return undefined
        return item.propObject(...this.schema_value)
    }

    encode_value(value)  { return value !== undefined ? JSON.stringify(value) : undefined }
    decode_value(value)  { return value !== undefined ? JSON.parse(value) : undefined }

    decode_object(key, value) {
        /* Decode a binary record into an object. If the same field occurs in both key and value, the value's field
            overwrites the key's field, as the former typically contains more information than the latter
           (e.g. the full string instead of just the prefix).
         */
        return {...this.decode_key(key), ...this.decode_value(value)}
    }

    decode_key(record) {
        const input = new BinaryInput(record)
        const length = this.schema_key.length
        let entry = {}

        for (let i = 0; i < length; i++) {
            const [name, type] = this.schema_key[i]
            const last = (i === length - 1)
            entry[name] = type.binary_decode(input, last)
        }
        assert(input.pos === record.length)

        return entry
    }
}

export class DataDescriptor extends SequenceDescriptor {
    /* Specification of a data sequence. */

    schema_key = new Map([['id', new INTEGER()]]);

    *generate_keys(item) {
        yield [item.id]
    }

    generate_value(item) {
        /* In the main data sequence, `value` of a record is the full .data of the item stored in this record. */
        assert(item.isLoaded)
        return JSONx.encode(item.data)          // return a plain object that can be stringified with JSON
    }
}

export class IndexByCategoryDescriptor extends SequenceDescriptor {
    /* Specification of an index that maps category IDs to item IDs. */
    schema_key = new Map([['__category__', new INTEGER()]]);

    decode_object(key, value) {
    }
}

/**********************************************************************************************************************/

class Block__ {

    put(key, value)     { assert(false) }
    del(key)            { assert(false) }
}

class MemoryBlock extends Block__ {

    records = new BinaryMap()

    get(key)            { return this.records.get(key) }
    put(key, value)     { this.records.set(key, value) }
    del(key)            { this.records.delete(key) }
}

class Sequence {    // Series?

    descriptor          // SequenceDescriptor that defines this sequence's key and value
    blocks              // array of Blocks that make up this sequence
    splits              // array of split points between blocks

    constructor() {
        this.blocks = [new MemoryBlock()]
    }

    _find_block(key) { return this.blocks[0] }

}

export class Index extends Sequence {

    // source              // Sequence that this index is derived from

    async apply(change) {
        /* Update the index to apply a change that originated in the source sequence. */

        // del_records and put_records are BinaryMaps, {binary_key: string_value}
        const [del_records, put_records] = await this._make_plan(change)

        // delete old records
        for (let [key, value] of del_records)
            this._find_block(key).del(key)

        // (over)write new records
        for (let [key, value] of put_records)
            this._find_block(key).put(key, value)
    }

    *map(input_record) {
        /* Perform transformation of the input Record, as defined by this index, and output any number (0+)
           of output Records to be stored in the index.
         */
        throw new Error('not implemented')
    }

    async _make_plan(change) {
        /* Make an update execution plan in response to a `change` in the source sequence.
           The plan is a pair of BinaryMaps, {key: value}, one for records to be deleted, and one for records
           to be written to the index sequence.
         */
        // const {key, value_old, value_new} = change
        // print(`apply ${key}: ${value_old} -> ${value_new}`)

        // map each source record (old & new) to an array of 0+ index records
        let out_records_old = [...this.map(change.record_old)]
        let out_records_new = [...this.map(change.record_new)]

        // del/put plan: records to be deleted from, or written to, the index
        let del_records = new BinaryMap(out_records_old.map(rec => [rec.binary_key, rec.string_value]))
        let put_records = new BinaryMap(out_records_new.map(rec => [rec.binary_key, rec.string_value]))

        this._prune_plan(del_records, put_records)

        return [del_records, put_records]
    }

    _prune_plan(del_records, put_records) {
        /* Prune the del/put index update plan:
           1) skip the records that are identical in `del_records` and `put_records`;
           2) don't explicitly delete records that will be overwritten with a new value anyway
         */
        if (!del_records.size || !put_records.size) return
        for (let key of del_records.keys())
            if (put_records.has(key)) {
                if (put_records.get(key) === del_records.get(key))      // "put" not needed when old/new values are equal
                    put_records.delete(key)
                del_records.delete(key)
            }
    }

}

export class BasicIndex extends Index {
    /* An index that receives record updates from the base data sequence, so input records represent items. */

    category            // category of items allowed in this index

    fields              // {name: type}, a Map of fields to be included in the sort key and their Types
    schema_value        // array of item's property names to be included in the value object (for repeated fields, only the first value is included)

    _field_names        // array of names of consecutive fields in the key
    _field_types        // array of Types of consecutive fields in the key (key's schema)

    get field_names()   { return this._field_names || (this._field_names = [...this.fields.keys()]) }
    get field_types()   { return this._field_types || (this._field_types = [...this.fields.values()]) }

    *generate_records(item) {
        /* Generate a stream of records, each record being a {key, value} pair, NOT encoded.
           The key is an array of field values; the value is a plain JS object that can be stringified through JSON.
         */
        if (!this.accept(item)) return
        const value = this.generate_value(item)
        for (const key of this.generate_keys(item))
            yield new PlainRecord(this.field_types, key, value)
    }

    accept(item)            { return item && (!this.category || item.category.is(this.category)) }
    generate_value(item)    { return undefined }

    *generate_keys(item) {
        /* Generate a stream of keys, each being an array of field values (not encoded). */

        // array of arrays of encoded field values to be used in the key(s); only the first field can have multiple values
        let field_values = []

        for (const name of this.field_names) {
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
    // descriptor = new IndexByCategoryDescriptor()

    schema = [new INTEGER(), new INTEGER()]         // [category ID, item ID]

    async *map(input_record /*Record*/) {
        let item = await Item.from_binary(input_record)
        yield* this.generate_records(item)
    }

    *generate_keys(item) {
        yield [item.category.id, item.id]
    }
}
