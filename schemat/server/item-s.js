import { print, assert, T } from '../utils.js'
import { Item, Category } from '../item.js'


class ServerItem extends Item {
    constructor(...args) {
        super(...args)
        print('ServerItem created')
    }
    inserver() { return true }
}

class ServerCategory extends Category {
}


export { 
    ServerItem as Item, 
    // ServerCategory as Category,
}
