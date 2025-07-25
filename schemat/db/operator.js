import {is_plural, drop_plural} from "../common/globals.js";
import {assert, print, T} from "../common/utils.js";
import {BinaryMap, compare_bin} from "../common/binary.js"
import {Catalog} from "../common/catalog.js";
import {WebObject} from "../core/object.js";
import {data_schema, RecordSchema} from "./records.js";
import {OP} from "./block.js";


/**********************************************************************************************************************/

export class Operator extends WebObject {
    /* Specification of a data processing operator: schema of output records + derivation methods.
       The same operator can be applied to multiple rings, producing different physical sequences in each ring.
     */
    key_fields
    val_fields
    file_tag

    get record_schema() {
        /* RecordSchema that defines the schema (composite key + payload) of output records produced by this operator. */
        return new RecordSchema(this.key_fields, this.val_fields)
    }
}

/**********************************************************************************************************************/

export class DataOperator extends Operator {
    /* Special type of Operator that has no source and represents the main data sequence, so it is basically a schema holder. */

    get record_schema() { return data_schema }
}

/**********************************************************************************************************************/

export class IndexOperator extends Operator {
    /* Operator that pulls data from a source sequence and creates records in a destination sequence. */

    derive_ops(key, prev, next) {
        /* Generate a list of binary instructions ("ops") to be executed on the destination sequence in response
           to [prev > next] change in the source sequence that occurred at a binary `key`.
         */
        let [del_records, put_records] = this.derive(key, prev, next)
        let ops = []

        for (let key of del_records?.keys() || [])
            ops.push(new OP('del', key))
        for (let [key, val] of put_records || [])
            ops.push(new OP('put', key, val))

        return ops
    }

    derive(key, prev, next) {
        /* Calculate what records should be deleted or put in the destination sequence in response to [prev > next] change
           in the source sequence that occurred at a binary `key`. Return a pair, [del_records, put_records], where both
           elements are BinaryMaps of destination records to be del/put respectively, {key-binary: val-json/binary/undefined}.
           (TODO: result could be merged to one BinaryMap if "tombstone" values are used)
         */
        // del_records and put_records are BinaryMaps or undefined
        let del_records = this._make_records(key, prev)
        let put_records = this._make_records(key, next)

        this._prune_plan(del_records, put_records)
        return [del_records, put_records]
    }

    _make_records(key, entity) {
        /* Map a source-sequence entity (typically, a web object) to a list of destination-sequence (index) records. */
        if (!entity) return
        let records = [...this.map_record(key, entity)]
        return new BinaryMap(records)
        // NOTE: duplicate destination keys may be created along the way, like when indexing all outgoing REFs per object
        // and the same reference occurs several times; duplicates get removed when creating BinaryMap above
    }

    *map_record(key, entity) {
        /* Perform transformation of the source entity and yield any number (0+) of output Records to be stored in the index. */
        throw new Error('not implemented')
    }

    _prune_plan(del_records, put_records) {
        /* Prune the del/put index update plan:
           1) skip the records that are identical in `del_records` and `put_records`;
           2) don't explicitly delete records that will be overwritten with a new value anyway
         */
        if (!del_records?.size || !put_records?.size) return
        for (let key of del_records.keys())
            if (put_records.has(key)) {
                let vdel = del_records.get(key)
                let vput = put_records.get(key)

                // "put" not needed when old & new values are equal; values can be strings or binary
                if (vput === vdel || (vput instanceof Uint8Array && compare_bin(vput, vdel) === 0))
                    put_records.delete(key)

                del_records.delete(key)     // in either case, do NOT explicitly delete the previous record
            }
    }
}

/**********************************************************************************************************************/

export class ObjectIndexOperator extends IndexOperator {
    /* An index that receives updates from the base data sequence, so input records represent web objects.
       Output records are created by selecting 1+ object properties as fields in the index key; multiple records can be generated
       when multiple values for a plural field (obj.xxx$) are encountered; the (optional) payload is generated by selecting
       a subset of object properties.
     */

    category        // category of objects allowed in this index (optional), also used for field type inference if `key_names` is given instead of `key_fields`
    key_names       // array of names of object properties to be included in the (compound) key of this index; plural names (xyz$) and deep paths (x.y.z) allowed

    __new__() {
        if (Array.isArray(this.key_fields)) {
            this.key_names = this.key_fields
            delete this.key_fields
        }
    }

    impute_key_fields() {
        /* A catalog of {field: type} pairs generated from `key_names` array of field names. */
        let schema = this.category?.schema || schemat.root_category['defaults.schema']
        // print('schema:', schema)

        let entries = []
        for (let field of this.key_names) {     // find out the type of every field to build a catalog of {field: type} pairs
            field = drop_plural(field)
            let type = schema.get(field)
            if (!type) throw new Error(`unknown field in 'key': ${field}`)
            entries.push([field, type])
        }
        return new Catalog(entries)
    }

    *map_record(key, obj) {
        /* Generate a stream of records, each one being a {key, value} pair, NOT encoded.
           The key is an array of field values; the value is a plain JS object that can be stringified through JSON.
           The result stream can be of any size, including:
           - 0, if the input record is not allowed in this index or doesn't contain the required fields,
           - 2+, if some of the fields to be used in the key contain repeated values.
         */
        if (!this.accept(obj)) return undefined

        let schema = this.record_schema
        let value = this.generate_value(obj)
        let val_encoded = schema.encode_value(value)    // json or binary

        for (let key of this.generate_keys(obj)) {
            let key_binary = schema.encode_key(key)
            yield [key_binary, val_encoded]
        }
    }

    accept(obj) {
        // check __category (__cid) directly, because inheritance is NOT available for deaf objects (pseudo-objects) anyway
        return !this.category || obj.__cid$.includes(this.category.id)
    }

    generate_value(obj) {
        /* Generate a JS object that will be stringified through JSON and stored as `value` in this sequence's record.
           If undefined is returned, the record will consist of a key only.
         */
        let schema = this.record_schema
        if (!schema.val_fields?.length) return undefined
        let entries = schema.val_fields.map(prop => [prop, obj[prop]])
        return Object.fromEntries(entries)
    }

    *generate_keys(obj) {
        /* Generate a stream of keys, each being an array of field values (not encoded). */

        // array of arrays of encoded field values to be used in the key(s); only the first field can have multiple values
        let field_values = []

        for (let field of this.record_schema.key_names) {
            let plural = is_plural(field)
            let values = obj[field]

            if (!plural) values = (values !== undefined) ? [values] : undefined
            if (!values?.length) return             // no value (missing field), or not an array? skip this object

            if (values.length >= 2 && field_values.length)
                throw new Error(`key field ${field} has multiple values, which is allowed only for the first field in the index`)

            field_values.push(values)
        }

        // flat array of encoded values of all fields except the first one
        let tail = field_values.slice(1).map(values => values[0])

        // iterate over the first field's values to produce all key combinations
        for (let head of field_values[0])
            yield [head, ...tail]
    }
}

/**********************************************************************************************************************/

export class AggregationOperator extends Operator {
    /* A derived operator that generates "inc" ops from source records instead of "put" or "del" like in indexing operator.
       As usual, aggregation's schema is composed of key and value fields. Unlike in indexes:
       - the key does not contain a back-reference to the source object, as typically we want to sum over multiple objects;
       - value fields must be numeric, so that sum += x incrementation makes sense;
       - there is an implicit `__count` field prepended to value fields that is always incremented/decremented by 1;
         when there are no explicit value fields given, the aggregation only computes the count; otherwise, it also computes
         sums over explicit fields, which allows retrieval of these sums or averages at the end, when accessing the record.
     */
    /* An operator that maps continuous subgroups of source records onto single records in output sequence, doing aggregation
       of the original group along the way. The group is defined as a range of records that share the same key on all fields
       *except* the last one. In other words, merging and aggregation is always done over the last field of the key,
       and the output key is made by removing the last field from the source key.

       Aggregation function(s) must be additive (reversible): it must allow adding/removing individual source records from the group,
       and incrementally updating the output, *without* evaluating the entire group. In general, only two functions
       satisfy this requirement: COUNT and SUM; and AVG which calculates SUM & COUNT combined to divide them afterward.
       Note that MIN/MAX over records are *not* additive (not aggregations) and should be calculated from original sorted index.
       Alternatively, we'd have to guarantee that the source sequence is append-only (no updates/deletes), and in such case,
       min/max operations could be done via aggregation.

       Aggregation's monitor working at source block performs pre-aggregation and only sends compacted +/- "inc" records.
     */

    function = 'COUNT'      // COUNT, SUM, AVG
    sum_type                // Type of the sum's output value: INTEGER(), NUMBER(), BIGINT(), ...
    sum_precision           // input value is shifted to the left by this no. of decimal digits before SUM

    // output = {'count': 'COUNT', 'sum_views': 'SUM(views)'}
    // types = {'sum_views': new NUMBER()}

    // aggregation = 'COUNT() as count'
    // aggregation = 'SUM(views) AS sum_views'
    // aggregations = ['COUNT', 'SUM(views) AS sum_views', ...]
}

// export class COUNT_Operator extends AggregationOperator {}
// export class SUM_Operator extends AggregationOperator {}
// export class AVG_Operator extends AggregationOperator {}


