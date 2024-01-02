import {assert, T} from '../common/utils.js'
import { JSONx } from '../serialize.js'

import { e, cl, st, createRef, useState } from './react-utils.js'
import { A, B, I, P, PRE, DIV, SPAN, STYLE, INPUT, SELECT, OPTION, TEXTAREA, BUTTON, FLEX, FRAGMENT, HTML, NBSP } from './react-utils.js'

import {Component} from "./component.js"


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

/**********************************************************************************************************************/

export class TextualWidget extends TypeWidget {
    empty(value)    { return !value && NBSP }  //SPAN(cl('key-missing'), "(missing)") }
    encode(v)       { return v }
    decode(v)       { return v }
}

/**********************************************************************************************************************/

export class TEXT_Widget extends TextualWidget {

    static scope = 'TEXT'
    static style = () => this.safeCSS()
    `
        .editor {
            min-height: 2em;
            height: 10em;
            width: 100%;
            outline: none;
            resize: vertical;
        }
    `
    //     .use-scroll {
    //         overflow: auto;   /*scroll*/
    //         max-height: 12rem;
    //         border-bottom: 1px solid rgba(0,0,0,0.1);
    //         border-right:  1px solid rgba(0,0,0,0.1);
    //         resize: vertical;
    //     }
    //     .use-scroll[style*="height"] {
    //         max-height: unset;              /* this allows manual resizing (resize:vertical) to exceed predefined max-height */
    //     }

    viewer() { return DIV({onDoubleClick: e => this.open(e)}, this.display(this.props.value)) }
    editor() {
        return TEXTAREA({
            className:      'editor',
            defaultValue:   this.default,
            ref:            this.input,
            onKeyDown:      e => this.key(e),
            autoFocus:      true,
            rows:           1,
            // onBlur:         e => this.reject(e),
            // wrap:           'off',
        })
    }
    keyAccept(e) { return e.key === "Enter" && e.ctrlKey }       //e.shiftKey
}

/**********************************************************************************************************************/

export class CODE_Widget extends TEXT_Widget {
    /*
    ACE (code editor):
    - keyboard shortcuts: https://github.com/ajaxorg/ace/wiki/Default-Keyboard-Shortcuts
    - existing highlighters: https://github.com/ajaxorg/ace/tree/master/lib/ace/mode
    - default commands and shortcuts: https://github.com/ajaxorg/ace/tree/master/lib/ace/commands (-> editor.commands.addCommand() ..removeCommand())
    - pre-built ACE files: https://github.com/ajaxorg/ace-builds
    - React-ACE component: https://www.npmjs.com/package/react-ace

    Methods/props:
      editor.renderer.setAnnotations()
      editor.resize()
      editor.renderer.updateFull()
      position:relative
      editor.clearSelection(1)
      editor.gotoLine(1)
      editor.getSession().setScrollTop(1)
      editor.blur()
      editor.focus()
    */

    static assets =                                             // import ACE Editor
    `
    <script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/ace.min.js" integrity="sha512-jB1NOQkR0yLnWmEZQTUW4REqirbskxoYNltZE+8KzXqs9gHG5mrxLR5w3TwUn6AylXkhZZWTPP894xcX/X8Kbg==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/mode-jsx.min.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
    <!--<script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/mode-javascript.min.js" integrity="sha512-37ta5K4KVYs+MEmIg2xnZxJrdiQmBSKt+JInvyPrq9uz7aF67lMJT/t91EYoYj520jEcGlih41kCce7BRTmE3Q==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>-->
    <!--<script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/worker-base.min.js" integrity="sha512-+nNPckbKGLDhLhi4Gz1Y1Wj5Y+x6l7Qw0EEa7izCznLGTl6CrYBbMUVoIm3OfKW8u82JP0Ow7phPPHdk26Fo5Q==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>-->
    <!--<script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/worker-javascript.min.js" integrity="sha512-hwPBZJdHUlQzk8FedQ6S0eqJw/26H3hQ1vjpdAVJLaZU/AJSkhU29Js3/J+INYpxEUbgD3gubC7jBBr+WDqS2w==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>-->
    <!--<script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/theme-textmate.min.js" integrity="sha512-VE1d8sDypa2IvfFGVnil5k/xdGWtLTlHk/uM0ojHH8b2RRF75UeUBL9btDB8Hhe7ei0TT8NVuHFxWxh5NhdepQ==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>-->
    <script>ace.config.set("basePath", "https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.13/")</script>
    `

    static scope = 'CODE'
    static style = () => this.safeCSS()
    `
    .ace-viewer, .ace-editor {
        font-size: 1em;
        min-height: 3em;
        line-height: 1.3;
        resize: vertical;        /* editor box resizing requires editor.resize() to be invoked by ResizeObserver */
    }
    .ace-viewer {
        background-color: rgba(255,255,255,0);
        width: calc(100% + 4px);
        margin-left: -4px;       /* shift the viewer to better align inner text with text of surrounding rows in a catalog */
    }
    .ace-editor {
        background-color: rgba(255,255,255,0.5);
        height: 12em;
    }
    `

    static viewer_options = {
        mode:                   "ace/mode/jsx",   // .../javascript
        readOnly:               true,
        showGutter:             false,
        displayIndentGuides:    false,
        showPrintMargin:        false,
        highlightActiveLine:    false,
        useWorker:              false,      // disable syntax checker and warnings
        // maxLines:               10,    // when set, it makes the editor (!) display with incorrect height
    }
    static editor_options = {
        // each mode & theme may need a separate mode-*, worker-*, theme-* file (!) - see: https://cdnjs.com/libraries/ace
        //theme:                "ace/theme/textmate",  //textmate dreamweaver crimson_editor
        mode:                   "ace/mode/jsx",
        showGutter:             true,
        displayIndentGuides:    true,
        showPrintMargin:        true,
        highlightActiveLine:    true,
        useWorker:              false,      // disable syntax checker and warnings
    }

    viewerRef = createRef()
    viewerAce                       // ACE viewer object
    editorAce                       // ACE editor object

    viewer() {
        let value  = this.display(this.props.value)
        let lines  = value.trimRight().split('\n')
        let height = Math.min(10, 4 + Math.max(0, lines.length - 2)) + 'em'
        return DIV(cl("ace-viewer"), st({height}), {onDoubleClick: e => this.open(e), ref: this.viewerRef})
    }
    editor() {
        return DIV({
            ref:            this.input,
            autoFocus:      true,
            onKeyDown:      e => this.key(e),
            //onBlur:         e => this.reject(e),
            className:      "ace-editor",
        })
    }

    createAce(value, div, options) {
        let widget = ace.edit(div, options)
        widget.session.setValue(value)
        let observer = new ResizeObserver(() => widget.resize())    // watch for user resizing the Ace box;
        observer.observe(div)                                       // on resize must update the Ace widget;
        let destroy = widget.destroy.bind(widget)                   // amend the standard destroy() to disconnect the observer
        widget.destroy = () => {observer.disconnect(); destroy()}
        return widget
    }
    deleteAce() {
        this.viewerAce?.destroy()                       // destroy the ACE widget to free up resources
        this.editorAce?.destroy()
        delete this.viewerAce
        delete this.editorAce
    }

    initViewer() {
        assert(this.viewerRef.current)
        let value = this.display(this.props.value)
        this.viewerAce = this.createAce(value, this.viewerRef.current, this.constructor.viewer_options)
        this.viewerAce.renderer.$cursorLayer.element.style.display = "none"      // no Ace cursor in preview
    }
    initEditor() {
        this.deleteAce()
        this.editorAce = this.createAce(this.default, this.input.current, this.constructor.editor_options)
        this.editorAce.focus()
    }
    initAce()   { if (this.state.editing) this.initEditor(); else this.initViewer() }
    value()     { return this.editorAce.session.getValue() }        // retrieve an edited flat value from the editor
    close()     { this.deleteAce(); super.close() }

    componentDidMount()                         { this.initAce() }
    componentWillUnmount()                      { this.deleteAce() }
    componentDidUpdate(prevProps, prevState)    { if (this.state.editing !== prevState.editing) this.initAce() }
}

/**********************************************************************************************************************/

export class GENERIC_Widget extends TEXT_Widget {
    /* Display raw JSON representation of a value using a standard text editor */
    empty(value)    { return TypeWidget.prototype.empty.call(this, value) }
    view(value)     { return JSONx.stringify(value) }               // JSON string is pretty-printed for edit
    encode(value)   { return JSONx.stringify(value, null, 2) }      // JSON string is pretty-printed for edit
    decode(value)   { return JSONx.parse(value) }
}
