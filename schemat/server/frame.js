import {AsyncLocalStorage} from 'node:async_hooks'
import {print, assert, T, fluctuate} from "../common/utils.js";
import {JSONx} from "../common/jsonx.js";
import {CustomMap} from "../common/structs.js";


/**********************************************************************************************************************/

export class Recurrent {
    /* A recurrent task executed at predefined intervals, with the ability to change the interval at any point. */

    constructor(fn, {name, delay = 1.0, randomize = 0.1} = {}) {
        this.interval = delay           // [seconds]
        this.randomize = randomize      // [0.0..1.0]
        this.fn = fn                    // function to be executed at the interval
        this.name = name                // name of the task
        this.timeout = null             // timer handle
        this.schedule()
    }

    schedule() {
        /* Schedule the next tick() at the interval. */
        if (this.timeout) clearTimeout(this.timeout)

        let delay = this.interval
        if (!delay || delay < 0) delay = 1.0
        if (this.randomize) delay = fluctuate(delay, this.randomize)

        this.timeout = setTimeout(async () => {
            try {
                await this.tick()
            }
            catch (ex) { schemat._print(`error executing recurrent task ${this.name || this.fn}:`, ex) }
            finally { this.schedule() }
        }, delay * 1000).unref()
    }

    async tick() {
        /* Execute this.fn() and update the interval. */
        this.timeout = null
        let interval = await this.fn()
        this.interval = interval ?? this.interval
    }

    stop() {
        /* Stop the recurrent task. */
        if (this.timeout) clearTimeout(this.timeout)
        this.timeout = null
    }
}

/**********************************************************************************************************************/

export class FramesMap extends CustomMap {
    /* A Map where keys are id+role strings. */

    _frames_by_id = new Map()    // internal map: id -> list of frames

    convert([id, role]) {
        role ??= schemat.GENERIC_ROLE
        return `${id}_${role}`          // 1234_$agent
    }

    reverse(key) {
        let [id, role] = key.split('_')
        return [Number(id), role]
    }

    set(key, frame) {
        /* Update _frames_by_id in addition to the base mapping by id+role. */
        let [id, role] = key
        let frames = this._frames_by_id.get(id) || []
        frames.push(frame)
        this._frames_by_id.set(id, frames)
        return super.set(key, frame)
    }

    delete(key) {
        /* Update _frames_by_id in addition to the base mapping by id+role. */
        let [id, role] = key
        let frames = this._frames_by_id.get(id)
        if (frames) {
            let frame = this.get(key)
            frames = frames.filter(f => f !== frame)
            if (frames.length) this._frames_by_id.set(id, frames)
            else this._frames_by_id.delete(id)
        }
        return super.delete(key)
    }

    get_any_role(id, unique = true) {
        /* Return any frame that has a given agent ID, no matter the role. */
        let frames = this._frames_by_id.get(id)
        if (frames)
            if (unique && frames.length > 1) throw new Error(`multiple frames found for agent [${id}]`)
            else return frames[0]
    }
}

/**********************************************************************************************************************/

export class Frame {
    /* State (internal variables) and status of a running agent. */
    agent_id
    agent               // web object that created this frame, replaced with a new reference on every refresh
    role                // name of the role this agent is running in
    state               // state object returned by agent.__start__()

    calls = []          // promises for currently executing (concurrent) calls on this agent
    exclusive           // if true in a given moment, any new call to this agent will wait until existing calls terminate; configured by lock() on per-call basis

    starting            // a Promise that gets resolved when .state is assigned after the agent's __start__() is finished; false after that
    paused              // after the agent was paused with $agent.pause(), `paused` contains a Promise that will be resolved by $agent.resume()
    stopping            // if true, the agent is stopping now and no more requests/calls should be accepted
    stopped             // if true, the agent is permanently stopped and should not be restarted even after node restart unless explicitly requested by its creator/supervisor [UNUSED]
    migrating_to        // node ID where this agent is migrating to right now; all new requests are forwarded to that node

    _task_restart       // Recurrent task for this.restart() calls
    _task_background    // Recurrent task for $agent.background() calls

    constructor(agent, role) {
        this.agent = agent
        this.role = role

        let _resolve
        this.starting = new Promise(resolve => {_resolve = resolve})
        this.starting.resolve = _resolve
    }

    set_state(state) {
        /* Remember the `state` (can be null/undefined) in this.state and mark the agent's starting phase has finished. */
        this.state = state
        this.starting?.resolve?.()
        this.starting = false
    }

    async start() {
        /* Start this.agent by calling its __start__(). */
        let {agent} = this
        schemat._print(`starting agent ${agent} ...`)

        let state = await agent.app_context(() => agent.__start__(this)) || {}
        this.set_state(state)

        // schedule recurrent agent restarts after the agent's TTL expires
        this._task_restart = new Recurrent(this.restart.bind(this), {delay: agent.__ttl})

        // schedule recurrent execution of background job; the initial interval of 5 sec can be changed later by the agent
        this._task_restart = new Recurrent(this.background.bind(this), {delay: 5.0})

        schemat._print(`starting agent ${agent} done`)
        return state
    }

    async restart() {
        /* Replace the agent with its newest copy after reload and call its __restart__(). */
        if (this.stopping || schemat.terminating) return
        let agent, prev = this.agent

        try { agent = await this.agent.reload() }
        catch (ex) {
            schemat._print(`error reloading agent ${this.agent}:`, ex, `- restart skipped`)
            return
        }
        // if (agent === this.agent) return
        // assert(agent.id === this.agent.id)
        // assert(agent !== this.agent)

        let was_running = !this.paused
        await this.pause()                      // wait for termination of ongoing RPC calls
        if (this.stopping) return

        schemat._print(`restarting agent ${agent} ...`)
        try {
            let stop    = () => this._frame_context(prev,  () => prev.__stop__(this.state))
            let restart = () => this._frame_context(agent, () => agent.__restart__(stop))
            let state = await this._tracked(agent.app_context(restart))
            if (state !== undefined) this.set_state(state)
            this.agent = agent
        }
        catch (ex) {
            schemat._print(`error restarting agent ${agent}:`, ex, `- using previous instance`)
        }

        if (was_running) await this.resume()    // resume RPC calls unless the agent was already paused
        schemat._print(`restarting agent ${agent} done`)

        // return updated time interval to the next execution of restart()
        let ttl = agent.__ttl
        if (ttl <= 0) ttl = 1.0     // fast restart during boot to quickly arrive at a clean version of the object
        return ttl

        // TODO: check for changes in external props; if needed, invoke setup.* triggers to update the environment & installation
        //       and call explicitly __stop__ + triggers + __start__() instead of __restart__()
    }

    async stop() {
        /* Let running calls complete, then stop the agent by calling its __stop__(). */
        this.stopping = true                // prevent new calls from being executed on the agent
        this._task_restart.stop()           // clear any scheduled restart of the agent

        let {calls} = this
        if (calls.length > 0) {             // wait for pending calls to complete before stopping
            schemat._print(`waiting for ${calls.length} pending calls to agent ${this.agent} to complete`)
            await Promise.all(calls)
        }
        let {agent} = this
        schemat._print(`stopping agent ${agent} ...`)

        let stop = () => agent.__stop__(this.state)
        await agent.app_context(() => this._frame_context(agent, stop))
        schemat._print(`stopping agent ${agent} done`)
    }

    async background() {
        /* Execute agent's background job, $agent.background(), and return updated interval for next execution. */

        let interval = await this.agent.$agent.background()
        interval ||= 60     // 60 sec by default if no specific interval was returned

        let high_priority = (interval < 0)
        interval = Math.abs(interval)
    }

    async pause() {
        /* Await currently running RPC calls and don't start any new calls until resume(). */
        let ongoing = Promise.all(this.calls)
        if (!this.paused) {
            let _resolve
            this.paused = new Promise(resolve => {_resolve = resolve})
            this.paused.resolve = async () => { await ongoing; _resolve() }
        }
        return ongoing
    }

    async resume() {
        /* Resume RPC calls after pause(). If called during the initial phase of pausing, it awaits
           for ongoing calls to return, so it never returns before the preceding pause().
         */
        if (!this.paused) return
        await this.paused.resolve()
        this.paused = false
    }

    async exec(command, args, caller_ctx = schemat.current_context, tx = null, callback = null) {
        /* Call agent's `command` in tracked mode, in a proper app context (own or caller's) + schemat.tx context + agent.__frame context.
         */
        let {agent} = this
        let [method] = this._find_command(command)      // check that `command` is recognized by the agent
        // schemat._print(`exec() of ${this.agent}.${method}(${args}) ...`)

        // wait for the agent to start
        if (this.starting) await this.starting

        // wait for running call(s) to complete if in exclusive mode
        while ((this.exclusive || !agent.concurrent_calls) && this.calls.length > 0)
            // print(`... ${agent}.${method}() waits for a previous call(s) to complete`)
            await Promise.all(this.calls)

        // handle paused/stopping state
        if (this.paused && command !== 'resume') await this.paused
        if (this.stopping) throw new StoppingNow(`agent ${agent} is in the process of stopping`)

        agent = this.agent
        let [_, func] = this._find_command(command)     // agent may have been replaced while pausing, the existence of `command` must be verified again
        let callA = () => func.call(agent, ...args)

        let callB = async () => {
            // agent._print(`exec() of ${method}(${args}) context=${schemat.current_context}`)
            let error, result = await this._tracked(this._frame_context(agent, callA)).catch(ex => {
                if (!callback) throw ex
                let s_args = JSONx.stringify(args).slice(1,-1)
                agent._print_error(`exec() of ${method}(${s_args}) FAILED with`, ex)
                // agent._print(`exec() of ${method}(${args}) FAILED, propagating to caller:`, ex)
                error = ex
            })
            return callback ? callback(result, error) : result
        }
        return agent.app_context(tx ? () => schemat.in_transaction(callB, tx, false) : callB, caller_ctx)
    }

    _find_command(command) {
        /* Find implementation of `command` in the agent and return as a pair [method-name, method-function]. */
        let {agent} = this
        let method = `${this.role}.${command}`
        let func = agent.__self[method]
        if (typeof func !== 'function') {
            // generic $agent.*() method is used as a fallback when there's no role-specific implementation of the `command`
            method = `${schemat.GENERIC_ROLE}.${command}`
            func = agent.__self[method]
        }
        if (typeof func !== 'function') throw new Error(`command "${command}" not recognized by agent ${agent}`)
        return [method, func]
    }

    _frame_context(agent, call) {
        /* Run call() on `agent` in the context of this frame (agent.__frame/$frame/$state is set up). */
        agent.__frame ??= new AsyncLocalStorage()
        return agent.$frame === this ? call() : agent.__frame.run(this, call)
    }

    async _tracked(promise) {
        /* Track the running call represented by `promise` by saving it in this.calls and removing upon its completion. */
        if (!(promise instanceof Promise)) return promise

        // create a wrapper promise that removes itself from `calls` when done
        let tracked = promise.finally(() => {
            this.calls = this.calls.filter(p => p !== tracked)
        })
        this.calls.push(tracked)
        return tracked
    }

    async lock(fn = null) {
        /* Run `fn` function inside a one-time exclusive lock (no other agent methods are executed concurrently with `fn`);
           or wait until all calls to this agent are completed, set exclusive mode on to prevent concurrent calls,
           and return `unlock` function to be used to exit the exclusive mode. Usage inside an agent object:

           1)  let result = this.$frame.lock(() => {...})
           or
           2)  let unlock = await this.$frame.lock()
               ...
               unlock()

           Note that lock() must NOT be preceded by any asynchronous instruction (await), nor be used in recursive RPC methods,
           as both these cases will cause a deadlock. Ideally, lock() should be the first instruction in the method body.
         */
        if (this.exclusive) throw new Error(`another call is already executing in exclusive lock`)

        this.exclusive = true
        while (this.calls.length > 0)
            await Promise.all(this.calls)

        let unlock = () => {this.exclusive = false}
        if (!fn) return unlock

        try { return await fn() }
        finally { unlock() }
    }

    // switch_context(callback)     -- execute callback() in originator's not agent's context; for use inside agent methods


    /*** Serialization ***/

    get_status() {      // will be needed for persisting the current list of node.$state.agents to DB
        return {
            id:             this.agent_id,
            role:           this.role,
            stopped:        this.stopped,
            migrating_to:   this.migrating_to,
        }
    }
}

