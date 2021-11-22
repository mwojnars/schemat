/*
Creating core items from scratch and storing them as initial items in DB.
 */

import {Registry} from '../registry.js'

/**********************************************************************************************************************
 **
 **  GLOBAL REGISTRY
 **
 */

async function bootstrap() {

    let registry = new ServerRegistry()
    await registry.init_classpath()
}

/**********************************************************************************************************************/

await bootstrap()

