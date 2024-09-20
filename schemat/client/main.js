import "../common/globals.js"           // global flags: CLIENT, SERVER

import {assert, print} from "../common/utils.js";
import {ClientDB} from "./client_db.js";
import {Schemat} from "../core/schemat.js";
import {SeedData} from "../web/request.js"


/**********************************************************************************************************************/

export class ClientSchemat extends Schemat {
    /* Client-side global Schemat object. */


    /***  startup  ***/

    static async start_client() {
        /* In-browser startup of Schemat rendering. Initial data is read from the page's HTML element #page-data. */

        let data = SeedData.from_element('#page-data')
        print('seed data:', data)

        let db = new ClientDB(data.items)
        await new ClientSchemat().boot(data.site_id, db)

        let target = await schemat._preload_objects(data)
        target.assert_loaded()

        let page = target.__services[data.endpoint]
        return page.render_client(target)
        // check()
    }

    // static _read_data(node, format = "json") {
    //     /* Extract text contents of an element pointed to by a given selector.
    //        If `format` is given, or the element has `format` attribute, and the format is "json",
    //        the extracted string is JSON-decoded to an object.
    //      */
    //     if (typeof node === "string")
    //         node = document.querySelector(node)
    //
    //     let value = node.textContent
    //     if (!format) format = node.getAttribute('format')
    //
    //     // decode `value` depending on the `format`
    //     if (format === "json") return JSON.parse(value)
    //     if (format === "json+base64") return JSON.parse(decodeURIComponent(atob(value)))
    //
    //     return value
    // }

    async _preload_objects(data) {
        /* Load response data from state-encoded `data.session` as produced by Request.dump(). */

        for (let rec of data.items)
            await this.get_loaded(rec.id)               // preload all boot items from copies passed in constructor()

        return this.get_object(data.target_id)
    }


    /***  DB  ***/

    async insert(item) {
        let data = item.__data.__getstate__()
        delete data['__category']

        let category = item.__category
        assert(category, 'cannot insert an item without a category')    // TODO: allow creation of no-category items

        let record = await category.create_item(data)
        if (record) {
            schemat.db.cache(record)                         // record == {id: id, data: data-encoded}
            return this.get_object(record.id)
        }
        throw new Error(`cannot create item ${item}`)
    }
}

// import {check} from "/site/widgets.js"
