import {html_page} from "../../../schemat/web/adapters.js"


function select_random(array, count) {
    /* Randomly select `count` elements from `array`. */
    return array.sort(() => Math.random() - 0.5).slice(0, count)
}


export async function homepage() {
    let authors = await schemat.global.AuthorCategory.list_objects({load: true})
    let books = await schemat.global.BookCategory.list_objects({load: true})

    let featured_authors = select_random(authors, 6)
    let featured_books = select_random(books, 6)

    for (let book of featured_books)
        for (let author of book.author$) await author.load()

    let path = import.meta.resolve('./home.ejs')
    return html_page(path, {featured_books, featured_authors})
}

