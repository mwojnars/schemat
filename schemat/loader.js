/*
    Custom module loader for Node.js. -- https://nodejs.org/api/esm.html#esm_https_loader

    Accepts URL paths that are mapped to objects (.js files, code snippets) in Schemat's global namespace.
    To use this loader, add --experimental-loader option to node, like in:

        $ node --experimental-loader ./loader.js ./server.js
*/

import {server} from './server.js'

console.log("imported server in loader.js:", server, server.registry)


/**********************************************************************************************************************
 **
 **  LOADER
 **
 */

const PATH_STD = '/local/std/'
const PATH_APP = '/local/app/'
const PREFIX   = 'schemat:'

export function resolve(specifier, context, defaultResolve) {
    const {parentURL} = context
    let ret

    if (specifier.startsWith(PATH_STD)) {
        let spec = specifier.slice(PATH_STD.length)
        ret = defaultResolve(spec, context, defaultResolve)
    }
    else if (specifier.startsWith('/'))
        ret = {url: PREFIX + specifier, format: 'module'}

    else ret = defaultResolve(specifier, context, defaultResolve)

    console.log(`resolve():  ${specifier}  -->  ${JSON.stringify(ret)}`)
    return ret
}

export async function load(url, context, defaultLoad) {

    if (url.startsWith(PREFIX)) {
        let source = await site.route(url)
    }

    return defaultLoad(url, context, defaultLoad)
}


// export function _resolve_(specifier, context, defaultResolve) {
//     const { parentURL = null } = context
//
//     // Normally Node.js would error on specifiers starting with 'https://', so
//     // this hook intercepts them and converts them into absolute URLs to be
//     // passed along to the later hooks below.
//     if (specifier.startsWith('https://'))
//         return {url: specifier}
//
//     else if (parentURL && parentURL.startsWith('https://'))
//         return {url: new URL(specifier, parentURL).href}
//
//     // Let Node.js handle all other specifiers.
//     return defaultResolve(specifier, context, defaultResolve)
// }
//
// export function _load_(url, context, defaultLoad) {
//     // for JavaScript to be loaded over the network, we need to fetch and return it
//     if (url.startsWith('https://'))
//         return new Promise((resolve, reject) => {
//             get(url, (res) => {
//                 let data = ''
//                 res.on('data', (chunk) => data += chunk)
//                 res.on('end', () => resolve({               // this example assumes all network-provided JavaScript is ES module code
//                     format: 'module',
//                     source: data,
//                 }))
//             }).on('error', (err) => reject(err))
//         })
//
//     // Let Node.js handle all other URLs.
//     return defaultLoad(url, context, defaultLoad)
// }
