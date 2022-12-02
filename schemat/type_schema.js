/*
    The SchemaPrototype class here depends on Item, that's why it's placed in a separate file rather than type.js
    - to avoid circular dependencies when some other files (dependencies of item.js) want to import type.js.
 */

import { T, assert, print, splitLast } from './utils.js'
import { Item } from './item.js'


/**********************************************************************************************************************/

export class SchemaPrototype extends Item {
    /* Schema implemented as an item that's stored in DB. May point back to a plain schema class or provide its own
       encode/decode through dynamic code.
     */
    async init() {
        let [path, name] = this._splitClasspath(this.prop('class_path'))
        this.schemaClass = await this.registry.import(path, name || 'default')
        assert(T.isClass(this.schemaClass))
    }
    createSchema(props) {
        let schema = new this.schemaClass()
        return Object.assign(schema, props)
    }

    _splitClasspath(path) { return splitLast(path || '', ':') }   // [path, name]
}
