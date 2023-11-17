/*
    Global variables accessible to all application code. Declared here for clarity and consistency.
    The variables are initialized elsewhere with calls to `set_global()`, which is a preferred way
    over direct assignments to globalThis.
 */


export function set_global({schemat, registry, request, session, Item, importLocal} = {})
{
    /* This is a complete list of global variables defined by Schemat. */

    if (schemat)     globalThis.schemat = schemat
    if (registry)    globalThis.registry = registry
    if (request)     globalThis.request = request
    if (session)     globalThis.session = session
    if (Item)        globalThis.Item = Item
    if (importLocal) globalThis.importLocal = importLocal
}

