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

class Data extends Sequence {}
class Index extends Sequence {}

class Aggregate extends Sequence {}
    /* Aggregates can only implement *reversible* operations, like counting or integer sum.
       Min/max must be handled through a full index over the min/max-ed field.
     */

class Store {
    /* A Data sequence coupled with any number of Indexes and Aggregates.
       Like a database, but with custom query API (no SQL) and the ability to fall back on another store (ring)
       wheh a particular read or write cannot be performed here (multi-ring architecture).
     */
}