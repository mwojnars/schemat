/**********************************************************************************************************************
 **
 **  UTILITIES
 **
 */

export let print = console.log

export const e = React.createElement         // React must be imported in global scope

function _e(name) {
    return (...args) =>
        args[0]?.$$typeof || typeof args[0] === 'string' ?      // if the 1st arg is a React element or string, no props are present
            e(name, null, ...args) :
            e(name, args[0], ...args.slice(1))
}

export const A     = _e('a')
export const B     = _e('b')
export const I     = _e('i')
export const P     = _e('p')
export const H1    = _e('h1')
export const H2    = _e('h2')
export const H3    = _e('h3')
export const H4    = _e('h4')
export const H5    = _e('h5')
export const PRE   = _e('pre')
export const DIV   = _e('div')
export const SPAN  = _e('span')
export const TABLE = _e('table')
export const THEAD = _e('thead')
export const TBODY = _e('tbody')
export const TFOOT = _e('tfoot')
export const TH    = _e('th')
export const TR    = _e('tr')
export const TD    = _e('td')
export const INPUT = _e('input')
export const BUTTON   = _e('button')
export const TEXTAREA = _e('textarea')

export const HTML  = (html) => { return {dangerouslySetInnerHTML: {__html:html}} }

export const FRAGMENT = (...nodes) => e(React.Fragment, {}, ...nodes)

export const useEffect = React.useEffect
export const useState  = React.useState
export const useRef    = React.useRef

export function delayed_render(async_fun, empty = undefined) {
    /* Delayed rendering: returns null on initial rendering attempt, then asynchronously calculates
       rendering output through async_fun() and requests re-rendering to return the final result. */
    const [output, setOutput] = useState(empty)
    useEffect(async () => setOutput(await async_fun()), [])
    return (output === empty) ? null : output
}


/**********************************************************************************************************************
 **
 **  UI COMPONENTS
 **
 */

function Catalog1({item}) {
    return delayed_render(async () => {
        let start_color = 0                                   // color of the first row: 0 or 1
        let category = item.category
        let entries = await item.getEntries()
        let schemas = await category.get_fields()

        let rows = entries.map(([field, value], i) => {
            let schema = schemas[field]  //await category.get_schema(field)
            let color  = (start_color + i) % 2
            return TR({className: `ct-color${color}`},
                      schema.is_catalog
                        ? TD({className: 'ct-nested', colSpan: 2},
                            DIV({className: 'ct-field'}, field),
                            e(Catalog2, {data: value, schema: schema.values, color: color})
                        )
                        : e(Entry, {field: field, value: value, schema: schema})
            )
        })
        return TABLE({className: 'catalog-1'}, TBODY(...rows))
    })
}

function Catalog2({data, schema, color = 0}) {
    return DIV({className: 'wrap-offset'},
            TABLE({className: 'catalog-2'},
              TBODY(...Object.entries(data).map(([field, value]) =>
                TR({className: `ct-color${color}`}, e(Entry, {field: field, value: value, schema: schema})))
           )))
}

function Entry({field, value, schema = generic_schema}) {
    /* A table row containing an atomic value of a data field (not a subcatalog). */
    return FRAGMENT(
                TH({className: 'ct-field'}, field),
                TD({className: 'ct-value'}, schema.Widget({value: value})),
           )
}

/**********************************************************************************************************************/

class Changes {
    /* List of changes to item's data that have been made by a user and can be submitted
       to the server and applied in DB. Multiple edits of the same data entry are merged into one.
     */
    constructor(item) {
        this.item = item
    }
    reset() {
        print('Reset clicked')
    }
    submit() {
        print('Submit clicked')
    }

    Buttons = ({changes}) =>
        DIV({style: {textAlign:'right', paddingTop:'20px'}},
            BUTTON({id: 'reset' , className: 'btn btn-secondary', onClick: changes.reset,  disabled: false}, 'Reset'), ' ',
            BUTTON({id: 'submit', className: 'btn btn-primary',   onClick: changes.submit, disabled: false}, 'Submit'),
        )
}

function Page({item}) {
    let changes = new Changes(item)
    return DIV(
        e(item.Title, {item}),
        H2('Properties'),
        e(Catalog1, {item, changes}),
        e(changes.Buttons, {changes}),
    )
}

/**********************************************************************************************************************/

export class STRING extends Schema
{
    EmptyValue() { return  I({style: {opacity: 0.3}}, "(empty)") }

    Viewer(value, show) {
        return DIV({onDoubleClick: show}, value || this.EmptyValue())
    }
    Editor(value, hide, ref) {
        return INPUT({defaultValue: value, ref: ref, onBlur: hide,
                onKeyUp: (e) => this.acceptKey(e) && hide(),
                autoFocus: true, type: "text", style: {width:"100%"}}
        )
    }
    acceptKey(event) { return ["Enter","Escape"].includes(event.key) }

    Widget({value}) {
        let [editing, setEditing] = useState(false)
        let [currentValue, setValue] = useState(value)
        let editor = useRef(null)

        const show = (e) => {
            setEditing(true)
            // editor.current.focus()
        }
        const hide = (e) => {
            setValue(editor.current.value)
            setEditing(false)
        }
        return editing ? this.Editor(currentValue, hide, editor) : this.Viewer(currentValue, show)
    }
}
