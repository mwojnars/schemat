/*
    When an import from Schemat is needed, it can be performed in several different ways:

    import {WebObject} from "../../../schemat/index.js"
    import {WebObject} from "#schemat/index.js"
    import {WebObject} from "schemat/index.js"

    The 2nd and 3rd variant (non-relative imports) are only allowed when `node` was started
    with `--loader esm-module-alias/loader` option.
*/


import {html_page} from "#schemat/web/adapters.js"


export class Book extends schemat.WebObject {

    // get name() {
    //     console.log('Book.name():', this.title, this.is_loaded)
    //     if(this.is_loaded) return this.title
    // }

    static async 'GET.view'() {
        /* Category-level HTML page with a listing of all books. */
        let books = await this.list_objects({load: true})

        for (let book of books)
            for (let author of book.author$) await author.load()

        let path = import.meta.resolve('./books.ejs')
        return html_page(path, {books, title: "List of Books"})  //{async: true}
    }

    async 'GET.view'() {
        /* Object-level HTML page that displays profile of a specific book represented by `this`. */
        for (let author of this.author$) await author.load()
        let path = import.meta.resolve('./book.ejs')
        return html_page(path, {book: this, authors: []})
    }
}
