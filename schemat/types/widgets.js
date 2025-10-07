import {T, assert, print, truncate, comma} from '../common/utils.js'
import {JSONx} from '../common/jsonx.js'

import {e, cl, st, createRef, useState, ItemLoadingHOC, BR} from '../web/react-utils.js'
import {A, B, I, P, PRE, DIV, SPAN, INPUT, TEXTAREA, FLEX, FRAGMENT, HTML, NBSP} from '../web/react-utils.js'

import {Component} from "../web/component.js"


/**********************************************************************************************************************/

export class TypeWidget extends Component {
    /* Base class for UI "view-edit" widgets that display and let users edit atomic (non-catalog) values
       of a particular data type. The most important methods are viewer() and editor() which return React elements
       for rendering the widget in "view" and "edit" modes, respectively.
     */
    static defaultProps = {
        type:   undefined,      // Type of the `value` to be displayed
        value:  undefined,      // value object to be displayed by render()
        inline:     false,      // if true, the component is displayed in inline mode and is inactive

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

    empty(v)    { return v == null && I('undefined') }      // view of an empty value, for display() and viewer()
    view(v)     { return this.encode(v) }                   // view of a non-empty value, for display() and viewer()
    display(v)  { return this.empty(v) || this.view(v) }    // convert a value to a UI element for display in viewer()
    encode(v)   { return JSONx.stringify(v) }               // convert a value to its editable representation
    decode(v)   { return JSONx.parse(v) }                   // ...and back

    viewer()    { return DIV(cl('viewer'), {onDoubleClick: e => this.open(e)}, this.display(this.props.value)) }
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
        catch (ex) { this.props.error(ex.toString()); console.error(ex) }
    }

    reject(e) {
        let [value, changed] = this.read()
        if (changed) this.props.flash("NOT SAVED", false)
        this.close()
    }

    /***  public api  ***/

    static element(props) {
        /* Syntactic sugar: create a React element with a method call instead of createElement() or e(). */
        return e(this, props)
    }

    static inline(props) {
        /* Display an inline variant of this component rather than a block. In this variant, the component
           is inactive and cannot be edited, unless the edit operation is handled by the parent. */
        return e(this, {...props, inline: true})
    }

    render() {
        let {type, value, inline} = this.props
        if (inline) return this.display(value)

        if (this.state.editing) {
            this.initial = (value !== undefined) ? this.encode(value) : undefined
            this.default = (this.initial !== undefined) ? this.initial : type.get_initial()
            return this.editor()
        }
        return this.viewer()
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
    shadow_dom = false

    static css_class = "TEXT"
    static css_file  = import.meta.resolve('./widgets.css')

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

    static css_class = "CODE"

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

    shadow_dom = false              // ACE pastes a part of its <style> into the <head> of the document upon initialization, so it must be a part of the main DOM

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

    componentDidMount()                         { super.componentDidMount?.(); this.initAce() }
    componentWillUnmount()                      { this.deleteAce(); super.componentWillUnmount?.() }
    componentDidUpdate(prev_props, prev_state)  { super.componentDidUpdate?.(prev_props, prev_state); if (this.state.editing !== prev_state.editing) this.initAce() }
}

/**********************************************************************************************************************/

export class JSON_Widget extends TEXT_Widget {
    /* Display raw JSONx representation of `value` using a standard text editor. */
    empty(value)    { return TypeWidget.prototype.empty.call(this, value) }
    view(value)     { return JSONx.stringify(value) }               // JSON string is pretty-printed for edit
    encode(value)   { return JSONx.stringify(value, null, 2) }      // JSON string is pretty-printed for edit
    decode(value)   { return JSONx.parse(value) }
}

/**********************************************************************************************************************/

export class TYPE_Widget extends JSON_Widget {

    static css_class = "TYPE"

    viewer()  { return TypeWidget.prototype.viewer.call(this) }
    view(type) {
        if (type?.real_type) type = type.real_type          // unwrap a TypeWrapper
        // if (type instanceof TypeWrapper) {
        //     if (!type.real_type) return "TypeWrapper (not loaded)"
        //     type = type.real_type
        // }
        let dflt = `${type.options.default}`
        return SPAN(type.label(),
                type.options.default !== undefined &&
                    SPAN(cl('default'), {title: `default value: ${truncate(dflt,1000)}`}, ` (${truncate(dflt,100)})`),
                type.options.info &&
                    SPAN(cl('info'), ` • ${type.options.info}`),   // smaller dot: &middot;  larger dot: •
                )
    }
}

/**********************************************************************************************************************/

export const REF_Widget = ItemLoadingHOC(class extends TypeWidget {

    static css_class = "REF"

    view() {
        let {value: obj, loaded} = this.props       // `loaded` function is provided by a HOC wrapper, ItemLoadingHOC
        if (!loaded(obj))                           // SSR outputs "loading..." only (no actual item loading), hence warnings must be suppressed client-side
            return SPAN({suppressHydrationWarning: true}, "loading...")

        let url = obj.url()
        let name = obj.name
        let linked = (txt) => url ? A({href: url}, txt) : txt
        let label = name ? linked(name) : SPAN('[', linked(`${obj.id}`), ']')
        let catg = obj.__category.name

        return catg ? SPAN(label, SPAN(cl('ref-category'), catg)) : label

        // let stamp = HTML(obj.get_stamp({html: false, brackets: false}))
        // if (name && url) {
        //     let note = obj.__category.name || null
        //     return SPAN(
        //         url ? A({href: url}, name) : name,
        //         SPAN(cl('ref-category'), note || stamp)
        //     )
        // } else
        //     return SPAN('[', url ? A({href: url, ...stamp}) : SPAN(stamp), ']')
    }
})

export class ARRAY_Widget extends JSON_Widget {
    view(array) {
        if (!Array.isArray(array)) array = [...array]
        let array_type = this.props.type
        let {type, inline} = array_type.options
        // let items = array.map(value => type.Widget.inline({value, type}))
        let items = array.map(value => e(type.Widget, {value, type, inline}))
        let sep = inline ? ', ' : BR()
        return FRAGMENT(...comma(items, sep))
    }
}
