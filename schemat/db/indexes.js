import {is_plural, truncate_plural} from "../common/globals.js";
import {assert, print, T} from "../common/utils.js";
import {Catalog} from "../core/catalog.js";
import {BinaryMap} from "../common/binary.js"
import {Record} from "./records.js";
import {DataRequest} from "./data_request.js";
import {Operator} from "./sequence.js";


// Section, Block, Partition ... Aggregate


/**********************************************************************************************************************/

export class Index extends Operator {
    /* Sequence of records consisting of a binary `key` and a json `value`. The sequence is sorted by the key and
       allows to retrieve the value for a given key or range of keys.
     */
    static role = 'index'       // for use in ProcessingStep and DataRequest

    // source                      // Sequence that this index is derived from
    //
    // __new__(source) {
    //     this.source = source
    //     assert(source instanceof Operator)
    //     source.add_derived(this)                // make connection: data > index, for change propagation
    // }
    //
    // get source_schema() {
    //     throw new Error('not implemented')
    //     // return this.source.record_schema
    // }

    change(sequence /*Sequence or Subsequence*/, key, prev, next) {
        /* Update this index on the target `sequence` to apply a [prev > next] change that originated
           in the source sequence of this index. `prev` and `next` are source-sequence entities: objects or records. */

        // print(`change(), binary key [${key}]:\n   ${value_old} \n->\n   ${value_new}`)
        // let sequence = ring.get_sequence('index', this.id)

        // del_records and put_records are BinaryMaps, {binary_key: string_value}, or null/undefined
        let del_records = this._make_records(key, prev)
        let put_records = this._make_records(key, next)

        this._prune_plan(del_records, put_records)

        // TODO: request object, only used when another propagation step is to be done
        let req = new DataRequest(this, 'change')

        // delete old records
        for (let [key, value] of del_records || [])     // TODO: `key` may be duplicated (repeated values), remove duplicates beforehand
            sequence.del(req.safe_step(this, 'del', {key})) //|| print(`deleted [${key}]`)

        // (over)write new records
        for (let [key, value] of put_records || [])     // TODO: `key` may be duplicated, keep the *first* one only
            sequence.put(req.safe_step(this, 'put', {key, value})) //|| print(`put [${key}]`)
    }

    _make_records(key, entity) {
        /* Map a source-sequence entity (typically, a web object) to a list of destination-sequence (index) records. */
        if (!entity) return
        let records = [...this.map_record(key, entity)]
        return new BinaryMap(records.map(rec => [rec.binary_key, rec.string_value]))
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
                if (put_records.get(key) === del_records.get(key))      // "put" not needed when old/new values are equal
                    put_records.delete(key)
                del_records.delete(key)
            }
    }
}

/**********************************************************************************************************************/

export class ObjectIndex extends Index {
    /* An index that receives updates from the base data sequence, so input records represent web objects.
       Output records are created by selecting 1+ object properties as fields in the index key; multiple records can be generated
       when multiple values for a plural field (obj.xxx$) are encountered; the (optional) payload is generated by selecting
       a subset of object properties.
     */

    category            // category of objects allowed in this index; obligatory if `key_fields` are present instead of `key`
    key_fields

    impute_key() {
        /* A catalog of {field: type} pairs generated from `key_fields` field names. */
        // return this.__data.get('key')
        let schema = this.category?.schema || schemat.root_category['defaults.schema']
        // print('schema:', schema)

        let entries = []
        for (let field of this.key_fields) {
            field = truncate_plural(field)
            let type = schema.get(field)
            if (!type) throw new Error(`unknown field in key_fields: ${field}`)
            entries.push([field, type])
        }

        print('impute_key():', entries)
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

        let value = this.generate_value(obj)
        for (let key of this.generate_keys(obj))
            yield Record.plain(this.record_schema, key, value)
    }

    accept(obj) {
        return !this.category || obj.instanceof(this.category)
    }

    generate_value(obj) {
        /* Generate a JS object that will be stringified through JSON and stored as `value` in this sequence's record.
           If undefined is returned, the record will consist of a key only.
         */
        let schema = this.record_schema
        if (!schema.has_payload()) return undefined
        let entries = schema.payload.map(prop => [prop, obj[prop]])
        return Object.fromEntries(entries)
    }

    *generate_keys(obj) {
        /* Generate a stream of keys, each being an array of field values (not encoded). */

        // array of arrays of encoded field values to be used in the key(s); only the first field can have multiple values
        let field_values = []

        for (let field of this.record_schema.key_fields) {
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

// class AggregateSequence extends Sequence {}     // or Cube like in OLAP databases e.g. Apache Druid ?
//     /* Aggregates can only implement *reversible* operations, like counting or integer sum.
//        Min/max must be handled through a full index over the min/max-ed field.
//        OR, we must somehow guarantee that the source data is never modified, only appended to (immutable source).
//      */

