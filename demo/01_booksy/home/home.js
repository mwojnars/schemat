import {html_page} from "../../../schemat/web/adapters.js"


export async function view() {
    let authors = await AuthorCategory.list_objects({load: true})
    let books = await BookCategory.list_objects({load: true})
    for (let book of books)
        for (let author of book.author$) await author.load()

    let path = import.meta.resolve('./home.ejs')
    return html_page(path, {book: this, authors: []})
}
