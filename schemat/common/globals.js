/*
    Global variables & settings accessible to all application code. Declared here for clarity and consistency.
 */


Error.stackTraceLimit = Infinity    // don't truncate stack traces at 10 lines


// global Schemat object on the server:
//
//   globalThis.schemat   -- getter that gives easy access to the current content of `_schemat` async-store
//   globalThis._schemat  -- AsyncLocalStorage holding a Schemat instance for the current async thread
//   globalThis._contexts -- map of {app_id: schemat_instance}, for looking up a Schemat context based on Application it was created for
//
// on clients, globalThis.schemat holds the actual Schemat object, while _schemat is not used at all
//


// global flags...

globalThis.DEBUG = true         // may impede performance; turn to false in production

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

if (DEBUG)
    await server_import('longjohn')     // long stack traces across async boundaries


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
export function drop_plural(path) { return path.endsWith(PLURAL) ? path.slice(0, -1) : path }
export function check_plural(path) {
    let plural = path.endsWith(PLURAL)
    let base = plural ? path.slice(0, -1) : path    // property name without the $ suffix
    return [base, plural]
}
