/*
    Global variables accessible to all application code. Declared here for clarity and consistency.
 */


// global Schemat object on the server:
//
//   globalThis._schemat  -- AsyncLocalStorage holding a Schemat instance for the current async thread
//   globalThis.schemat   -- getter that gives easy access to the current content of `_schemat` async-store
//
// on clients, globalThis.schemat holds the actual Schemat object, while _schemat is not used at all
//


// global flags:
globalThis.SERVER = (typeof window === 'undefined')
globalThis.CLIENT = !globalThis.SERVER

// globalThis.isNodeJS =
//     typeof process !== 'undefined' &&               // `process` is a global object in Node.js but not in browsers
//     process.versions != null &&                     // process.versions contains Node.js-specific version information
//     process.versions.node != null                   // process.versions.node is the Node.js version string

globalThis.server_import = function(path) {
    /* Backend-only version of import(). On browser, returns undefined. */
    return SERVER ? import(path) : undefined
}

/**********************************************************************************************************************/

// database ID of the root category object (schemat.root_category, class RootCategory)
export const ROOT_ID = 1

// the suffix appended to the property name when a *plural* form of this property is requested
// (i.e., an array of ALL values of a repeated field, not the first value only)
export const PLURAL = '$'

// separator of subfields in a deep property path
export const SUBFIELD = '.'


/**********************************************************************************************************************/

export function is_plural(path) { return path.endsWith(PLURAL) }
export function truncate_plural(path) { return path.endsWith(PLURAL) ? path.slice(0, -PLURAL.length) : path }
