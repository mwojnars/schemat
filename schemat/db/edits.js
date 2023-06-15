/*
    All the classes defined here are included in the Registry's class path.
 */

export class Edit {
    process(data) {}
}

export class TotalEdit extends Edit {
    /* Full item.data overwrite. */

    constructor(data) {
        super()
        this.data = data
    }

    process(data) {
        return this.data
    }
}
