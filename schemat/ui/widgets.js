import { T } from '../common/utils.js'
import { JSONx } from '../serialize.js'

import { e, cl, st, createRef, useState } from './react-utils.js'
import { A, B, I, P, PRE, DIV, SPAN, STYLE, INPUT, SELECT, OPTION, TEXTAREA, BUTTON, FLEX, FRAGMENT, HTML, NBSP } from './react-utils.js'

import {Component} from "./base.js"


/**********************************************************************************************************************/

export class TypeWidget extends Component {
    /* Base class for UI "view-edit" widgets that display and let users edit atomic (non-catalog) values
       of a particular data type.
     */
    static scope = 'Type'

    static defaultProps = {
        type:   undefined,      // Type of the `value` to be displayed
        value:  undefined,      // value object to be displayed by render()
        save:   undefined,      // callback save(newValue), called after `value` was edited by user
        flash:  undefined,      // callback flash(message, positive) for displaying confirmation messages after edits
        error:  undefined,      // callback error(message) for displaying error messages, typically related to validation after edit
        editing:    false,      // initial state.editing; is true, for instance, in CATALOG.NewKeyWidget
    }

    constructor(props) {
        super(props)
        this.initial = undefined        // in edit mode: initial value (encoded) that came through props, stored for change detection
        this.default = undefined        // in edit mode: default value the editor should start with; if this.initial is missing, type.default is used
        this.input   = createRef()
        this.state   = {...this.state,
            editing: props.editing,
        }
    }

    empty(v)    { return T.isMissing(v) && I('undefined') }     // view of an empty value, for display() and viewer()
    view(v)     { return this.encode(v) }                       // view of a non-empty value, for display() and viewer()
    display(v)  { return this.empty(v) || this.view(v) }        // convert a value to a UI element for display in viewer()
    encode(v)   { return JSONx.stringify(v) }                   // convert a value to its editable representation
    decode(v)   { return JSONx.parse(v) }                       // ...and back

    viewer()    { return DIV({onDoubleClick: e => this.open(e)}, this.display(this.props.value)) }
    editor()    { return INPUT({
                    defaultValue:   this.default,
                    ref:            this.input,
                    onKeyDown:      e => this.key(e),
                    onBlur:         e => this.reject(e),
                    autoFocus:      true,
                    type:           "text",
                    style:          {width: "100%"},
                    })
                }

    keyAccept(e)  { return e.key === "Enter"  }             // return true if the key pressed accepts the edits
    keyReject(e)  { return e.key === "Escape" }             // return true if the key pressed rejects the edits

    value() { return this.input.current.value }             // retrieve an edited flat value (encoded) from the editor

    open(e) { this.setState({editing: true})  }                 // activate the editor and editing mode
    close() { this.setState({editing: false}); this.props.error(null) }     // close the editor and editing mode
    read()  {                                                   // read the edited flat value, return this value and a "changed" flag
        let current = this.value()
        let changed = (current !== this.initial)
        return [current, changed]
    }

    // confirm()
    key(e) {
             if (this.keyAccept(e)) this.accept(e).then()
        else if (this.keyReject(e)) this.reject(e)
    }

    async accept(e) {
        // e.preventDefault()
        let [value, changed] = this.read()
        if (!changed) return this.close()
        try {
            let {type, flash, save} = this.props
            value = this.decode(value)
            value = type.validate(value)        // validate and normalize the decoded value; exception is raised on error
            flash("SAVING...")
            await save(value)                   // push the new decoded value to the parent
            flash("SAVED")
            this.close()
            return value
        }
        catch (ex) { this.props.error(ex.toString()) }
    }

    reject(e) {
        let [value, changed] = this.read()
        if (changed) this.props.flash("NOT SAVED", false)
        this.close()
    }

    render() {
        let {type, value} = this.props
        if (!this.state.editing) return this.viewer()
        this.initial = (value !== undefined) ? this.encode(value) : undefined
        this.default = (this.initial !== undefined) ? this.initial : type.getInitial()
        return this.editor()
    }
}
