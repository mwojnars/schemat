/*
    Utilities for creating async-local contexts using the async_hooks module.
 */

import {AsyncLocalStorage} from "async_hooks"


/**********************************************************************************************************************/

export function thread_local_variable() {
    /* Create an async-thread local variable, X, using AsyncLocalStorage.
       Call X.run_with(value, callback) on the returned object to execute callback() with the value of X
       set to `value` within the current async-thread. The value is typically a Map or an object.
     */

    const local = new AsyncLocalStorage()

    const handler = {
        get(target, prop, receiver) {
            if (prop === 'run_with')
                return (context, callback) => local.run(context, callback)

            // if (prop === 'local') return local

            const store = local.getStore()
            const value = store[prop]
            return typeof value === 'function' ? value.bind(store) : value
        },
        set(target, prop, value, receiver) {
            // if (['run_with', 'local'].includes(prop))
            if (prop === 'run_with')
                throw new Error(`${prop} is not writable`)

            const store = local.getStore()
            store[prop] = value
            return true
        }
    }

    return new Proxy({}, handler)
}
