
export class Edit {}

export class TotalEdit extends Edit {
    /* Full item.data overwrite. */

    constructor(data) {
        super()
        this.data = data
    }
}
