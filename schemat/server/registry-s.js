import { Mutex } from 'async-mutex'

import { assert, print, T } from '../utils.js'
import { ItemsMap } from '../data.js'
import { Item, RootCategory } from '../item.js'
import { Registry } from '../registry.js'


/**********************************************************************************************************************
 **
 **  Server-side REGISTRY
 **
 */

export class ServerRegistry extends Registry {

    sessionMutex = new Mutex()  // a mutex to lock Registry for only one concurrent session (https://github.com/DirtyHairy/async-mutex);
                                // new requests wait until the current session completes, see Session.start()

    // // staging area...
    // staging = []                // list of modified or newly created items that will be updated/inserted to DB
    //                             // on next commit(); the items will be commited to DB in the SAME order as in this list
    // staging_ids = new Map()     // dict of items with a non-empty ID that have already been added to `staging`,
    //                             // to avoid repeated insertion of the same item twice and to verify its identity (newborn items excluded)

    PATH_LOCAL_SUN = "/system/local"        // SUN folder that maps to local filesystem folder, PATH_LOCAL_WORKING;
    PATH_LOCAL_WORKING                      // scripts from PATH_LOCAL_* can be imported by system items during startup

    constructor(path) {
        super()
        this.PATH_LOCAL_WORKING = path      // no trailing '/' (!)
    }

    async startSession(session) {
        let release = await this.sessionMutex.acquire()
        assert(!this.session, 'trying to process a new web request when another one is still open')
        this.session = session
        return release
    }
    async stopSession(releaseMutex) {
        assert(this.session, 'trying to stop a web session when none was started')
        await this.cache.evict()
        delete this.session
        releaseMutex()
    }

    /***  DB modifications  ***/

    insert(item) { return this.db.insert(item) }
    update(item) { return this.db.update(item) }   /* Overwrite item's data in DB with the current item.data. Executed instantly without commit. */
    delete(item) { return this.db.drop(item.id)}

    // stage(item, edit) {
    //     /* Add an updated or newly created `item` to the staging area.
    //        For updates, stage() can be called before the first edit is created.
    //     */
    //     assert(item instanceof Item)
    //     if (item.newborn)                           // newborn items get scheduled for insertion; do NOT stage the same item twice!
    //         this.inserts.push(item)
    //     else {                                      // item already in DB? push an edit to a list of edits
    //         assert(edit)
    //         let edits = this.edits.get(item.id) || []
    //         edits.push(edit)
    //         if (edits.length === 1) this.edits.set(item.id, edits)
    //     }
    // }
    // async commit() {
    //     // insert new items; during this operation, each item's IID (item.iid) gets assigned
    //     let insert = this.db.insert(...this.inserts)                // a promise
    //     this.inserts = []
    //
    //     // edit/update/delete existing items
    //     let edits = Array.from(this.edits, ([id, edits]) => this.db.write(id, edits))       // array of promises
    //     this.edits.clear()
    //
    //     return Promise.all([insert, ...edits])          // all the operations are executed concurrently
    // }
}
