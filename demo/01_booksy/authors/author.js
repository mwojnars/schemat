import {html_page} from "../../../schemat/web/adapters.js"


// BookCategory     -- loaded automatically as a global object from [site.global] property


export class Author extends schemat.Item {

    static async GET__view() {
        let authors = await this.list_objects({load: true})
        let books = await BookCategory.list_objects({load: true})
        let path = import.meta.resolve('./authors.ejs')
        return html_page(path, {authors, books})
    }
}
