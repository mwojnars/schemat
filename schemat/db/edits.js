
export class Edit {
    /* Specification of an edit operation that should be performed on an object inside the exclusive lock
       of its storage Block.
     */

    op          // name of the operation to be performed on object properties, e.g. 'insert', 'delete', 'move', 'field' (meaning 'update')
    args        // arguments for the operation, e.g. {field: 'name', value: 'new name'}
    category    // category of the object to be edited; must have a defaults._class_ property defined - that's where the `EDIT_op` function (static method) is looked for

    apply_to(data) {
        const name = `EDIT_${this.op}`
        const cls  = this.category.get_default('_class_')
        const method = cls?.[name]
        if (!method) throw new Error(`category does not support edit operation: ${name}`)
        return method.call(data, this.args)
    }

    // apply_to_object(object) {
    //     const name = `EDIT_${this.op}`
    //     const method = object.constructor[name]
    //     if (!method) throw new Error(`object does not support edit operation: ${name}`)
    //     return method.call(object, this.args)
    // }

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
