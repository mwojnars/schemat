import {html_page} from "../../../schemat/web/adapters.js"


export class Author extends schemat.Item {

    static async GET__view() {
        let authors = await schemat.list_category(this, {load: true})
        let books = await schemat.list_category(5000, {load: true})
        let path = import.meta.resolve('./authors.ejs')
        return html_page(path, {authors, books})
    }
}
