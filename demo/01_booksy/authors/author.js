import {html_page} from "../../../schemat/web/adapters.js"


export class Author extends schemat.Item {

    static async GET__view() {
        let authors = [], books = []
        for await (const author of schemat.scan_category(this)) {
            await author.load()
            authors.push(author)
        }
        for await (const book of schemat.scan_category(5000)) {
            await book.load()
            books.push(book)
        }
        let path = import.meta.resolve('./authors.ejs')
        return html_page(path, {authors, books})
    }
}
