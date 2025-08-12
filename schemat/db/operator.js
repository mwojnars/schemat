import {is_plural, drop_plural} from "../common/globals.js";
import {assert, print, T} from "../common/utils.js";
import {BinaryMap, compare_bin} from "../common/binary.js"
import {WebObject} from "../core/object.js";
import {data_schema, RecordSchema} from "./records.js";
import {OP} from "./block.js";
import {JSONx} from "../common/jsonx.js";


/**********************************************************************************************************************/

export class Operator extends WebObject {
    /* Specification of a data processing operator: schema of output records + derivation methods.
       The same operator can be applied to multiple rings, producing different physical sequences in each ring.
     */

    fields      // {field: type} schema of pseudo-objects represented by this operator's output records;
                // null/missing fields are allowed, generic schema is assumed for them

    key         // names of fields that comprise the key part of record; plural form (xxx$) allowed for the first field
    value       // names of fields that comprise the value part (payload) of record

    // key     // specification of the key: list of field names with optional type and/or generation function;
    //         // if generation functions are given, the names do NOT have to map 1:1 to source object's properties
    //         // ??? generation functions must be given as import paths, otherwise they could not be serialized (!)
    //         //     maybe the function path may map to operator's class method, not object's? this would imply that
    //         //     custom [operator].__class is set up, so the operator can provide custom .field_xxx(obj) methods
    //         // types are needed for .binary_encode/decode() ONLY, so some of their options can be removed

    key_fields      // map of {names -> Types} of fields comprising the (composite) key of this operator's output records
    val_fields      // names of fields comprising the payload (value) of this operator's output records
    file_tag

    get record_schema() {
        /* RecordSchema that defines the schema (composite key + payload) of output records produced by this operator. */
        return new RecordSchema(this.key_fields, this.val_fields)
    }

    get key_names() { return [...this.key_fields.keys()] }
    
    encode_key(key) {
        /* Convert an array of key-field values to a binary key (Uint8Array). */
        return this.record_schema.encode_key(key)
    }

    decode_key(bin) {
        return this.record_schema.decode_key(bin)
    }

    decode_object(key, val) {
        // let schema = this.record_schema
        return {...this._decode_key_object(key), ...this._decode_value(val)}
    }

    _decode_key_object(key_binary) {
        let fields = this.key_names
        let key = this.decode_key(key_binary)
        let obj = {}
        for (let i = 0; i < fields.length; i++) {
            let field = drop_plural(fields[i])
            obj[field] = key[i]
        }
        return obj
    }

    _decode_value(val_json) {
        if (!val_json) return {}
        let vector = JSONx.parse(`[${val_json}]`)
        return Object.fromEntries(this.val_fields.map((field, i) => [field, vector[i]]))
    }
}

/**********************************************************************************************************************/

export class DataOperator extends Operator {
    /* Operator that represents schema of the main data sequence. */

    get record_schema() { return data_schema }

    encode_id(id)  { return data_schema.encode_id(id) }
    decode_id(key) { return data_schema.decode_id(key) }
}

/**********************************************************************************************************************/

export class DerivedOperator extends Operator {
    /* Operator that maps objects from one sequence (source) to records of another (destination). Source objects
       can be either web objects (deaf), or pseudo-objects recreated from binary record representation.

       Output records are created as [key,val] pairs, where `key` is a binary vector (Uint8Array), and optional `val`
       is a JSONx string; later, such pairs are converted to low-level OP instructions (ops) for the destination sequence.

       The `key` and `val` parts are created by selecting a predefined number of fields (properties) from source object,
       according to the operator's schema declaration (`record_schema`), and assembling them into vectors (arrays),
       which are then converted to binary or JSON strings via the schema. Multiple records can be generated from
       a single object when a plural field (obj.xxx$) with multiple values is used in the key.

       If .field_xxx(obj) method is present in this operator's class, it is used to generate values of `xxx` field;
       otherwise, the field is extracted directly from object when generating a record (value=obj.field).
     */

    category        // category of objects allowed in this index (optional), also used for field type inference if names only are provided
    key_names       // array of names of object properties to be included in the (compound) key of this index; plural names (xyz$) and deep paths (x.y.z) allowed
                    // TODO: remove `key_names` from schema, only use `key_fields`

    __new__() {
        if (Array.isArray(this.key_fields)) {
            this.key_names = this.key_fields
            this.key_fields = this._infer_key_fields(this.key_names)
        }
        // this._print(`DerivedOperator.__new__(): key_names=${this.key_names} key_fields=${this.key_fields}`)
    }

    _infer_key_fields(key_names) {
        /* Create a Map of {field: type} from an array of field names, `key_names`, combined with types from category.schema. */
        let schema = this.category?.schema || schemat.root_category['defaults.schema']
        // print('schema:', schema)

        let entries = []
        for (let field of key_names) {     // find out the type of every field to build a catalog of {field: type} pairs
            field = drop_plural(field)
            let type = schema.get(field)
            if (!type) throw new Error(`unknown field in 'key': ${field}`)

            type = type.clone()
            type.remove_option('info', 'getter')    // some options are irrelevant for record's schema

            entries.push([field, type])
        }
        return new Map(entries)
    }

    derive_ops(key, prev, next) {
        /* Generate a list of low-level instructions ("ops") to be executed on the destination sequence in response
           to [prev > next] change in the source sequence that occurred at a binary `key`. Every change is modeled
           as two independent steps: (1) removing `prev` from the source sequence, (2) inserting `next` in this place.
           Missing `prev` represents insertion; missing `next` represents deletion; both present = update.
         */
        // BinaryMap of destination [key,val] pairs created/removed after addition/removal of a source object; can be undefined
        let rmv_records = this._make_records(key, prev)
        let ins_records = this._make_records(key, next)

        this._prune_plan(rmv_records, ins_records, true)
        let ops = []

        for (let [key, val] of rmv_records || [])
            ops.push(this._op_rmv(key, val))
        for (let [key, val] of ins_records || [])
            ops.push(this._op_ins(key, val))

        return ops
    }

    _prune_plan(rmv_records, ins_records, implicit_override = false) {
        /* Prune the destination sequence update plan:
           1) skip the records that are identical in `rmv_records` and `ins_records` (the property didn't change in source during update);
           2) don't explicitly delete records that will be overwritten with a new value anyway (valid for indexes only, not aggregations).
         */
        if (!rmv_records?.size || !ins_records?.size) return
        for (let key of rmv_records.keys())
            if (ins_records.has(key)) {
                let v_rmv = rmv_records.get(key)
                let v_ins = ins_records.get(key)
                // assert(!(v_ins instanceof Uint8Array))

                // plus/minus ops cancel out when old & new values are equal (string comparison)
                if (v_ins === v_rmv) {          // || (v_ins instanceof Uint8Array && compare_bin(v_ins, v_rmv) === 0))
                    ins_records.delete(key)
                    rmv_records.delete(key)
                }
                else if (implicit_override)
                    rmv_records.delete(key)     // when the destination is an index (del/put ops), it is safe to drop "del" when followed by "put"
            }
    }

    compactify(ops) {
        /* Merge & compactify, if possible, a batch of `ops` produced from a number of different source records. */
        return ops
    }

    _make_records(key, obj) {
        /* Map a source-sequence object (a web object or pseudo-object) to a list of destination-sequence (index) records. */
        if (!obj) return
        let records = [...this.map_object(key, obj)].reverse()
        return new BinaryMap(records)
        // NOTE: duplicate destination keys may be created along the way, like when indexing all outgoing REFs per object
        // and the same reference occurs several times; duplicates get removed when creating BinaryMap above
    }

    *map_object(key, obj) {
        /* Perform transformation of the source object and yield any number (0+) of output [key,val] pairs that will
           update the destination sequence. The result can be of any size, including:
           - 0: if the input object is filtered out, or doesn't contain the required fields;
           - 2+: if some of the fields in the key contain repeated values.
         */
        if (!this.accept(obj)) return undefined
        let val = this.generate_value(obj)

        for (let key of this.generate_keys(obj))
            yield [key, val]
    }

    accept(obj) {
        // check __category (__cid) directly, because inheritance is NOT available for deaf objects (pseudo-objects) anyway
        return !this.category || obj.__cid$?.includes(this.category.id)
    }

    *generate_keys(obj) {
        /* Generate a stream of keys, each being an array of key-field values (not encoded). */

        // array of arrays of encoded field values to be used in the key(s); only the first field can have multiple values
        let field_values = []

        for (let field of this.record_schema.key_names) {
            let plural = is_plural(field)
            let values = obj[field]

            if (!plural) values = (values !== undefined) ? [values] : undefined
            if (!values?.length) return             // no value (missing field), or not an array? skip this object

            if (values.length >= 2 && field_values.length)
                throw new Error(`key field ${field} has multiple values, which is allowed only for the first field`)

            field_values.push(values)
        }

        // flat array of encoded values of all fields except the first one
        let tail = field_values.slice(1).map(values => values[0])

        // iterate over the first field's values to produce all key combinations
        for (let head of field_values[0])
            yield this.encode_key([head, ...tail])
    }
}

/**********************************************************************************************************************/

export class IndexOperator extends DerivedOperator {
    /* Derived operator that outputs "put" and "del" instructions for the destination sequence, effectively building
       an index on selected properties of source objects.
     */

    _op_rmv(key, val) { return new OP('del', key) }         // alternative: "put" with <tombstone> (?)
    _op_ins(key, val) { return new OP('put', key, val) }

    generate_value(obj) {
        /* Extract a vector of payload values from source object, `obj`, and stringify it via JSONx, surrounding brackets stripped.
           Undefined values are replaced with null. If no payload fields are declared (val_fields), empty string is returned.
           The returned string is used as a "value" part of the record for the destination sequence.

           TODO: use CBOR encoding (https://github.com/kriszyp/cbor-x)
           import cbor from 'cbor-x'
           let buf = cbor.encode(obj)
           let obj = cbor.decode(buf)
         */
        let {val_fields} = this
        if (!val_fields?.length) return ''
        let vector = val_fields.map(f => {let v = obj[f]; return v === undefined ? null : v})
        return JSONx.stringify(vector).slice(1, -1)
    }
}


/**********************************************************************************************************************/

export class AggregationOperator extends DerivedOperator {      // SumOperator
    /* A derived operator that generates "inc"/"dec" ops from source records instead of "put"/"del" as in index operator,
       effectively building counts and sums (aggregations) across groups of source records sharing the same key in the destination.
       After count & sum are calculated, it is possible to calculate an average outside the sequence.
       It is *not* possible to calculate min/max per group: these operations require an index, not aggregation.

       Aggregation's schema is composed of key and value fields, like in indexes, but contrary to indexes:
       - the key does not contain a back-reference to the source object, because typically we want to sum over multiple objects;
       - all value fields must be numeric, so that incrementation (sum += x) makes sense;
       - there is an implicit `__count` field prepended to value fields that is incremented/decremented by 1;
         when no explicit value fields are specified, the aggregation only computes the count; otherwise, it also computes
         sums over explicit fields, which allows retrieval of these sums or averages at the end when accessing the record;
         only the explicit field names are passed to .new().

       Use:   AggregationOperator.new({name}, ['f1', 'f2'])
        or:   AggregationOperator.new({name}, {'f1': 3, 'f2': null}) -- syntax with "decimals after comma"

       If no "decimals" are given, 0 is assumed (the sum is an integer); null means floating-point.
       Aggregation's monitor working at source block performs pre-aggregation and only sends compacted +/- "inc" records. (TODO)

       WARNING: _make_records() up in a super class deduplicates records via BinaryMap, which removes duplicate keys
                produced from the same source object; this may influence aggregations (!)

       The object returned by scan() has the shape: {...key_fields, count, sum_f1, sum_f2, ..., avg_f1, avg_f2, ...}
     */

    // val_fields       // ['__count', f1, f2, ...]
                        // decimals passed in the field's type: type.options.decimal_precision ??

    // val_decimals        // {val_field: precision}; no. of decimal digits after comma that should be maintained for a given field
    //                     // when calculating the sum; can be positive (places after comma), zero, negative (zeros before comma),
    //                     // or null/undefined; if decimals[f] is null/undefined, the sum uses floating-point arithmetic on Number;
    //                     // otherwise, it uses integer arithmetic on Number, switching automatically to BigInt when
    //                     // the absolute value (shifted left/right by `decimals`) gets large;

    get _sum_fields() { return [...this.val_decimals?.keys() || []] }


    __new__() {
        //
    }

    _op_rmv(key, val) { return new OP('dec', key, val) }
    _op_ins(key, val) { return new OP('inc', key, val) }

    compactify(ops) {
        /* Merge & compactify, if possible, a batch of `ops` produced from a number of different source records. */
        return ops
    }

    generate_value(obj) {
        /* Extract from source `obj` a vector of components to be added to destination-sequence aggregations; the first
           element is always 1 for the overall __count. The vector is JSONx-stringified, with surrounding brackets stripped.
         */
        let values = this._sum_fields.map(field => {
            let v = obj[field]
            let t = typeof v
            return (t === 'number' || t === 'bigint') ? v : 0       // every non-numeric or missing value is replaced with zero
        })
        let vector = [1, ...values]
        return JSONx.stringify(vector).slice(1, -1)
    }
}
