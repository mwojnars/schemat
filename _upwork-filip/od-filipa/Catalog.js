const e = React.createElement;
function _e(name) {
    return (...args) =>
        args[0]?.$$typeof || typeof args[0] === 'string' ?      // if the 1st arg is a React element or string, no props are present
            e(name, null, ...args) :
            e(name, args[0], ...args.slice(1))
}

export const HTML  = (html) => { return {dangerouslySetInnerHTML: {__html:html}} }
export const FRAGMENT = (...nodes) => e(React.Fragment, {}, ...nodes)
export const useEffect = React.useEffect
export const useState  = React.useState
export const useRef    = React.useRef
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



let data = {
      "_id": "61940fdc93159f73d2177dbf",
      "index": 0,
      "guid": "6828aba4-2ce5-424f-ac86-eb993f7719af",
      "isActive": "true",
      "balance": "$3,556.50",
      "picture": "http://placehold.it/32x32",
      "age": 35,
      "eyeColor": "brown",
      "name": "Gonzalez Henderson",
      "gender": "male",
      "company": "ROUGHIES",
      "email": "gonzalezhenderson@roughies.com",
      "phone": "+1 (949) 510-3020",
      "address": "470 Borinquen Pl, Caln, Oklahoma, 7044",
      "latitude": -42.300785,
      "longitude": 133.194274,
      "tager": "wager",
      "tags": {
        "ut":"Ut",
        "d":"Ut",
        "s":"Ut", 
        "uaat":"Ut",
        "udsat":"Ut",
        "tags 2": {
            "ut":"Ut",
            "as":"Ut",
            "asad":"Ut", 
            "dasdsa":"Ut",
            "dsa":"Ut",
            "dasd":"Ut",
            "a":"Ut"
          },
        "asdasdsa":"Ut",
        "tags 3": {
            "ut":"Ut",
            "as":"Ut",
            "asad":"Ut", 
            "dasdsa":"Ut",
            "dsa":"Ut",
            "dasd":"Ut",
            "a":"Ut"
          },
        "ut":"Ut"
      },
      "greeting": "Hello, Gonzalez Henderson! You have 10 unread messages.",
      "favoriteFruit": "apple"
    }
  
    export class Entity
    
    {
        constructor(add, path) {
            this.edit = add
            this.path = path
        }


        EmptyValue() { return  I({style: {opacity: 0.3}}, "(empty)") }
    
        Viewer(value, show) {
            return DIV({onDoubleClick: show}, value || this.EmptyValue())
        }
        Editor(value, hide, ref) {
            return INPUT({defaultValue: value, ref: ref, onBlur: hide,
                    onKeyUp: (e) => {this.acceptKey(e) &&(hide()
                        ||
                        changes.Edit_changes(this.path, e.target.value))
                    
                    },
                    autoFocus: true, type: "text", style: {width:"100%"}}
            )
        }
        acceptKey(event) { 
            
            return ["Enter","Escape"].includes(event.key) }
        
        RemovePart(elem, path){
           elem.target.parentNode.parentNode.style.display = "none"
           changes.Deleted_Directory_push(path)
        }

        Delete(path){
            
            return DIV({onClick: (evnt)=>this.RemovePart(evnt, path),style:{fontWeight: "bold"}}, "DEL")
        }

        Widget({value}) {
            let [editing, setEditing] = useState(this.edit)
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


/* const [obj, edit_obj] = useState(data) */

/* console.log(obj) */

function Recursive_entries({data, color=0, is_object, path_to_val, display}) {
    const [times, add_time] = useState(0)

    let nested_padding = 50;

    let rows = Object.entries(data).map(([key, value], i)=>{
        let new_path_to_val = path_to_val.concat([key])
        
        
        is_object?color=color:color=i%2
        function new_catalog(){
            const [catalog_display, changeDisplay] = useState((new_path_to_val.length>1)?"none":"flex")
            const [arrow, changeArrow] = useState((catalog_display==="flex")?"CLOSE":"OPEN")
            useEffect(()=>{
                    changeArrow((catalog_display==="flex")?"CLOSE":"OPEN")
            }, [catalog_display])
            return DIV({className: 'ct-nested', colSpan: 2},
            DIV({className: 'ct-field',style:{fontWeight: "bold"}, onClick: ()=>{changeDisplay((catalog_display==="flex")?"none":"flex")}}, key  ,SPAN({style:{float: "right",  marginRight: 25}}, arrow)),
            e(Recursive_entries, {data: value, color: color, is_object: true, path_to_val: new_path_to_val, display: catalog_display}))
        }
        function catalog_end(){
            return e(Entry, {field: key, value: value, path_to_val: new_path_to_val})
        }

        if(key==i) key = ""
        if(key != "id") 
            return DIV({className: `ct-color${color} row-block`},
                (typeof value === "object")
                            ?new_catalog() 
                            :catalog_end()
            )
    })
    
    return DIV({className: 'catalog', style:{paddingLeft: nested_padding, display: display}}, ...rows, Add_entries(color, times, add_time))
}
function Add_entries(color, times, add_time){
    
    const [input_or_plus, change_input_or_plus] = useState([])

    function render_new(a){
        return a.map((el, i)=>{
            return DIV({className: `ct-color${color} row-block`, key:i},
            DIV({className: 'ct-delete'}, schema.Delete("")),
            DIV({className: 'ct-field'}, INPUT()),
            DIV({className: 'ct-value'}, INPUT()),)
        })
    }
    return FRAGMENT(render_new(input_or_plus),DIV({className: `ct-color${color} row-block`, onClick:()=>change_input_or_plus(data=>[...data, "a"])}, "+"))
}
function Entry({field, value, path_to_val}) {
    console.log(path_to_val)
    let schema = new Entity(false, path_to_val)
    let bold = (path_to_val.length===1)?"bold":"normal"
    return FRAGMENT(
        DIV({className: 'ct-delete',style:{fontWeight: bold}}, schema.Delete(path_to_val)),
        DIV({className: 'ct-field',style:{fontWeight: bold}}, schema.Widget({value: field})),
        DIV({className: 'ct-value'}, schema.Widget({value: value})),
           )
}



class Changes {
    /* List of changes to item's data that have been made by a user and can be submitted
       to the server and applied in DB. Multiple edits of the same data entry are merged into one.
     */
    constructor(item) {
        this.item = item
        this.deleted_path = []
        this.edit_changes = []
    }
    reset() {
        console.log('Reset clicked')
    }
    submit() {
        console.log('Submit clicked')
    }
    Deleted_Directory_push(path){
        this.deleted_path.push(path)
        console.log(this.deleted_path)
    }
    Edit_changes(path, value){
        this.edit_changes.push({path: path, value:value})
        console.log(this.edit_changes)
    }


    Buttons = ({changes}) =>
        DIV({style: {textAlign:'right', paddingTop:'20px'}}, 
            BUTTON({id: 'reset' , className: 'btn btn-secondary', onClick: changes.reset,  disabled: false}, 'Reset'), ' ',
            BUTTON({id: 'submit', className: 'btn btn-primary',   onClick: changes.submit, disabled: false}, 'Submit'),
        )
}
let changes = new Changes(data)
function Page({item}) {
    
    let is_object = false
    let path_to_val = []
    let display = "flex"
    let color = 0
    return DIV(
        H2('Properties'),
        e(Recursive_entries, {data, color,is_object, path_to_val, display}),
        e(changes.Buttons, {changes}),
    )
}



ReactDOM.render(Page(data), document.getElementById("react-dom"))