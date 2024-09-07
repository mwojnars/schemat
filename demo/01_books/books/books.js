// import {Item} from "../../../schemat";


export class Book extends Item {

    static GET__view() {
        return 'Books List ...'
    }

    GET__view() {
        return `Details of book [${this.id}]...`
    }
}
