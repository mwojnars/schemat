import {T, assert, trycatch} from "../common/utils.js";
import {Catalog} from '../data.js'
import {generic_string} from "../type.js";

import {cl, e, st, FRAGMENT, I, DIV, NBSP, OPTION, SELECT, useState} from "./react-utils.js";
import {MaterialUI} from "./resources.js";
import {TextualWidget} from "./widgets.js";
import {Component, Style} from "./component.js";


/**********************************************************************************************************************
 **
 **  CATALOG TABLE component
 **
 */

export class CatalogTable extends Component {
    /* React component that displays a Catalog in a tabular form. */

    static style = new Style('CATALOG', this, {},
    `
        .catalog-d0       { width: 100%; font-size: 1rem; }
        
        .entry1           { background: #e2eef9; }   /* #D0E4F5 */
        .entry2           { background: #f6f6f6; }
        .entry            { padding-left: 15px; }   /* border-collapse: collapse; */
        .entry-head       { display: flex; }
        .entry:not(:last-child)          { border-bottom: 1px solid #fff; }
        .spacer           { flex-grow: 1; }

        .onhover          { width: 25%; height: 20px; margin-top: -20px; position: absolute; top:0; }
        .addnew           { padding-left: 20px; opacity: 0.4; }
        .addnew.hide      { max-height: 0; margin-top:-1px; visibility: hidden; transition: 0.2s linear 0.1s; overflow-y: hidden; }
        .addnew:hover, .onhover:hover + .addnew   
                          { max-height: 100px; margin-top:0; visibility: visible; transition: max-height 0.3s linear 0.5s; opacity: 1; }
        .addnew .cell-key { cursor: pointer; border-right: none; }

        .cell             { padding: 14px 20px 11px; position: relative; }
        .cell-key         { padding-left: 0; border-right: 1px solid #fff; display: flex; flex-grow: 1; align-items: center; }
        .cell-value       { width: 800px; }
        
        .key              { font-weight: bold; overflow-wrap: anywhere; text-decoration-line: underline; text-decoration-style: dotted; }
        .key:not([title]) { text-decoration-line: none; }
        .key-missing      { opacity: 0.3; visibility: hidden; }
        
        /* show all control icons/info when hovering over the entry: .move, .delete, .insert, .key-missing */
        .cell-key:hover *|            { visibility: visible; }
                
        .cell-value|                  { font-size: 0.8rem; font-family: 'Noto Sans Mono', monospace; /* courier */ }
        .cell-value :is(input, pre, textarea, .ace-viewer, .ace-editor)      /* NO stopper in this selector, it must apply inside embedded widgets */         
                                      { font-size: 0.8rem; font-family: 'Noto Sans Mono', monospace; }

        .move|                        { margin-right: 10px; visibility: hidden; }
        :is(.moveup,.movedown)|       { font-size: 0.8em; line-height: 1em; cursor: pointer; } 
        .moveup|::after               { content: "△"; }
        .movedown|::after             { content: "▽"; }
        .moveup:hover|::after         { content: "▲"; color: mediumblue; } 
        .movedown:hover|::after       { content: "▼"; color: mediumblue; }
        
        .expand                       { padding-left: 10px; }
        .expand.is-empty|::after      { content: "▿"; }
        .expand.is-folded|::after     { content: "▸"; cursor: pointer; }
        .expand.is-expanded|::after   { content: "▾"; cursor: pointer; }
        
        .insert|::after               { content: "✚"; }
        .insert:hover|                { color: green; text-shadow: 1px 1px 1px #777; cursor: pointer; }
        
        .delete|::after               { content: "✖"; }
        .delete|                      { padding-left: 10px; }
        .delete|, .insert|            { color: #777; flex-shrink:0; font-size:1.1em; line-height:1em; visibility: hidden; }
        .delete:hover|                { color: firebrick; text-shadow: 1px 1px 1px #777; cursor: pointer; }

        .catalog-d1                   { padding-left: 25px; margin-top: -10px; }
        .catalog-d1 .entry            { padding-left: 2px; }
        .catalog-d1 .key              { font-weight: normal; font-style: italic; }
        .catalog.is-empty             { margin-top: 0; }

        .flash|         { padding:4px 12px; border-radius: 2px; color:white; opacity:1; position: absolute; top:8px; right:8px; z-index:10; }
        .flash-info|    { background-color: mediumseagreen; transition: 0.2s; }
        .flash-warn|    { background-color: salmon; transition: 0.2s; }
        .flash-stop|    { opacity: 0; z-index: -1; transition: 2s linear 1s; transition-property: opacity, background-color, z-index; }
        .error|         { padding-top:5px; color:red; }
    `)
    /* CSS elements:
        .dX        -- nesting level (depth) of a CATALOG, X = 0,1,2,...
        .entry     -- <TR> of a table, top-level or nested
        .entryK    -- alternating colors of rows, K = 1 or 2
        .entry-head-- wrapper around key-value block, or the key block alone if it preceeds an unfolded subcatalog
        .cell-*    -- <DIV> box inside a entry that holds a key/value/subcatalog
        .key       -- deep-most element containing just a key label
        .value     -- deep-most element containing just a rendered value component
       Other:
        .icon-*    -- fixed-sized icons for control elements
       DRAFTS:
        drag-handle (double ellipsis):  "\u22ee\u22ee ⋮⋮"
        undelete: ↺ U+21BA
    */

    move(up, down) {
        let hide = st({visibility: 'hidden'})
        return DIV(cl('move'),
                   DIV(cl('moveup'),   {onClick: e => up(),   title: "Move up"},   !up   && hide),
                   DIV(cl('movedown'), {onClick: e => down(), title: "Move down"}, !down && hide))
    }
    delete(action)  { return DIV(cl('delete'), {onClick: action, title: "Delete this entry"}) }

    // info(type)    { return type.info ? {title: type.info} : null }
    //     if (!type.info) return null
    //     return I(cl('icon-info'), {title: type.info}, '?')
    //     // return I(cl('icon-info material-icons'), {title: type.info}, 'help_outline') //'question_mark','\ue88e','info'
    //     // return I(cl("bi bi-info-circle icon-info"), {title: type.info})
    //     // return I(cl("icon-info"), st({fontFamily: 'bootstrap-icons !important'}), {title: type.info}, '\uf431')
    //     // let text = FRAGMENT(type.info, '\n', A({href: "./readmore"}, "read more..."))
    //     // return e(MaterialUI.Tooltip, {title: text},
    //     //            I(cls, st({marginLeft: '9px', color: '#aaa', fontSize: '0.9em'})))
    //     // styled.i.attrs(cls) `margin-left: 9px; color: #aaa; font-size: 0.9em;`
    // }

    expand({state, toggle}) { return DIV(cl(`expand is-${state}`), {onClick: toggle}) }
    insert(action)  {
        let menu = [
            ['Add before', () => action(-1)],
            ['Add after',  () => action(+1)],
        ]
        return e(MaterialUI.Tooltip,
                    {// PopperProps: {style: {marginTop: '-30px'}, sx: {mt: '-30px'}},
                     componentsProps: {tooltip: {sx: {background: 'white', color: 'black', m:'0 !important'}}},
                     title: FRAGMENT(...menu.map(cmd => e(MaterialUI.MenuItem, cmd[0], {onClick: cmd[1]}))),
                     placement: "bottom-end", enterDelay: 1500, enterTouchDelay: 500, leaveTouchDelay: 500,
                    },
                    DIV(cl('insert'), {onClick: () => action(+1)}),
                )
    }

    flash() {
        let [msg, setMsg] = useState()
        let [cls, setCls] = useState()
        let action = (msg, ok = true) => setMsg(msg) || setCls(ok ? 'flash-info' : 'flash-warn')
        let box = DIV(msg, cl('flash', cls || 'flash-stop'), {key: 'flash', onTransitionEnd: () => setCls(null)})
        return [action, box]
    }
    error() {
        let [msg, setMsg] = useState()
        let box = msg ? DIV(cl('error'), {key: 'error'}, msg) : null
        return [setMsg, box]
    }

    key(entry, info, ops, expand) {
        /* Display key of an entry, be it an atomatic entry or a subcatalog. */
        let [current, setCurrent] = useState(entry.key)
        const save = async (newKey) => {
            await ops.updateKey(newKey)
            setCurrent(newKey)
        }
        let [flash, flashBox] = this.flash()
        let [error, errorBox] = this.error()

        let {initKey, keyNames} = ops
        let widget = (entry.id === 'new') ? CatalogTable.NewKeyWidget : CatalogTable.KeyWidget
        let props  = {value: current, flash, error, save: initKey || save, keyNames, type: generic_string}

        return FRAGMENT(
                    this.move(ops.moveup, ops.movedown),
                    DIV(cl('key'), e(widget, props), info && {title: info}),
                    expand && this.expand(expand),
                    DIV(cl('spacer')),
                    ops.insert && this.insert(ops.insert),
                    ops.delete && this.delete(ops.delete),
                    flashBox, errorBox,
                )
    }

    static KeyWidget = class extends TextualWidget {
        /* A special type of STRING widget for displaying keys in a catalog. */
        static defaultProps = {
            keyNames: undefined,    // array of predefined key names to choose from
        }
        empty(value)   { return !value && I(cl('key-missing'), "(empty)") }
        editor() {
            let {keyNames} = this.props
            if (!keyNames) return super.editor()
            // let options = keyNames.map(key => OPTION({value: key}, key))
            let options = [OPTION("select key ...", {value: ""}), ...keyNames.map(key => OPTION({value: key}, key))]
            return SELECT({
                    defaultValue:   this.default,
                    ref:            this.input,
                    onKeyDown:      e => this.key(e),
                    onChange:       e => e.target.value === "" ?  this.reject(e) : this.accept(e),
                    onBlur:         e => this.reject(e),
                    autoFocus:      true,
                    // size:           5,                  // enforces a list box instead of a dropdown, no need for "select key..." pseudo-option
            }, options)
        }
    }

    static NewKeyWidget = class extends CatalogTable.KeyWidget {
        static defaultProps = {
            editing:  true,         // this widget starts in edit mode
        }
        reject(e)   { this.props.save(undefined) }      // save() must be called to inform that no initial value was provided
    }

    EntryAtomic({item, path, entry, type, ops}) {
        /* A table row containing an atomic entry: a key and its value (not a subcatalog).
           The argument `key_` must have a "_" in its name to avoid collision with React's special prop, "key".
           `entry.value` and `type` can be undefined for a newly created entry, then no value widget is displayed.
           If value is undefined, but type is present, the value is displayed as "missing".
         */
        // useState() treats function arguments in a special way, that's why we must wrap up classes and functions in an array
        let wrap = (T.isClass(entry.value) || T.isFunction(entry.value))

        let [value, setValue] = useState(wrap ? [entry.value] : entry.value)
        let isnew = (value === undefined) || entry.saveNew

        const save = async (newValue) => {
            // print(`save: path [${path}], value ${newValue}, type ${type}`)
            let action = entry.saveNew || ops.updateValue       // saveNew: an entire entry is saved for the first time
            await action(newValue)
            setValue(newValue)
        }
        let [flash, flashBox] = this.flash()            // components for value editing; for key editing created in key() instead
        let [error, errorBox] = this.error()
        let props = {value: wrap && T.isArray(value) ? value[0] : value,
                     editing: isnew,                    // a newly created entry (no value) starts in edit mode
                     save, flash, error, type}

        let valueElement = type && this.embed(type.Widget, props)

        return DIV(cl('entry-head'),
                  DIV(cl('cell cell-key'),   this.key(entry, type?.props.info, ops)),
                  DIV(cl('cell cell-value'), valueElement, flashBox, errorBox),
               )
    }

    EntrySubcat({item, path, entry, type, color, ops}) {
        let [folded, setFolded] = useState(false)
        let subcat = entry.value
        let empty  = false //!subcat.length   -- this becomes INVALID when entries are inserted/deleted inside `subcat`
        let toggle = () => !empty && setFolded(f => !f)
        let expand = {state: empty && 'empty' || folded && 'folded' || 'expanded', toggle}
        let key    = this.key(entry, type?.props.info, ops, expand)

        return FRAGMENT(
            DIV(cl('entry-head'), {key: 'head'},
                DIV(cl('cell cell-key'), key, folded ? null : st({borderRight:'none'})),
                DIV(cl('cell cell-value'))
            ),
            DIV({key: 'cat'}, folded && st({display: 'none'}),
                e(type.Widget, {item, path, catalog: subcat, type, color})),
        )
    }
    EntryAddNew({hide = true, insert}) {
        return FRAGMENT(
            hide && DIV(cl('onhover')),
            DIV(cl('entry-head addnew'), hide && cl('hide'),
                DIV(cl('cell cell-key'), "✚ ", NBSP, " Add new entry ...", {onClick: insert}),
                DIV(cl('cell cell-value'))
            )
        )
    }

    // validKey(pos, key, entries, type) {
    //     /* Check that the key name at position `pos` in `entries` is allowed to be changed to `key`
    //        according to the `type`; return true, or alert the user and raise an exception. */
    //     // verify that a `key` name is allowed by the catalog's type
    //     let subtype = trycatch(() => type.subtype(key))
    //     if (!subtype) {
    //         let msg = `The name "${key}" for a key is not permitted by the type.`
    //         alert(msg); throw new Error(msg)
    //     }
    //     // check against duplicate names, if duplicates are not allowed
    //     if (!subtype.repeated)
    //         for (let ent of entries) {}
    //     return true
    // }

    actions({item, path, setEntries}) { return {
        /* A set of UI actions to manipulate top-level entries, for use by subcomponents of a Catalog() widget below. */

        insert: (pos, rel = -1) => setEntries(prev => {
            /* insert a special entry {id:"new"} at a given position to mark a place where an "add new entry" row should be displayed */
            // `rel` is -1 (add before), or +1 (add after)
            if (rel > 0) pos++
            return [...prev.slice(0,pos), {id: 'new'}, ...prev.slice(pos)]
        }),

        delete: async (pos) => {
            /* delete the entry at position `pos`; TODO: only mark the entry as deleted (entry.deleted=true) and allow undelete */
            // TODO: lock/freeze/suspense the UI until the server responds to prevent user from making multiple modifications at the same time
            await item.edit_delete([...path, pos])
            setEntries(prev => [...prev.slice(0,pos), ...prev.slice(pos+1)])
        },

        move: async (pos, delta) => {
            // move the entry at position `pos` by `delta` positions up or down, delta = +1 or -1
            assert(delta === -1 || delta === +1)
            await item.edit_move(path, pos, pos+delta)
            setEntries(prev => {
                // if (pos+delta < 0 || pos+delta >= prev.length) return prev
                let entries = [...prev];
                [entries[pos], entries[pos+delta]] = [entries[pos+delta], entries[pos]]     // swap [pos] and [pos+delta]
                return entries
            })
        },

        initKey: (pos, key, catalogSchema) => {
            /* Confirm creation of a new entry with a given key; assign an ID to it.
               Store an initial value of a key after new entry creation.
               `catalogSchema` is a DATA schema of a parent catalog, for checking if `key` is valid or not.
             */

            let type = trycatch(() => catalogSchema.subtype(key))
            if (key !== undefined && !type) {                  // verify if `key` name is allowed by the parent catalog
                alert(`The name "${key}" for a key is not permitted.`)
                key = undefined
            }
            let unnew = () => setEntries(prev => {
                /* mark an entry at a given position as not new anymore, by deleting its `saveNew` prop */
                delete prev[pos].saveNew
                return [...prev]
            })

            setEntries(prev => {
                assert(prev[pos].id === 'new')
                if (key === undefined) return [...prev.slice(0,pos), ...prev.slice(pos+1)]          // drop the new entry if its key initialization was terminated by user

                let value = type.getInitial()
                let ids = [-1, ...prev.map(e => e.id)]
                let id  = Math.max(...ids.filter(Number.isInteger)) + 1     // IDs are needed internally as keys in React subcomponents
                prev[pos] = {id, key, value}

                if (type.isCatalog()) item.edit_insert(path, pos, {key, value})
                else prev[pos].saveNew = (value) =>
                    item.edit_insert(path, pos, {key, value}).then(() => unnew())

                return [...prev]
            })
        },
        updateKey: (pos, newKey) => {
            return item.edit_update([...path, pos], {key: newKey})
        },
        updateValue: (pos, newValue, type) => {
            return item.edit_update([...path, pos], {value: newValue})
        }
    }}

    Main({item, catalog, type, path = [], color, start_color}) {
        /* If `start_color` is undefined, the same `color` is used for all rows. */

        assert(catalog instanceof Catalog)
        assert(type?.isCatalog(), `type ${type} is not a CATALOG`)

        let getColor = pos => start_color ? 1 + (start_color + pos - 1) % 2 : color

        // `id` of an entry is used to identify subcomponents through React's "key" property
        let [entries, setEntries] = useState(catalog.getEntries().map((ent, pos) => ({...ent, id: pos})))
        let run = this.actions({item, path, setEntries})

        let keyNames = type.getValidKeys()
        let N = entries.length

        let rows = entries.map((entry, pos) =>
        {
            let {key}   = entry
            let isnew   = (entry.id === 'new')
            let vschema = isnew ? undefined : type.subtype(key)
            let color   = getColor(pos)

            // insert `pos` as the 1st arg in all actions of `run`
            let ops     = T.mapDict(run, (name, fun) => [name, (...args) => fun(pos, ...args)])

            // some actions in `ops` must be defined separately
            ops.moveup   = pos > 0   ? () => run.move(pos,-1) : null        // moveup() is only present if there is a position available above
            ops.movedown = pos < N-1 ? () => run.move(pos,+1) : null        // similar for movedown()
            ops.initKey  = isnew ? key => run.initKey(pos, key, type) : null
            ops.keyNames = keyNames
            ops.updateValue = val => run.updateValue(pos, val, vschema)

            let props   = {item, path: [...path, pos], entry, type: vschema, color, ops}
            let row     = e(vschema?.isCatalog() ? this.EntrySubcat : this.EntryAtomic, props)
            return DIV(cl(`entry entry${color}`), {key: entry.id}, row)
        })

        let pos   = rows.length
        let depth = path.length
        let empty = !entries.length

        // if (!entries.map(e => e.id).includes('new'))
        rows.push(DIV(cl(`entry entry${getColor(pos)}`), {key: 'add'}, st({position: 'relative'}),
                  e(this.EntryAddNew, {hide: depth > 0, insert: () => run.insert(pos)})))

        return DIV(cl(`catalog catalog-d${depth}`), empty && cl('is-empty'), ...rows)
    }

    render()    { return e(this.Main, this.props) }
}

