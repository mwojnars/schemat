/*
    The TypeItem class depends on Item, that's why it's placed in a separate file rather than type.js
    - to avoid circular dependencies when some other files (dependencies of item.js) want to import type.js.
 */

import { T, assert, print, splitLast } from '../common/utils.js'


/**********************************************************************************************************************/

// export class TypeItem extends Item {
//     /* LEGACY code !!! NOT USED !!! */
//     /* Data type implemented as an item that's kept in DB. May point back to a plain type class or have dynamic code. */
//
//     // async __init__() {
//     //     let [path, name] = this._split_classpath(this.class_path)
//     //     this.type_class = await schemat.import(path, name || 'default')
//     //     assert(T.isClass(this.type_class))
//     // }
//
//     async create_real_type(props) {
//         let [path, name] = this._split_classpath(this.class_path)
//         // this.type_class = (await import(path))[name || 'default']
//         this.type_class = await schemat.import(path, name || 'default')
//         assert(T.isClass(this.type_class))
//
//         let type = new this.type_class()
//         return Object.assign(type, props)
//     }
//
//     _split_classpath(path) { return splitLast(path || '', ':') }   // [path, name]
// }
