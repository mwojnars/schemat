import {WebObject} from "./object.js";


export class Revision extends WebObject {

    target      // target web object
    data        // stringified __data of the target object

    restore() {
        /* Recreate the target object in the form represented by this revision. */
        print(`Revision.restore(): rev [${this.id}] for target [${this.target}]`)
        let id  = this.target.id
        return WebObject.from_data(id, this.data, {mutable: false})
    }
}