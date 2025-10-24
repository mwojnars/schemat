import {html_page} from "#root/schemat/web/adapters.js"


export class Author extends schemat.WebObject {

    static async 'GET.view'() {
        // BookCategory below is a global object: declared in [app.global] in DB and loaded automatically during app initialization
        let authors = await this.list_objects({load: true})
        let books = await schemat.global.BookCategory.list_objects({load: true})
        let path = import.meta.resolve('./authors.ejs')
        return html_page(path, {authors, books})
    }
}
