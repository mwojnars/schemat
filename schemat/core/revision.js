import {Item} from "./object.js";


export class Revision extends Item {

    target      // target web object
    data        // stringified __data of the target object

    restore() {
        /* Recreate the target object in the form represented by this revision. */
        let id  = this.target.id
        return Item.from_json(id, this.data, {mutable: false})
    }
}