/*
    When an import from Schemat is needed, it can be performed in several different ways:

    import {Item} from "../../../schemat/index.js"
    import {Item} from "@root/schemat/index.js"
    import {Item} from "schemat/index.js"

    The 2nd and 3rd variant (non-relative imports) are only allowed when `node` was started
    with `--loader esm-module-alias/loader` option.
*/


export class Book extends schemat.Item {

    static GET__view() {
        return 'Books List ...'
    }

    GET__view() {
        return `Details of book [${this.id}]...`
    }
}
