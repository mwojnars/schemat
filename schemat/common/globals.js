/*
    Global variables accessible to all the Schemat's and application's code.
    Declared here for clarity and consistency.
    Initialized elsewhere with calls to `set_global()` - this is preferred over direct assignments to globalThis.
 */


export function set_global({schemat, registry, Item, importLocal} = {})
{
    /* This is a complete list of global variables defined by Schemat. */

    if (schemat)     globalThis.schemat = schemat
    if (registry)    globalThis.registry = registry
    if (Item)        globalThis.Item = Item
    if (importLocal) globalThis.importLocal = importLocal
}
