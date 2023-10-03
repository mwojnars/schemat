/*
    Distributed no-sql data store for data records (items) and indexes.
*/


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

class FieldDescriptor {
    /* Descriptor of a field of a record in a data/index sequence. */

    name            // name of a field/property of an input record/item; also used as the output name of this field
    // collator        // optional collator object that defines the sort order of this field
    // reverse         // (?) if true, the field sorts in descending order inside an ArrayField

    binary_length() {
        /* Return the length of the binary representation of this field if the field has a fixed length, or undefined otherwise. */
        return undefined
    }
    binary_encode(object) {
        /* Encode a plain object into a binary record. Typically, object['name'] is read and converted to the output format. */
    }
    binary_decode(record) {
        /* Decode a binary record into an object. */
    }
}

class ArrayField extends FieldDescriptor {
    /* Descriptor of a field that consists of a (fixed) array of subfields. */
    fields          // array of FieldDescriptors

    binary_encode(item) {
    }
}

export class IndexDescriptor {
    /* Specification of an index over a sequence of objects translated to binary records, each record consisting
       of a `key` (obligatory) and a `value` (optional). The index is sorted by key, and allows to retrieve the value
       for a given key or range of keys. Typically, the objects are derived from items by selecting a subset of fields
       and/or cloning the object when a repeated field is encountered.
       The decoding is a reverse operation to encoding and should yield the original object. Note, however, that the
       decoded object may lack some fields that were not included in the index.
     */

    fields                  // array of 1+ FieldDescriptors to be included in the sort key
    category                // (?) category of items allowed in this index

    // encode_item(item) {}
    // encode_entity(entity) {}

    *encode_item(item) {
        /* Convert an item to a list of plain objects that will be subsequently encoded into records.
           The result list can be of any length, including:
           - 0, if the item is not allowed in this index or doesn't contain the required fields,
           - 2+, if some of the item's fields to be used in the key contain repeated values
         */
        if (!this.allowed(item)) return

        const value = this.encode_value(this.generate_value(item))
        for (const key of this.encode_key(item))
            yield {key, value}
    }

    *encode_key(item) {
        for (const field of this.fields) {
            field.binary_encode(item)
        }
    }

    allowed(item) {
        if (!this.category.includes(item)) return []
    }

    // encode_object(object) {
    //     /* Encode an object into a record containing binary `key` and json-ified text `value`. */
    //     const key = this.encode_key(object)
    //     const value = this.encode_value(this.generate_value(object))
    //     // return new Pair(key, value)
    //     // return new KeyValue(key, value)
    //     return {key, value}         // a record {key: Uint8Array, value: json string}
    // }

    encode_value(value)  { return JSON.stringify(value) }

    generate_value(item) {}

    decode_object(key, value) {
        /* Decode a binary record into an object. */
        // if the same field occurs in both key and value, the value's field overwrite the key's field
        return this.restore_object(this.decode_key(key), this.decode_value(value))
    }

    decode_key(record) {
        let entry = {}
        for (const field of this.fields) {
            const name = field.name
            entry[name] = field.binary_decode(record)
        }
        return entry
        // return this.key_descriptor.binary_decode(record, true)
    }

    decode_value(value)         { return JSON.parse(value) }
    restore_object(key, value)  { return {...key, ...value} }

}

