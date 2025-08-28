import {AgentRole} from "../common/globals.js";
import {print, assert, T, fluctuate, sleep} from "../common/utils.js";
import {JSONx} from "../common/jsonx.js";
import {CustomMap} from "../common/structs.js";
import {StoppingNow} from "../common/errors.js";


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

    schedule(delay = this.interval) {
        /* Schedule (reschedule) the next run() after `delay` seconds. */
        if (this.timeout) this._clear()
        if (!delay || delay < 0) delay = 1.0
        if (this.randomize) delay = fluctuate(delay, this.randomize)

        this.timeout = setTimeout(async () => {
            try { await this.run() }
            catch (ex) {
                schemat._print_error(`error executing recurrent task ${this.name || this.fn}:`, ex)
                this.schedule()
            }
        }, delay * 1000).unref()
    }

    async run() {
        /* Execute this.fn() and update the interval. */
        if (this.timeout) this._clear()
        let interval = await this.fn()
        this.interval = interval ?? this.interval
        this.schedule()
    }

    stop() {
        /* Stop the recurrent task. */
        if (this.timeout) this._clear()
    }

    _clear() { clearTimeout(this.timeout); this.timeout = null }
}

/**********************************************************************************************************************/

export class FramesMap extends CustomMap {
    /* A Map where keys are id+role strings. */

    _frames_by_id = new Map()    // internal map: id -> list of frames

    convert([id, role]) {
        role ??= AgentRole.GENERIC
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

    get_any_role(id) {
        /* Return any frame that has a given agent ID, no matter the role. */
        return this._frames_by_id.get(id)?.[0]
        // let frames = this._frames_by_id.get(id)
        // if (frames)
        //     if (unique && frames.length > 1) throw new Error(`multiple frames found for agent [${id}]`)
        //     else return frames[0]
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

    starting            // a Promise that gets resolved when .state is assigned after the agent's __start__() is finished; false after that
    paused              // after the agent was paused with $agent.pause(), `paused` contains a Promise that will be resolved by $agent.resume()
    locked              // set by lock() to inform incoming calls that the current call executes in exclusive lock, and they must wait until its completion
    stopping            // if true, the agent is stopping now and no more requests/calls should be accepted
    stopped             // if true, the agent is permanently stopped and should not be restarted even after node restart unless explicitly requested by its creator/supervisor [UNUSED]
    migrating_to        // node ID where this agent is migrating to right now; all new requests are forwarded to that node

    _background_priority// 'normal' or 'low'; if 'low', the background task is delayed until all ongoing/pending jobs are done
    _task_background    // Recurrent task for $agent.background() calls
    _task_restart       // Recurrent task for this.restart() calls

    get tag() { return `${this.agent}.${this.role}` }

    constructor(agent, role) {
        this.agent = agent
        this.role = role || AgentRole.GENERIC
        assert(this.role[0] === '$')

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
        let {agent, tag} = this
        schemat._print(`starting ${tag} ...`)

        assert(agent.is_loaded())
        if (agent.$frame) this.agent = agent = await agent.reload()
        agent.$frame = this

        let state = await agent.app_context(() => agent.__start__(this)) || {}
        this.set_state(state)

        // schedule recurrent execution of background job; the initial interval of 5 sec can be changed later by the agent
        this._task_background = new Recurrent(this.background.bind(this), {delay: 5.0, name: `${agent}.$frame.background()`})

        // schedule recurrent agent restarts after the agent's TTL expires
        this._task_restart = new Recurrent(this.restart.bind(this), {delay: agent.__ttl, name: `${agent}.$frame.restart()`})

        schemat._print(`starting ${tag} done`)
        return state
    }

    async restart() {
        /* Replace the agent with its newest copy after reload and call its __restart__(). */
        if (this.stopping || schemat.terminating) return
        let agent, prev = this.agent
        let {tag} = this

        try { agent = await this.agent.reload() }
        catch (ex) {
            schemat._print(`error reloading agent ${tag}:`, ex, `- restart skipped`)
            return
        }
        agent.$frame = this
        // if (agent === this.agent) return
        // assert(agent.id === this.agent.id)
        // assert(agent !== this.agent)

        let was_running = !this.paused
        await this.pause()                      // wait for termination of ongoing RPC calls
        if (this.stopping) return

        schemat._print(`restarting ${tag} ...`)
        try {
            let stop    = () => this._frame_context(prev,  () => prev.__stop__(this.state))
            let restart = () => this._frame_context(agent, () => agent.__restart__(stop))
            let state = await this._tracked(agent.app_context(restart))
            if (state !== undefined) this.set_state(state)
            this.agent = agent
        }
        catch (ex) {
            schemat._print(`error restarting ${tag}:`, ex, `- using previous instance`)
        }

        if (was_running) await this.resume()    // resume RPC calls unless the agent was already paused
        schemat._print(`restarting ${tag} done`)

        // return updated time interval to the next execution of restart()
        let ttl = agent.__ttl
        if (ttl <= 0) ttl = 1.0     // fast restart during boot to quickly arrive at a clean version of the object
        return ttl

        // TODO: check for changes in external props; if needed, invoke setup.* triggers to update the environment & installation
        //       and call explicitly __stop__ + triggers + __start__() instead of __restart__()
    }

    async stop() {
        /* Let running calls complete, then stop the agent by calling its __stop__(). */
        if (this.stopping) return
        this.stopping = true                // prevent new calls from being executed on the agent
        if (this.starting) await this.starting

        this._task_restart?.stop()          // clear all scheduled tasks
        this._task_background?.stop()

        let {calls, tag} = this
        if (calls.length > 0) {             // wait for pending calls to complete before stopping
            schemat._print(`waiting for ${calls.length} pending calls to agent ${tag} to complete`)
            await Promise.all(calls)
        }
        let {agent} = this
        schemat._print(`stopping ${tag} ...`)

        let stop = () => agent.__stop__(this.state)
        await agent.app_context(() => this._frame_context(agent, stop))
        schemat._print(`stopping ${tag} done`)
    }

    async background() {
        /* Execute agent's background job, <role>.background() or $agent.background(), and update the interval
           and priority for next execution.
         */
        if (this._background_priority === 'low')        // if low priority, wait until the agent is idle...
            while (this.calls.length > 0) {
                await Promise.all(this.calls)           // wait for termination of ongoing calls
                await sleep()                           // let pending calls jump in and execute
            }
        if (this.stopping) return

        let interval = await this.exec('background')
        interval ||= 60     // 60 sec by default if no specific interval was returned

        this._background_priority = (interval < 0) ? 'normal' : 'low'
        return Math.abs(interval)
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

    async exec(command, args = [], caller_ctx = schemat.current_context, tx = null, callback = null) {
        /* Call agent's `command` in tracked mode, in a proper app context (own or caller's) + schemat.tx context + agent.__frame context.
           Send to DB (but do not commit!) any data modifications that were created locally during command execution.
         */
        let {agent, tag} = this
        let [method] = this._find_command(command)      // check that `command` is recognized by the agent
        // schemat._print(`exec() of ${this.agent}.${method}(${args}) ...`)

        // wait for the agent to start
        if (this.starting) await this.starting

        while (true) {
            if ((this.locked || !agent.concurrent) && this.calls.length > 0)
                // print(`... ${agent}.${method}() waits for a previous call(s) to complete`)
                await Promise.all(this.calls)                   // wait for ongoing call(s) to complete if in exclusive mode
            else if (this.paused && command !== 'resume')
                await this.paused                               // wait if explicitly paused
            else break
        }
        if (this.stopping) throw new StoppingNow(`agent ${tag} is in the process of stopping`)

        agent = this.agent
        let [_, func] = this._find_command(command)     // agent may have been replaced while pausing, the existence of `command` must be verified again
        let callA = () => func.call(agent, ...args)

        let callB = async () => {
            // agent._print(`exec() of ${method}(${args}) context=${schemat.current_context}`)
            let error, result = await this._tracked(this._frame_context(agent, callA)).catch(ex => {
                if (!callback) throw ex
                let s_args = JSONx.stringify(args).slice(1,-1)
                agent._print_error(`${method}(${s_args}) failed with`, ex)      // ${ex.constructor.name}: ${ex.message}
                error = ex
            })
            if (!error && schemat.tx.is_nonempty()) await schemat.tx.save()
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
            method = `${AgentRole.GENERIC}.${command}`
            func = agent.__self[method]
        }
        if (typeof func !== 'function') throw new Error(`command "${command}" not recognized by agent ${agent}`)
        return [method, func]
    }

    _frame_context(agent, call) {
        // TODO: remove this method
        /* Run call() on `agent` in the context of this frame (agent.__frame/$frame/$state is set up). */
        assert(!this.locked, `starting a call when another one is executing in exclusive lock, internal management of this.locked is flawed :(`)
        assert(agent.$frame === this)
        return call()
        // agent.__frame ??= new AsyncLocalStorage()
        // return agent.$frame === this ? call() : agent.__frame.run(this, call)
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
        if (this.locked) throw new Error(`another call is already executing in exclusive lock`)

        this.locked = true                      // make incoming calls await in exec()
        while (this.calls.length > 1)           // wait for ongoing concurrent calls to terminate
            await Promise.all(this.calls)

        let unlock = () => {this.locked = false}
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

