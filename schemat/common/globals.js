/*
    Global variables accessible to all application code. Declared here for clarity and consistency.
    The variables are initialized elsewhere with calls to `set_global()`, which is a preferred way
    over direct assignments to globalThis.
 */


// global flags ...
globalThis.SERVER = (typeof window === 'undefined')
globalThis.CLIENT = !globalThis.SERVER

// globalThis.isNodeJS =
//     typeof process !== 'undefined' &&               // `process` is a global object in Node.js but not in browsers
//     process.versions != null &&                     // process.versions contains Node.js-specific version information
//     process.versions.node != null                   // process.versions.node is the Node.js version string

