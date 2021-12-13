import { print, assert, T } from '../utils.js'
import { Item, Category } from '../item.js'


class ClientItem extends Item {
    constructor(...args) {
        super(...args)
        print('ClientItem created')
    }
}

class ClientCategory extends Category {
}


export {
    ClientItem as Item,
    // ClientCategory as Category,
}
