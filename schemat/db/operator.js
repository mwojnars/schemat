import {is_plural, drop_plural} from "../common/globals.js";
import {assert, print, T} from "../common/utils.js";
import {BinaryInput, BinaryMap, BinaryOutput, compare_bin} from "../common/binary.js"
import {WebObject} from "../core/object.js";
import {OP} from "./block.js";
import {JSONx} from "../common/jsonx.js";
import {INTEGER} from "../types/type.js";


/**********************************************************************************************************************/

export class Operator extends WebObject {
    /* Specification of a data processing operator: derivation methods + schema of output objects/records.
       The same operator can be applied to multiple rings, producing different sequences in each ring.
     */

    key         // array of field names that comprise the key part of record; plural form (xxx$) allowed for the first field; deep paths (x.y.z) allowed
    payload     // names of fields that comprise the payload (value) part of record
    fields      // {field: type} schema of all fields in `key`, and possibly some in `payload` (esp. for aggregations);
                // types are mainly needed for .binary_encode/decode(), so some of their options can be removed compared to WebObject's schema
    file_tag

    get key_types() { return this.key.map(f => this.fields[drop_plural(f)]) }

    encode_key(key) {
        /* Convert an array, `key`, of field values to a binary key (Uint8Array). The array can be shorter than this.key
           ("partial key") - this may happen when the key is used for a partial match as a lower/upper bound in scan().
         */
        let types  = this.key_types
        let output = new BinaryOutput()
        let length = Math.min(types.length, key.length)

        assert(key.length <= types.length, `key length ${key.length} > field types length ${types.length}`)

        for (let i = 0; i < length; i++) {
            let last = (i === types.length - 1)
            types[i].write_binary(output, key[i], last)
        }
        return output.result()
    }

    decode_key(key_binary) {
        /* Decode a `key_binary` (Uint8Array) back into an array of field values. Partial keys are NOT supported here. */
        let types  = this.key_types
        let input  = new BinaryInput(key_binary)
        let length = types.length
        let key = []

        for (let i = 0; i < length; i++) {
            let last = (i === length - 1)
            let val = types[i].read_binary(input, last)
            key.push(val)
        }
        assert(input.pos === key_binary.length)
        return key
    }

    decode_object(key, val) {
        return {...this._decode_key_object(key), ...this._decode_value(val)}
    }

    _decode_key_object(key_binary) {
        let fields = this.key
        let key = this.decode_key(key_binary)
        let obj = {}
        for (let i = 0; i < fields.length; i++) {
            let field = drop_plural(fields[i])
            obj[field] = key[i]
        }
        return obj
    }

    _decode_value(json) {
        if (!json) return {}
        let vector = JSONx.parse(`[${json}]`)
        return Object.fromEntries(this.payload.map((field, i) => [field, vector[i]]))
    }
}

/**********************************************************************************************************************/

export class DataOperator extends Operator {
    /* Operator that represents schema of the main data sequence, no derivation methods. */

    async __draft__() {
        this.key = ['id']
        this.fields = {'id': new INTEGER()}
    }

    encode_id(id) {
        assert(id !== undefined)
        return this.encode_key([id])
    }

    decode_id(key) {
        return this.decode_key(key)[0]
    }
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

       If .field_xxx(obj) method is present in this operator's subclass, it is used to generate values of `xxx` field
       (this requires that a custom [operator].__class is configured); otherwise, the field is extracted directly
       from object when generating a record (value=obj.field).
     */
    static IMPLICIT_OVERRIDE = false    // pruning optimization used in _prune_plan() for indexes

    category        // category of objects allowed in this index (optional), also used for field type inference if names only are provided

    __new__() {
        if (this.category) this.category = schemat.as_object(this.category)     // convert ID to object
        // this.fields ??= this._infer_field_types(this.key)
        // this._print(`DerivedOperator.__new__(): key=${this.key} fields=${this.fields}`)
    }

    async __setup__() {
        await this.category?.load()
        this.fields ??= this._infer_field_types(this.key)
    }

    _infer_field_types(fields) {
        /* Create a Map of {field: type} from an array of field names, `fields`, combined with types from category.schema. */
        let schema = this.category?.schema || schemat.root_category['defaults.schema']
        // print('schema:', schema)

        let entries = []
        for (let field of fields) {     // find out the type of every field to build a catalog of {field: type} pairs
            field = drop_plural(field)
            let type = schema.get(field)
            if (!type) throw new Error(`unknown object property '${field}' (not in schema)`)

            type = type.clone()
            type.remove_option('info', 'getter')    // some options are irrelevant for record's schema

            entries.push([field, type])
        }
        return Object.fromEntries(entries)
        // return new Map(entries)
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

        // this._print(`rmv_records:`, rmv_records)
        // this._print(`ins_records:`, ins_records)

        this._prune_plan(rmv_records, ins_records)
        let ops = []

        for (let [key, val] of rmv_records || [])
            ops.push(this._op_rmv(key, val))
        for (let [key, val] of ins_records || [])
            ops.push(this._op_ins(key, val))

        return ops
    }

    _prune_plan(rmv_records, ins_records, implicit_override = this.constructor.IMPLICIT_OVERRIDE) {
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

                // when comparing arrays (AggregationOperator), convert them to JSON
                if (typeof v_rmv === 'object' && typeof v_ins === 'object') {
                    v_rmv = JSONx.stringify(v_rmv)
                    v_ins = JSONx.stringify(v_ins)
                }

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
        let cid = this.category?.id
        return !cid || obj.__cid === cid
        // return !this.category || obj.__cid$?.includes(this.category.id)
    }

    *generate_keys(obj) {
        /* Generate a stream of keys, each being an array of key-field values (not encoded). */

        // array of arrays of encoded field values to be used in the key(s); only the first field can have multiple values
        let field_values = []

        for (let field of this.key) {
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
    static IMPLICIT_OVERRIDE = true     // when feeding to an index (del/put ops), it is safe to drop "del" when followed by "put"

    _op_rmv(key, val) { return new OP('del', key) }         // alternative: "put" with <tombstone> (?)
    _op_ins(key, val) { return new OP('put', key, val) }

    generate_value(obj) {
        /* Extract a vector of payload values from source object, `obj`, and stringify it via JSONx, surrounding brackets stripped.
           Undefined values are replaced with null. If no payload fields are declared, empty string is returned.
           The returned string is used as a "value" part of the record for the destination sequence.

           TODO: use CBOR encoding (https://github.com/kriszyp/cbor-x)
           import cbor from 'cbor-x'
           let buf = cbor.encode(obj)
           let obj = cbor.decode(buf)
         */
        let {payload} = this
        if (!payload?.length) return ''
        let vector = payload.map(f => {let v = obj[f]; return v === undefined ? null : v})
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
       - the key does not contain a backreference to the source object, because typically we want to sum over multiple objects;
       - all value fields must be numeric, such that incrementation (sum += x) makes sense; if a value is missing
         or non-numeric, zero is assumed, which doesn't change the sum, but impacts the average;
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

    sum            // names of source object's fields to be aggregated (counted and summed up) in addition to global count; [] by default

    // payload       // ['__count', f1, f2, ...]
                     // decimals passed in the field's type: type.options.decimal_precision ??

    // val_decimals        // {val_field: precision}; no. of decimal digits after comma that should be maintained for a given field
    //                     // when calculating the sum; can be positive (places after comma), zero, negative (zeros before comma),
    //                     // or null/undefined; if decimals[f] is null/undefined, the sum uses floating-point arithmetic on Number;
    //                     // otherwise, it uses integer arithmetic on Number, switching automatically to BigInt when
    //                     // the absolute value (shifted left/right by `decimals`) gets large;

    __new__() {
        super.__new__()

        this._print(`AggregationOperator.__new__() sum=${this.sum}`)
        if (typeof this.sum === 'string') this.sum = [this.sum]

        let sums = this.sum.map(f => `__sum_${f}`)
        this.payload = ['__count', ...sums]
        this._print(`AggregationOperator.__new__() payload=${this.payload}`)

        // types of sum_X fields ???
        // this.fields['__count'] = new BIGINT()
    }

    // below, `val` is a JSONx string from generate_value() containing an array of increments to be added to accumulators
    _op_rmv(key, val) { return new OP('dec', key, val) }    //this._print(`OP(dec, ${key}, ${val})`)
    _op_ins(key, val) { return new OP('inc', key, val) }    //this._print(`OP(inc, ${key}, ${val})`)

    compactify(ops) {
        /* Merge & compactify, if possible, a batch of `ops` produced from a number of different source records. */
        return ops
    }

    generate_value(obj) {
        /* Extract from source `obj` a vector of increments to be added to destination-sequence accumulators.
           The first element is always 1 for __count.
         */
        let values = this.sum.map(field => {
            let v = obj[field]
            let t = typeof v
            return (t === 'number' || t === 'bigint') ? v : 0       // every non-numeric or missing value is replaced with zero
        })
        return [1, ...values]
        // let vector = [1, ...values]
        // return JSONx.stringify(vector).slice(1, -1)
    }
}
