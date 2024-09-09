/*
    When an import from Schemat is needed, it can be performed in several different ways:

    import {Item} from "../../../schemat/index.js"
    import {Item} from "@root/schemat/index.js"
    import {Item} from "schemat/index.js"

    The 2nd and 3rd variant (non-relative imports) are only allowed when `node` was started
    with `--loader esm-module-alias/loader` option.
*/


import {html_page} from "../../../schemat/web/adapters.js"
// import {html_page} from "schemat/web/adapters.js"


export class Book extends schemat.Item {

    static GET__view() {
        // return html_page(import.meta.resolve('book.ejs'), {book: {}, authors: {}})
        return 'Books List ...'
    }

    GET__view() {
        let path = import.meta.resolve('./book.ejs')
        return html_page(path, {book: this, authors: []})
    }
}
