/*
    The TypeItem class depends on Item, that's why it's placed in a separate file rather than type.js
    - to avoid circular dependencies when some other files (dependencies of item.js) want to import type.js.
 */

import { T, assert, print, splitLast } from './utils.js'
import { Item } from './item.js'


/**********************************************************************************************************************/

export class TypeItem extends Item {
    /* Data type implemented as an item that's kept in DB. May point back to a plain type class or have dynamic code. */

    // async init() {
    //     let [path, name] = this._split_classpath(this.prop('class_path'))
    //     this.type_class = await this.registry.import(path, name || 'default')
    //     assert(T.isClass(this.type_class))
    // }

    async create_real_type(props) {
        let [path, name] = this._split_classpath(this.prop('class_path'))
        this.type_class = await this.registry.import(path, name || 'default')
        assert(T.isClass(this.type_class))

        let schema = new this.type_class()
        return Object.assign(schema, props)
    }

    _split_classpath(path) { return splitLast(path || '', ':') }   // [path, name]
}
