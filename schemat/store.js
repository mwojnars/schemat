/*
    Distributed no-sql data store for data records (items) and indexes.
*/


// Section, Block

class Sequence {
    /* Ordered sequence of key-value records, possibly distributed and/or replicated.
       Keys and values (payload) can be composite.
     */
}

class Partition extends Sequence {
    /* Non-replicated, non-distributed part of a Sequence, physically located on a single device.
       Optionally contains an unmutable specification of the [start,end) range of supported keys.
     */
}

class DistributedSequence extends Sequence {
    /* Distributed Sequence consisting of multiple - possibly overlapping (replicated) - Partitions.
       Maintains a map of partitions. Allows reshaping (splitting, merging) of partitions.
     */
}

class Database {
    /* A Sequence of data records coupled with any number of index sequences. */
}