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

    // get name() {
    //     console.log('Book.name():', this.title, this.is_loaded)
    //     if(this.is_loaded) return this.title
    // }

    static async GET__view() {
        let books = []
        for await (const book of schemat.scan_category(this, {loaded: true})) {
            await book.load()
            books.push(book)
            for (let author of book.author$) await author.load()
        }
        let path = import.meta.resolve('./books.ejs')
        return html_page(path, {books, title: "List of Books"})  //{async: true}
    }

    async GET__view() {
        for (let author of this.author$) await author.load()
        let path = import.meta.resolve('./book.ejs')
        return html_page(path, {book: this, authors: []})
    }
}
