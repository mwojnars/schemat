import {BaseError, NotImplemented} from "../errors.js"

/**********************************************************************************************************************/

export class Database {
    /* Common interface for server-side and client-side database layers alike. */

    static Error = class extends BaseError {}

    async select(id)    { throw new NotImplemented() }
    async *scan(cid)    { throw new NotImplemented() }
}


