/*
    Utilities for creating async-local contexts using the async_hooks module.
 */


export async function thread_local_variable() {
    /* Creates an async-thread-local variable using AsyncLocalStorage. Returns the variable wrapped up in a Proxy,
       so that every read/write access to a method or property is redirected to the current value of the variable.
       Call run_with(value, callback) on the returned object to execute callback() with the variable's value
       set to `value` within the current async thread; the `value` is typically a Map or an object.
     */

    let async_hooks = await import('node:async_hooks')
    let local = new async_hooks.AsyncLocalStorage()

    let handler = {
        get(target, prop, receiver) {
            if (prop === 'run_with')
                return (store, callback) => local.run(store, callback)

            // if (prop === 'local') return local

            let store = local.getStore()
            return Reflect.get(store, prop, receiver)

            // let value = store[prop]
            // return typeof value === 'function' ? value.bind(store) : value
        },
        set(target, prop, value, receiver) {
            // if (['run_with', 'local'].includes(prop))
            if (prop === 'run_with')
                throw new Error(`${prop} is not writable`)

            let store = local.getStore()
            return Reflect.set(store, prop, value)

            // store[prop] = value
            // return true
        }
    }

    return new Proxy({}, handler)
}
