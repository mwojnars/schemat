/*
    Global variables accessible to all application code. Declared here for clarity and consistency.
    The variables are initialized elsewhere with calls to `set_global()`, which is a preferred way
    over direct assignments to globalThis.
 */


export function set_global({schemat, Item} = {})
{
    /* This is a complete list of global variables defined by Schemat. */

    if (schemat)     globalThis.schemat = schemat
    if (Item)        globalThis.Item = Item
    // if (importLocal) globalThis.importLocal = importLocal
}

