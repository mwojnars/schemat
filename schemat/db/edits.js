
export class Edit {
    process(data) {}
}

export class EditData extends Edit {
    /* Full item.data overwrite. */

    constructor(data) {
        super()
        this.data = data
    }

    process(data) {
        return this.data
    }
}
