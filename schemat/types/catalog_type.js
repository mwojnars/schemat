import {ValidationError} from "../common/errors.js";
import {T, assert, trycatch, concat, mapEntries} from "../common/utils.js";
import {Catalog} from '../common/catalog.js'
import {FIELD, STRING, COMPOUND, generic_string, generic_type, is_valid_field_name} from "./type.js";

import {cl, e, st, FRAGMENT, I, DIV, NBSP, OPTION, SELECT, useState} from "../web/react-utils.js";
import {MaterialUI} from "../web/resources.js";
import {Component} from "../web/component.js";
import {TextualWidget} from "./widgets.js";


/**********************************************************************************************************************
 **
 **  CATALOG & DATA types
 **
 */

export class CATALOG extends COMPOUND {
    /*
    Data type of objects of the Catalog class or its subclass.
    Validates each `value` of a catalog's entry through a particular "child" type, which may depend
    on the entry's key, or be shared by all entries regardless of the key.

    The type instance may restrict the set of permitted keys in different ways:
    - require that a key name belongs to a predefined set of "fields"
    - no duplicate key names (across all non-missing names)
    - no duplicates for a particular key name -- encoded in the key's child type: child.repeated=false
    other constraints:
    - mandatory keys (empty key='' allowed)
    - empty key not allowed (by default key_empty_allowed=false)
    - keys not allowed (what about labels then?)
     */

    is_CATALOG() { return true }

    static get Widget() { return CatalogTable }

    static options = {
        class:          Catalog,
        key_type:       new FIELD(),                // type of keys in the catalog; must be an instance of STRING or its subclass
        value_type:     generic_type,               // type of values in the catalog
        initial:        () => new Catalog(),
    }

    child(key)   { return this.options.value_type }     // type of values of a `key`; subclasses should throw an exception or return undefined if `key` is not allowed
    valid_keys() { return undefined }

    constructor(options = {}) {
        super(options)
        let {key_type} = options
        if (key_type && !(key_type.instanceof(STRING)))
            throw new ValidationError(`data type of keys must be an instance of STRING or its subclass, not ${key_type}`)
    }

    collect(assets) {
        this.options.key_type.collect(assets)
        this.options.value_type.collect(assets)
        CatalogTable.collect(assets)            // CatalogTable is the widget used to display catalogs in the UI
    }

    toString() {
        let name = this.constructor.name
        let {key_type, value_type} = this.options
        return T.ofType(key_type, FIELD) ? `${name}(${value_type})` : `${name}(${key_type} > ${value_type})`
    }

    // find(path = null) {
    //     /* Return a (nested) type at a given `path`, or `this` if `path` is empty.
    //        The path is an array of keys on subsequent levels of nesting, some keys can be missing (null/undefined)
    //        if the corresponding subcatalog accepts this. The path may span nested CATALOGs at arbitrary depths.
    //      */
    //     return Path.find(this, path, (type, key) => {
    //         if (!type.is_CATALOG()) throw new Error(`data type path not found: ${path}`)
    //         return [type.child(key)]
    //     })
    // }

    merge_inherited(catalogs) {
        let {key_type, value_type} = this.options

        // if (default_) catalogs.push(default_)       // include the default value in the merge, if present

        // three variants of combining repeated values per key:
        // 1) "repeat":  accept repeated keys, if key_type allows this
        // 2) "merge":   combine repeated values into one through value_type's custom merging method
        // 3) "replace": take the youngest value per key and ignore all remaining ones
        let merge_values =
            key_type.is_repeated() ? null :
            value_type.merged      ? (values) => value_type.merge_inherited(values) :
                                     (values) => values[0]

        return Catalog.merge(catalogs, merge_values)
    }

    _validate(obj) {
        obj = super._validate(obj)

        let {key_type, value_type} = this.options
        for (let key of obj.keys()) key_type.validate(key)
        for (let val of obj.values()) value_type.validate(val)

        if (!key_type.options.repeated) {
            let dups = new Set()
            for (let key of obj.keys()) {
                if (key === undefined || key === null) continue
                if (dups.has(key)) throw new ValidationError(`duplicate key (${key})`)
                dups.add(key)
            }
        }
        return obj
    }
}


/**********************************************************************************************************************/

export class SCHEMA extends CATALOG {
    /* Like CATALOG, but provides distinct value types for different predefined keys (fields) of a catalog.
       Used as a value type for WebObject.__data, not intended for other uses.
     */

    static options = {
        fields: {},             // object with field names and their types; null means a default data type should be used for a given field
        strict: true,           // if true, only fields listed in `fields` are allowed; generic_type is assumed for other fields
    }

    isValidKey(key) {
        return is_valid_field_name(key) && (!this.options.strict || Object.hasOwn(this.options.fields, key))
    }

    has(key) { return !!this.options.fields[key] }      // true if `key` is EXPLICITLY declared here as a valid field
    get(key) { return this.options.fields[key] || (!this.options.strict && generic_type) || undefined }

    child(key) {
        let {fields} = this.options
        if (!fields.hasOwnProperty(key) && this.options.strict)
            throw new ValidationError(`Unknown field "${key}", expected one of [${Object.getOwnPropertyNames(fields)}]`)
        return fields[key] || this.options.value_type
    }
    collect(assets) {
        for (let type of this._all_subtypes())
            type.collect(assets)
        CatalogTable.collect(assets)
    }
    _all_subtypes() { return Object.values(this.options.fields) }

    valid_keys() {
        let fields = Object.getOwnPropertyNames(this.options.fields)
        fields = fields.filter(f => this.options.fields[f].is_editable())       // only keep user-editable fields
        return fields.sort()
    }
}

export class SCHEMA_GENERIC extends SCHEMA {
    /* Generic SCHEMA, used when there's no category for a web object. All property names are allowed in the web object,
       and their type is `generic_type`.
     */
    static options = {
        fields: {},
        strict: false,
    }
    child(key)      { return this.options.fields[key] || generic_type }
    _all_subtypes() { return [...super._all_subtypes(), generic_type] }
}


// export class DATA_SCHEMA extends TYPE {
//     /* An (imputed) instance of SCHEMA that represents schema of objects in a category, wrapped up in a SCHEMA. */
//
//     static options = {
//         editable: false,
//         impute() {
//             /* `this` is expected to be a Category object that defines items' schema through its `fields` property. */
//             // assert(this instanceof Category)
//             let fields = this.schema.object()
//             let custom = this.allow_custom_fields
//             return new SCHEMA({fields, strict: custom !== true})
//         }
//     }
// }


/**********************************************************************************************************************
 **
 **  CATALOG TABLE component
 **
 */

export class CatalogTable extends Component {
    /* React component that displays a Catalog in a tabular form. */

    static css_class = "CATALOG"
    static css_file  = import.meta.resolve('./catalog.css')

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
                  DIV(cl('cell cell-key'),   this.key(entry, type?.options.info, ops)),
                  DIV(cl('cell cell-value'), valueElement, flashBox, errorBox),
               )
    }

    EntrySubcat({item, path, entry, type, color, ops}) {
        let [folded, setFolded] = useState(false)
        let subcat = entry.value
        let empty  = false //!subcat.length   -- this becomes INVALID when entries are inserted/deleted inside `subcat`
        let toggle = () => !empty && setFolded(f => !f)
        let expand = {state: empty && 'empty' || folded && 'folded' || 'expanded', toggle}
        let key    = this.key(entry, type?.options.info, ops, expand)

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
    //     let child = trycatch(() => type.child(key))
    //     if (!child) {
    //         let msg = `The name "${key}" for a key is not permitted by the type.`
    //         alert(msg); throw new Error(msg)
    //     }
    //     // check against duplicate names, if duplicates are not allowed
    //     if (!child.repeated)
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
            await item.edit.unset([...path, pos]).save()
            setEntries(prev => [...prev.slice(0,pos), ...prev.slice(pos+1)])
        },

        move: async (pos, delta) => {
            // move the entry at position `pos` by `delta` positions up or down, delta = +1 or -1
            assert(delta === -1 || delta === +1)
            await item.edit.move([...path, pos], {delta}).save()
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
               `catalogSchema` is a SCHEMA of a parent catalog, for checking if `key` is valid or not.
             */

            let type = trycatch(() => catalogSchema.child(key))
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

                let value = type.get_initial()
                let ids = [-1, ...prev.map(e => e.id)]
                let id  = Math.max(...ids.filter(Number.isInteger)) + 1     // IDs are needed internally as keys in React subcomponents
                prev[pos] = {id, key, value}

                if (type.is_CATALOG()) item.edit.set_at(path, pos, key, value).save()
                else prev[pos].saveNew = (value) =>
                    item.edit.set_at(path, pos, key, value).save().then(() => unnew())

                return [...prev]
            })
        },
        updateKey: (pos, newKey) => {
            return item.edit.rename([...path, pos], newKey).save()
        },
        updateValue: (pos, newValue, type) => {
            return item.edit.set([...path, pos], newValue).save()
        }
    }}

    Main({item, catalog, type, path = [], color, start_color}) {
        /* If `start_color` is undefined, the same `color` is used for all rows. */

        assert(catalog instanceof Catalog)
        assert(type?.is_CATALOG(), `type ${type} is not a CATALOG`)

        let getColor = pos => start_color ? 1 + (start_color + pos - 1) % 2 : color

        // `id` of an entry is used to identify subcomponents through React's "key" property
        let [entries, setEntries] = useState(catalog.getRecords().map((ent, pos) => ({...ent, id: pos})))
        let run = this.actions({item, path, setEntries})

        let keyNames = type.valid_keys()
        let N = entries.length

        let rows = entries.map((entry, pos) =>
        {
            let {key}   = entry
            let isnew   = (entry.id === 'new')
            let vschema = isnew ? undefined : type.child(key)
            let color   = getColor(pos)

            // insert `pos` as the 1st arg in all actions of `run`
            let ops     = mapEntries(run, (name, fun) => [name, (...args) => fun(pos, ...args)])

            // some actions in `ops` must be defined separately
            ops.moveup   = pos > 0   ? () => run.move(pos,-1) : null        // moveup() is only present if there is a position available above
            ops.movedown = pos < N-1 ? () => run.move(pos,+1) : null        // similar for movedown()
            ops.initKey  = isnew ? key => run.initKey(pos, key, type) : null
            ops.keyNames = keyNames
            ops.updateValue = val => run.updateValue(pos, val, vschema)

            let props   = {item, path: [...path, pos], entry, type: vschema, color, ops}
            let row     = e(vschema?.is_CATALOG() ? this.EntrySubcat : this.EntryAtomic, props)
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

