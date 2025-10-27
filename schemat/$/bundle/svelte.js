import {bundle_dependencies} from "#schemat/web/build.js"

export async function GET({res}) {
    // let deps = await bundle_dependencies([
    //     `${schemat.PATH_PROJECT}/node_modules/svelte/src/index-client.js`,
    //     `${schemat.PATH_PROJECT}/node_modules/svelte/src/internal/client/index.js`,
    //     `${schemat.PATH_PROJECT}/node_modules/svelte/src/internal/disclose-version.js`,
    //     `${schemat.PATH_PROJECT}/node_modules/svelte/src/internal/flags/legacy.js`,
    // ])
    let deps = await bundle_dependencies([
        `${schemat.PATH_PROJECT}/node_modules/svelte/src/index-client.js`,
        ...schemat.app._svelte_imports
    ])
    // schemat._print(`/$/bundle/svelte deps (${deps.files.length}):\n`, deps.files)
    // schemat._print(`/$/bundle/svelte code: ${deps.bundle.length} bytes`)
    res.type('js')
    res.send(deps.bundle)
}