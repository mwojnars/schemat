import {print, assert} from './utils.js'
import {Registry, Session} from './registry.js'
import {ClientDB} from "./db/db.js"
import {ClientProcess} from "./processes.js"


/**********************************************************************************************************************/

function read_data(node, type = "json") {
    /* Extract text contents of an element pointed to by a given selector.
       If `type` is given, or the element has `type` attribute, and the type is "json",
       the extracted string is JSON-decoded to an object.
     */
    if (typeof node === "string")
        node = document.querySelector(node)

    let value = node.textContent
    if (!type) type = node.getAttribute('type')

    // decode `value` depending on the `type`
    if (type === "json") return JSON.parse(value)
    if (type === "json+base64") return JSON.parse(decodeURIComponent(atob(value)))

    return value
}

/**********************************************************************************************************************
 **
 **  STARTUP
 **
 */

// import {check} from "/site/widgets.js"

export async function boot(view) {

    let data     = read_data('#data-session', 'json+base64')
    let db       = new ClientDB(data.items)
    let schemat  = await new ClientProcess(db).init()
    // await schemat.init()
    // let registry = await ClientRegistry.createGlobal(schemat)
    await schemat.registry.bootData(data)

    // print('root:', await registry.getItem([0,0], {load: true}))
    // print('[0,10]:', await registry.getItem([0,10], {load: true}))
    // print('[10,1]:', await registry.getItem([10,1], {load: true}))

    let root = document.querySelector("#react-root")
    let item = schemat.registry.session.item
    assert(item.isLoaded)
    // print('main item:', item)

    item.render(view, root)
    // check()
}
