/*
    Global variables accessible to all application code. Declared here for clarity and consistency.
    The variables are initialized elsewhere with calls to `set_global()`, which is a preferred way
    over direct assignments to globalThis.
 */


// global flags ...

globalThis.isNodeJS =
    typeof process !== 'undefined' &&               // `process` is a global object in Node.js but not in browsers
    process.versions != null &&                     // process.versions contains Node.js-specific version information
    process.versions.node != null                   // process.versions.node is the Node.js version string

globalThis.isBrowser = !globalThis.isNodeJS



// global objects ...

export function set_global({schemat, Item} = {})
{
    /* This is a complete list of Schemat's global objects. */

    if (schemat)     globalThis.schemat = schemat
    if (Item)        globalThis.Item = Item
    // if (importLocal) globalThis.importLocal = importLocal
}

