import {WebObject} from "../core/object.js";


// Cluster extends System
// Site extends System

export class Cluster extends WebObject {

    async __init__()  {
        if (SERVER) await this.database?.load()
    }
}
