import {html_page} from "../../../schemat/web/adapters.js"


export class Author extends schemat.Item {

    static async GET__view() {
        let authors = []
        for await (const author of schemat.scan_category(this)) {
            await author.load()
            authors.push(author)
        }
        let path = import.meta.resolve('./authors.ejs')
        return html_page(path, {authors})
    }
}
