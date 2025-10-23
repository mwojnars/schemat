import {bundle_dependencies} from "../../web/build.js"

export async function GET({res}) {
    let deps = await bundle_dependencies([
        `${schemat.PATH_PROJECT}/node_modules/svelte/src/index-client.js`
    ])
    schemat._print(`/$/bundle/svelte deps:\n`, deps.files)
    schemat._print(`/$/bundle/svelte code: ${deps.bundle.length} bytes`)
    res.type('js')
    res.send(deps.bundle)
}