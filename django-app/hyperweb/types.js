
export class Schema {

    dump_json(value, format = {}) {
        /*
        JSON-encoding proceeds in two phases:
        1) reduction of the original `value` (with nested objects) to a smaller `flat` object using any external
           type information that's available; the flat object may still contain nested non-primitive objects;
        2) encoding of the `flat` object through json.dumps(); external type information is no longer used.
        */
        let {replacer, space} = json_format
        let state = this.encode(value)
        return JSON.stringify(state, replacer, space)
    }

    load_json(dump) {
        let state = JSON.parse(dump)
        return this.decode(state)
    }

    encode(value) {
        /*
        Convert `value` - a possibly composite object matching the current schema (self) -
        to a JSON-serializable "state" that does not contain non-standard nested objects anymore.
        By default, generic object encoding (JSON.encode()) is performed.
        Subclasses may override this method to perform more compact, schema-aware encoding.
        */
        return JSON.encode(value)
    }

    decode(state) {
        /* Convert a serializable "state" as returned by encode() back to an original custom object. */
        return JSON.decode(state)
    }
    
}

/**********************************************************************************************************************
 ** 
 **  ATOMIC schema types
 ** 
 */


class OBJECT extends Schema {
    /*
    Accepts object of any class, optionally restricted to objects whose type(obj) is equal to one of
    predefined type(s) - the `type` parameter - or the object is an instance of one of predefined base classes
    - the `base` parameter; at least one of these conditions must hold.
    If there is only one type in `type`, and an empty `base`, the type name is excluded
    from serializated output and is implied automatically during deserialization.
    Types can be given as import paths (strings), which will be automatically converted to a type object.
    */
    // type = null         // type(s) for exact type checks: type(obj)==T
    // base = null         // base type(s) for inheritance checks: obj instanceof T
    
    __init__(...bases) {
        this.bases = bases
    }
    // __getstate__() {
    //     state = this.__dict__.copy()
    //     if (len(this.type) == 1): state['type'] = this.type[0]
    //     if (len(this.base) == 1): state['base'] = this.base[0]
    //     return state
    // }
    // __setstate__(state) {
    //     /* Custom __setstate__/__getstate__() is needed to allow compact encoding of 1-element arrays in `type` and `base`. */
    //     this.type = this._prepare_types(state['type']) if 'type' in state else []
    //     this.base = this._prepare_types(state['base']) if 'base' in state else []
    // }
    _prepare_types(types) {
        types = types instanceof Array ? types : (types ? [types] : [])
        types = types.map(t => (typeof t === string) ? globalThis.registry.get_class(t) : t)
        // assert all(isinstance(t, type) for t in types)
        return types
    }
    _valid_type(obj) {
        if (!(this.type.length || this.base.length)) return true        // all objects are valid when no reference types configured
        let t = type(obj)
        if (this.type.includes(t)) return true
        return this.base.filter((base) => obj instanceof base).length > 0
    }
    _get_unique_type() {
        return this.type.length === 1 && !this.base ? this.type[0] : null
    }
    encode(obj) {
        if (!this._valid_type(obj))
            throw `invalid object type, expected one of ${this.type.concat(this.base)}, but got ${type(obj)}`
        return JSON.encode(obj, this._get_unique_type())
    }
    decode(state) {
        let obj = JSON.decode(state, this._get_unique_type())
        if (!this._valid_type(obj))
            throw `invalid object type after decoding, expected one of ${this.type.concat(this.base)}, but got ${type(obj)}`
        return obj
    }
}

// the most generic schema for encoding/decoding of objects of any types
let generic_schema = new OBJECT()


