/*
Physical DB implementation. (Draft)
 */

import { Mutex } from 'async-mutex'


class Segment {
    /* Continuous range of physical data on persistent storage.
       Implements concurrent reads (selects) and exclusive writes (updates).
     */

    cache = null                // LRU cache of most recently accessed (read/wrote) items
    tasks = new Map()           // tasks.get(id) is an array of pending tasks (Promises) for exclusive execution

    select(id, client) {
        let cell = this.cache.get(id)
        if (cell) return cell

        // if (this.tasks.has(id)) {
        //     let pending = ...    // an exclusive oper is already running and will save in cache the most recent value of this cell when done
        //     return pending
        // }
        // else this.runExclusive(id, () => this.read(id), (cell, error) => this.notify(client, cell, error))
    }
    update(id, edits, client) {
        this.runExclusive(id,
            ()            => this.edit(id, edits),
            (cell, error) => this.notify(client, cell, error)
        )
    }

    async read(id) { return null }
    async edit(id, edits) {}
    async notify(client, cell, error) {}

    runExclusive(id, oper, callback = null) {
        /* For asynchronous tasks: `oper` is scheduled for execution and the result will be sent to `callback`,
           but this function returns immediately.
         */
        let task = () => this._run(id, oper, callback)
        let tasks = this.tasks.get(id)
        if (tasks === undefined) {
            this.tasks.set(id, [])
            task()
        }
        else tasks.push(task)
            // TODO: check if the queue is already too long, return immediately with failure if so
    }

    async _run(id, oper, callback) {
        // do async work on data cell...
        let [cell, error] = await oper()
        let tasks = this.tasks.get(id)

        // schedule the next pending task for execution
        if (tasks && tasks.length)
            setTimeout(tasks.shift())
        else if (tasks.length === 0)
            this.tasks.remove(id)

        // save the computed value in cache
        if (!error) this.cache.set(id, cell)

        // run callback with the result of the execution
        if (callback) callback(cell, error)
    }

}