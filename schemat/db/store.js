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
    collator        // optional collator object that defines the sort order of this field
    reverse         // (?) if true, the field is sorted in descending order

    binary_length() {
        /* Return the length of the binary representation of this field (if fixed length), or undefined if variable length. */
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
}

export class IndexDescriptor {
    /* Specification of an index over a sequence of objects translated to binary records, each record consisting
       of a `key` (obligatory) and a `value` (optional). The index is sorted by key, and allows to retrieve the value
       for a given key or range of keys. Typically, the objects are derived from items by selecting a subset of fields
       and/or cloning the object when a repeated field is encountered.
       The decoding is a reverse operation to encoding and should yield the original object. Note, however, that the
       decoded object may lack some fields that were not included in the index.
     */

    key             // FieldDescriptor
    value           // FieldDescriptor

    category        // (?) category of items allowed in this index

    binary_encode(object) {
        /* Encode an object into a binary record. */
    }
    binary_decode(record) {
        /* Decode a binary record into an object. */
        // if the same field occurs in both key and value, the value's field overwrite the key's field
    }
}

