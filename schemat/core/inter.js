import {PLURAL, SUBFIELD, check_plural} from '../common/globals.js'
import {assert} from '../common/utils.js'
import {Struct} from '../common/catalog.js'


export class Intercept {
    /* Functions (traps) for a Proxy wrapper around all kinds of web objects: stubs, newborns, or loaded from DB.
       They make loaded properties accessible with `obj.prop` syntax, on top of plain JS attributes;
       perform caching of computed properties in target.__cache; ensure immutability of regular properties.
       Since a Proxy class can't be actually subclassed, all methods and properties of Intercept are static.
     */

    // UNDEFINED token marks that the value has already been fully computed, with inheritance and imputation,
    // and still remained undefined, so it should *not* be computed again
    static UNDEFINED    = Symbol.for('Intercept.UNDEFINED')
    static NO_CACHING   = Symbol.for('Intercept.NO_CACHING')   // marks a wrapper around a value (typically from a getter) that should not be cached

    // special properties of web object that are always stored/retrieved from __self (regular JS attibutes), not __data;
    // `then` is special because, when a promise resolves, .then is checked for another chained promise, so we disallow it as a persisted property
    static RESERVED = new Set([
        'then', 'id', '__provisional_id', '__meta', '__data', '__self', '__proxy', '__cache', '__status', '__ring', '__refresh',
        '$frame', '$state'
    ])


    static wrap(target) {
        /* Create a Proxy wrapper around `target` object. */
        return new Proxy(target, {get: this.proxy_get, set: this.proxy_set, deleteProperty: this.proxy_delete})
    }

    static proxy_get(target, prop, receiver, deep = true)
    {
        // use ordinary access if the property is a symbol or reserved
        if (Intercept._is_special(prop)) return Reflect.get(target, prop, receiver)

        // special handling for multi-segment paths (a.b.c...)
        if (deep && prop?.includes?.(SUBFIELD))
            return Intercept._get_deep(target, prop, receiver)

        let val, cache = target.__cache

        // try reading the value from `cache` first, return if found
        if ((val = cache?.get(prop)) !== undefined) return val === Intercept.UNDEFINED ? undefined : val

        // try reading the value from regular JS attributes of the `target`
        val = Reflect.get(target, prop, receiver)

        // cache the value IF it comes from a cachable getter (no point in re-assigning regular attrs)
        if (target.constructor.cachable_getters.has(prop)) {
            if (val?.[Intercept.NO_CACHING]) return val.value       // NO_CACHING flag? return immediately
            if (cache) Intercept._cache_value(cache, prop, val)
            return val
        }

        // return if the value was found in a regular JS attr (not a getter)
        if (val !== undefined) return val === Intercept.UNDEFINED ? undefined : val

        // handle role-based access to agent methods and state (e.g., $agent.f(), $leader.f(), etc.);
        // double $$, like in $$agent.f(), is treated as a broadcast call
        if (typeof prop === 'string' && prop[0] === '$' && ((prop.length > 1 && prop[1] !== '$') || (prop.length > 2 && prop[1] === '$')))
        {
            let broadcast = prop.startsWith('$$') || undefined
            if (broadcast) prop = prop.slice(1)
            let proxy = Intercept._agent_proxy(target, prop, broadcast)
            if (cache) Intercept._cache_value(cache, prop, proxy)
            return proxy
        }

        // return if the object is not loaded yet
        if (!target.__data) return undefined

        let [base, plural] = check_plural(prop)         // property name with $ suffix truncated

        // fetch ALL repeated values of `prop` from __data, ancestors, imputation, etc. (even if plural=false)...
        let values = target._compute_property(base)

        if (cache) {
            Intercept._cache_value(cache, base, values.length ? values[0] : Intercept.UNDEFINED)
            Intercept._cache_values(cache, base + PLURAL, values)
        }
        return plural ? values : values[0]
    }

    static _is_special(prop) {
        // `prop` can be a symbol like [Symbol.toPrimitive] instead of a string, or be a reserved property
        // that is always accessed as a regular JS attribute
        return typeof prop !== 'string' || Intercept.RESERVED.has(prop)
    }

    static _agent_proxy(target, role, broadcast) {
        /* Create an RPC proxy for this agent running in a particular role ($agent, $leader, etc.).
           The proxy creates triggers for intra-cluster RPC calls in two forms:
           1. obj.$ROLE.fun(...args) - sends a message that invokes obj['$ROLE.fun'](...args);
           2. obj.$ROLE(opts).fun(...args) - same but with additional options for rpc();
           3. obj.$ROLE.state is a special field that gives access to the locally running agent's state (if present).

           The object should be an instance of Agent class/category, because only agents are deployed
           permanently on specific nodes in the cluster, maintain local state and accept RPC calls.
        */
        let id = target.id
        assert(id, `trying to access a newborn object as agent`)

        // `current_opts`: opts from $ROLE(opts) remembered here (shared variable!) until $ROLE(opts).fun is accessed;
        // WARNING: never separate $ROLE(opts) from *.fun, as this may result in wrong `opts` being passed to `fun` (!)
        let current_opts

        // create a parameterized handler factory
        let create_handler = (use_opts) => ({
            get(target, name) {
                if (typeof name !== 'string' || name === '__getstate__') return
                // if (!role || role === AgentRole.GENERIC)    // "$agent" as a requested role matches all role names at the target
                //     role = AgentRole.ANY

                let frame = schemat.get_frame(id, role)

                // // obj.$ROLE.state is a special field that gives access to the locally running agent's state (if present)
                // if (name === 'state') return frame?.state
                assert(name !== 'state')

                let opts = use_opts ? {broadcast, ...current_opts, role} : {broadcast, role}
                current_opts = null

                // if the target object is deployed here on the current process, call it directly without RPC
                if (frame && !opts.broadcast) return (...args) => frame.exec(name, args)

                // function wrapper for an RPC call
                assert(schemat.node, `the node must be initialized before remote agent [${id}].${role}.${name}() is called`)
                return (...args) => schemat.node.rpc(id, name, args, opts)
            }
        })

        // create both proxies using the handler factory
        let parameterized_proxy = new Proxy({}, create_handler(true))

        // create a function that updates current_opts and returns the parameterized proxy
        let func = function(opts = {}) {
            current_opts = opts
            return parameterized_proxy
        }

        // make the function itself a proxy that handles the direct access
        return new Proxy(func, create_handler(false))
    }

    static _get_deep(target, path, receiver) {
        /* Get a *deep* property value from `target` object; `path` is a multi-segment path (a.b.c...),
           optionally terminated with $ (plural path). */
        let [base, plural] = check_plural(path)
        let [step, ...rest] = base.split(SUBFIELD)
        if (plural) {
            let roots = Intercept.proxy_get(target, step + PLURAL, receiver, false) || []
            return roots.flatMap(root => [...Struct.yieldAll(root, rest)])
        }
        let root = Intercept.proxy_get(target, step, receiver, false)
        return Struct.get(root, rest)
    }

    static _cache_value(cache, prop, val) {
        /* Save `value` in cache, but also provide special handling for promises, so that a promise is ultimately replaced with the fulfillment value,
           which may improve performance on subsequent accesses to the property (no need to await it again and again).
         */
        cache.set(prop, val instanceof Promise ? val.then(v => cache.set(prop, v)) : val)
    }
    static _cache_values(cache, prop$, vals) {
        /* Like _cache_value(), but for caching an array of repeated values, some of them possibly being promises. */
        cache.set(prop$, vals.some(v => v instanceof Promise) ? Promise.all(vals).then(vs => cache.set(prop$, vs)) : vals)
    }

    static proxy_set(target, path, value, receiver)
    {
        // special attributes and symbols like [Symbol.toPrimitive] are written directly to __self
        if (Intercept._is_special(path))
            return Reflect.set(target, path, value, receiver)

        // if (!target.__meta.mutable) target._print(`proxy_set(${path}) on/via immutable object ${target}`)

        let [base, plural] = check_plural(path)         // property name without the $ suffix
        let [prop] = base.split(SUBFIELD)               // first segment of a deep path

        // `_xyz` props are treated as "internal" and can be written to __self (if not *explicitly* declared in schema) OR to __data;
        // others, including `__xyz`, are "regular" and can only be written to __data, never to __self
        let regular = (path[0] !== '_' || path.startsWith('__'))
        let schema = receiver.__schema              // using `receiver` not `target` because __schema is a cached property and receiver is the proxy wrapper here
        let type = schema?.get(prop)                // can be GENERIC for a field that's NOT explicitly declared in schema

        // write value in __data only IF the `path` is in schema, or the schema is missing (or non-strict) AND the path name is regular
        if (schema?.has(prop) || (!schema?.options.strict && regular)) {
            // if (!target.is_newborn()) print('proxy_set updating:', path)
            let {alias, getter} = type.options

            if (alias) return receiver[path.replace(prop, alias)] = value
            // if (getter) throw new Error(`cannot modify a getter property (${prop})`)

            if (plural) {
                if (!(value instanceof Array)) throw new Error(`array expected when assigning to a plural property (${path})`)
                receiver._make_edit('set', base, ...value)
            }
            else receiver._make_edit('set', path, value)
            return true
        }
        else if (regular) throw new Error(`property not in object schema (${prop})`)

        // print('proxy_set() internal:', path, '/', mutable)
        if (!target.__meta.mutable) throw new Error(`trying to modify an immutable object ${target} (${path})`)
        return Reflect.set(target, path, value, receiver)
    }

    static proxy_delete(target, path) {
        if (Intercept._is_special(path)) return Reflect.deleteProperty(target, path)
        let [base] = check_plural(path)         // property name without the $ suffix
        target._make_edit('unset', base)
        return true
    }
}


