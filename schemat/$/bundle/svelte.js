import {find_dependencies} from "../../_draft/bundler.js"
// const {find_dependencies} = SERVER && await import("../_draft/bundler.js") || {}

export async function GET({res}) {
    let deps = await find_dependencies(`${schemat.PATH_PROJECT}/node_modules/svelte/src/index-client.js`)
    res.type('js')
    res.send(deps.bundle)
}