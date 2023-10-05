/*
    Distributed no-sql data store for data records (items) and indexes.
*/

import {assert} from "../utils.js";
import {JSONx} from "../serialize.js";
import {BinaryInput, BinaryOutput} from "../util/binary.js"
import {INTEGER} from "../type.js";


// Section, Block, Partition

class AbstractSequence {
    /* Ordered sequence of key-value records, possibly distributed and/or replicated.
       Keys and values (payload) can be composite.
     */
}

class Block extends AbstractSequence {
    /* Non-replicated, non-distributed part of a Sequence, physically located on a single device.
       Optionally contains an unmutable specification of the [start,end) range of supported keys.
     */
}

// MasterBlock / SlaveBlock

class Sequence extends AbstractSequence {
    /* Distributed Sequence consisting of multiple - possibly overlapping (replicated) - Blocks.
       Maintains a map of blocks. Allows reshaping (splitting, merging) of blocks.
     */
}

class DataSequence extends Sequence {}
class IndexSequence extends Sequence {}

class AggregateSequence extends Sequence {}     // or Cube like in OLAP databases e.g. Apache Druid ?
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

export class IndexDescriptor {  // ShapeOfSequence, Shape
    /* Specification of an index over a sequence of objects translated to records, each record consisting
       of a binary `key` and a json `value`. The index is sorted by the key and allows to retrieve the value
       for a given key or range of keys. Typically, the objects are derived from items by selecting a subset of fields
       and/or cloning the record when a repeated field is encountered.
       The decoding is a reverse operation to encoding and should yield the original object. Note, however, that the
       decoded object may lack some fields that were not included in the index.
     */

    fields                  // {name: schema}, a Map of object fields and their schemas to be included in the sort key
    category                // (?) category of items allowed in this index

    // {id, data}

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
        let length = this.fields.size
        let bin_values = []

        for (const [name, schema] of this.fields) {
            const values = item.propsList(name)
            if (!values.length) return              // no values (missing field), skip this item
            if (values.length >= 2 && bin_values.length)
                throw new Error(`field ${name} has multiple values, which is allowed only for the first field in the index`)

            // encode `values` through the field schema
            const last = (bin_values.length === length - 1)
            const binary = values.map(v => schema.binary_encode(v, last))
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

    allowed(item) {
        if (!this.category.includes(item)) return []
    }

    generate_value(item) {
        /* Override this method to generate a `value` object that will be stringified through JSON and stored
           as a part of a record in the index. */
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
        const length = this.fields.length
        let entry = {}

        for (let i = 0; i < length; i++) {
            const [name, schema] = this.fields[i]
            const last = (i === length - 1)
            entry[name] = schema.binary_decode(input, last)
        }
        assert(input.pos === record.length)

        return entry
    }
}

export class DataDescriptor extends IndexDescriptor {
    /* Specification of a data sequence. */

    fields = new Map(Object.entries({
        id:  new INTEGER(),
    }))

    generate_value(item) {
        /* In the main data sequence, `value` of a record is the full .data of the item stored in this record. */
        assert(item.isLoaded)
        return JSONx.encode(item.data)
    }
}