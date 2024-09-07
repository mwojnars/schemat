import {Item} from "schemat/index.js";
// import {Item} from "../../../schemat/index.js";


export class Book extends schemat.Item {

    static GET__view() {
        return 'Books List ...'
    }

    GET__view() {
        return `Details of book [${this.id}]...`
    }
}
