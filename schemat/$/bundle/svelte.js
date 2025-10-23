import {find_dependencies} from "../../web/build.js"

export async function GET({res}) {
    let deps = await find_dependencies(`${schemat.PATH_PROJECT}/node_modules/svelte/src/index-client.js`)
    res.type('js')
    res.send(deps.bundle)
}