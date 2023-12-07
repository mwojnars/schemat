import {NotImplemented} from "../common/errors.js";
import {T, print, assert, dedentFull, escape_html} from "../common/utils.js";
import {Resources, ReactDOM} from './resources.js'
import { e, useState, useRef, delayed_render, NBSP, DIV, A, P, H1, H2, H3, SPAN, FORM, INPUT, FIELDSET,
         TABLE, TH, TR, TD, TBODY, BUTTON, FRAGMENT, HTML } from './react-utils.js'
import {HttpService} from "../services.js";
import {Data} from "../data.js";


/**********************************************************************************************************************/

export class HtmlPage extends HttpService {
    /* An HTTP(S) service that generates an HTML page in response to a browser-invoked web request.
       In the base class implementation, the page is built out of separate strings/functions for: title, head, body.
     */
    execute(target, request) {
        // `view` is a descendant of `target` that additionally contains all View.* properties & methods
        // and a `context` property
        let view = this._create_view(target, request)
        let prepare = view.prepare_server()
        if (T.isPromise(prepare)) return prepare.then(() => view.generate())
        return view.generate()
    }

    _create_view(target, request = null) {
        /* Create a "view" object that combines the regular interface of the target object with the page-generation
           functionality as defined in the page's View. The view object is a descendant of the target object.
           Inside the page-generation functions, `this` is bound to the "view", so the code can access both
           the target object's properties and other page-generation functions.
           Also, view.context is set to the context object containing at least `target` and `page` (on the client),
           plus some request-related data (on the server).
         */
        let context = {request, target, page: this}
        let View = this.constructor.View
        let view = Object.setPrototypeOf({...View, context}, target)

        // bind View functions in `view` to the `view` object - this is to prevent React rendering/refresh errors,
        // or the need to manually bind React component functions later on
        for (const attr in View) {
            let fun = View[attr]
            if (typeof fun === "function")
                view[attr] = fun.bind(view)
        }

        return view
    }

    static View = {
        /* Methods and properties to be copied to a descendant of the target object to create a "view" that
           combines the regular interface of the target with the page-generation functionality as defined below.
           Inside the page-generation functions, `this` is bound to this combined "view" object, so it can access both
           the target object and the page-generation functions. Adding attributes to `this` is a convenient way to pass
           temporary data between the page-generation functions, because the attributes are added to the temporary
           view object and not to the target object. However, any attributes defined here in View must stay read-only,
           as they are shared between all views created from a given page class.
        */

        context: undefined,     // the context object: {target, page, ...plus request data as passed to the page's execute()}

        prepare_server() {
            /* Add extra information to the view (`this` or `this.context`) before the page generation starts.
               In subclasses, prepare_server() is typically asynchronous to allow loading of external data from DB;
               here, it is defined as synchronous to avoid another async call when no actual preparation is performed.
               The target object can also undergo some additional processing here.
             */
            print(`prepare_server() called for ${this.constructor.name}`)
        },

        generate() {
            /* Generate a complete HTML page server-side. Can be async.
               By default, this function calls target_html_*() functions to build separate parts of the page.
             */
            let title = this.html_title()
            let assets = this.html_head()
            let body = this.html_body()
            return this.html_frame({title, assets, body})
        },

        html_title()  {},       // override in subclasses; return a plain string to be put inside <title>...</title>
        html_head()   {},       // override in subclasses; return an HTML string to be put inside <head>...</head>
        html_body()   {},       // override in subclasses; return an HTML string to be put inside <body>...</body>

        html_frame({title, assets, body}) {
            // the title string IS escaped, while the other elements are NOT
            let title_html = (title !== undefined ? `<title>${escape_html(title)}</title>` : '')
            return dedentFull(`
                <!DOCTYPE html><html>
                <head>
                    ${title_html}
                    ${assets || ''}
                </head>`) +
                `<body>\n${body || ''}\n</body></html>`
        },
    }
}

/**********************************************************************************************************************/

export class RenderedPage extends HtmlPage {
    /* An HTML page that is rendered from a component (e.g., React).
       The (re)rendering can take place on the server and/or the client.
     */

    render(target, html_element, props) {
        /* Client-side rendering of the main component of the page to an HTML element. */
        throw new NotImplemented('render() must be implemented in subclasses')
    }

    static View = {
        ...HtmlPage.View,

        html_body() {
            let html = this.render_server()
            let data = this.page_data()
            let code = this.page_script()
            return this.component_frame({html, data, code})
        },

        render_server() {
            /* Server-side rendering (SSR) of the main component of the page to an HTML string. */
            return ''
        },

        page_data() {
            /* Data string to be embedded in HTML output for use by the client-side JS code. Must be HTML-escaped. */
            throw new NotImplemented('page_data() must be implemented in subclasses')
        },

        page_script() {
            /* Javascript code (a string) to be pasted inside a <script> tag in HTML source of the page.
               This code will launch the client-side rendering of the component.
             */
            throw new NotImplemented('page_script() must be implemented in subclasses')
        },

        component_frame({html, data, code}) {
            /* The HTML wrapper for the page's main component, `html`, and its `data` and the launch script, `code`.
               All these elements will be placed together inside <body>...</body>.
             */
            let data_string = this._encode_page_data(data)
            return `
                <div id="page-component">${html}</div>
                <script async type="module">${code}</script>
                <p id="page-data" style="display:none">${data_string}</p>
            `
        },

        _encode_page_data(data) {
            return btoa(encodeURIComponent(JSON.stringify(data)))
        },
    }
}

export class ReactPage extends RenderedPage {
    /* Generates a React-based HTML page whose main content is rendered from a React component.
       By default, the component is written to the #page-component element in the page body, and any additional
       (meta)data is written to the #page-data element. A <script> tag is added to the page to load
       the client-side JS code that will render the same component on the client side.
       The  component can be rendered on the client by calling render() directly, then the HTML wrapper is omitted.
     */

    async render(target, html_element) {
        /* If called server-side, `props` are just the server-side context. */
        target.assert_loaded()
        let view = this._create_view(target)
        let component = e(view.component)
        let prepare = view.prepare_client()
        if (T.isPromise(prepare)) await prepare
        return ReactDOM.createRoot(html_element).render(component)
    }

    static View = {
        ...RenderedPage.View,

        prepare_client() {
            /* Add extra information to the view before the rendering starts client-side. Can be async in subclasses. */
            print(`prepare_client() called for ${this.constructor.name}`)
            return null
        },

        render_server() {
            this.assert_loaded()
            print(`SSR render('${this.context.request.endpoint}') of ID=${this._id_}`)
            let view = e(this.component)
            return ReactDOM.renderToString(view)
            // might use ReactDOM.hydrate() not render() in the future to avoid full re-render client-side ?? (but render() seems to perform hydration checks as well)
        },

        page_data() {
            let dump = this.context.request.session.dump()
            return {...dump, endpoint: this.context.request.endpoint}
        },

        page_script() {
            return `import {ClientProcess} from "/system/local/processes.js"; new ClientProcess().start();`
        },

        component() {
            /* The React component to be rendered as the page's content. */
            throw new NotImplemented('component() must be implemented in subclasses')
        }
    }
}

/**********************************************************************************************************************/

export class ItemAdminPage extends ReactPage {
    /* A page that displays the properties of a single item. The target (`this` in target_*() functions)
       is expected to be an instance of Item.
     */

    static View = {
        ...ReactPage.View,

        html_title() {
            /* Get/compute a title for an HTML response page for a given request & view name. */
            let title = this.html_title
            // if (title instanceof Function) title = title()          // this can still return undefined
            if (typeof title === 'string') return title
            let ciid = this.getStamp({html: false})
            return `${this.name} ${ciid}`
        },

        html_head() {
            /* Render dependencies: css styles, libraries, ... as required by HTML pages of this item. */
            let globalAssets = Resources.clientAssets
            let staticAssets = this._schema_.getAssets().renderAll()
            let customAssets = this._category_?.html_assets
            let assets = [globalAssets, staticAssets, customAssets]
            return assets .filter(a => a?.trim()) .join('\n')
        },

        component({extra = null} = {}) {
            /* Detailed (admin) view of an item. */
            return DIV(
                // e(MaterialUI.Box, {component:"span", sx:{ fontSize: 16, mt: 1 }}, 'MaterialUI TEST'),
                // e(this._mui_test),
                this.Title(),
                H2('Properties'),
                this.Properties(),
                extra,
            )
        },

        // standard components for Item pages...

        Title() {
            /* <H1> element to be displayed as a page title. */
            let name = this.name
            let ciid = this.getStamp()
            if (name)
                return H1(name, ' ', SPAN({style: {fontSize:'40%', fontWeight:"normal"}, ...HTML(ciid)}))
            else
                return H1(HTML(ciid))
        },

        Properties() {
            /* Display this item's data as a DATA.Widget table with possibly nested Catalog objects. */
            // let changes = new Changes(this)
            return FRAGMENT(
                    this._schema_.displayTable({item: this}),
                    // e(changes.Buttons.bind(changes)),
                )
        },
    }
}

// _mui_test() {
//     return e(MaterialUI.Box, {component:"span", sx:{ fontSize: 16, mt: 1 }}, 'MaterialUI TEST')
//     // WARN: when _mui_test() is used repeatedly in Page, a <style> block is output EACH time (!!!)
//     //       A class name of the form .css-HASH is assigned, where HASH is a stable 6-letter hash of the styles
// }


/**********************************************************************************************************************/

export class CategoryAdminPage extends ItemAdminPage {

    static View = {
        ...ItemAdminPage.View,

        /* Below, `this` is bound to an instance of Category. */

        async prepare_server() {
            // preload the items list
            let scanned = registry.scan_category(this)
            this.context.items = await T.arrayFromAsync(scanned).then(arr => T.amap(arr, item => item.load()))
            // this.context.items = await this.action.list_items().then(arr => T.amap(arr, item => item.load()))
        },

        component() {
            let preloaded = this.context.items               // TODO: must be pulled from response data on the client to avoid re-scanning on 1st render

            const scan = () => this.action.list_items()
            // const scan = () => registry.scan_category(this)         // returns an async generator that requires "for await"

            const [items, setItems] = useState(preloaded || scan())          // existing child items; state prevents re-scan after every itemAdded()
                                                                // TODO: use materialized list of items to explicitly control re-scanning
                                                                //    ...and avoid React's incorrect refresh when Items (below) are called in a different way

            const [newItems, setNewItems] = useState([])        // newly added items
            const itemAdded   = (item) => { setNewItems(prev => [...prev, item]) }
            const itemRemoved = (item) => { setNewItems(prev => prev.filter(i => i !== item)) }

            return ItemAdminPage.View.component.call(this, {extra: FRAGMENT(
                H2('Items'),
                e(preloaded ? this.ItemsLoaded : this.Items, {key: 'items', items: items, itemRemoved: () => setItems(scan())}),
                // e(this.Items, {key: 'items', items: items, itemRemoved: () => setItems(scan())}),
                H3('Add item'),
                e(this.Items, {items: newItems, itemRemoved}),
                e(this.NewItem, {itemAdded}),
            )})
        },

        ItemsLoaded({items}) {
            if (!items || items.length === 0) return null
            let rows = items.map(item => this._ItemEntry({item}))
            return TABLE(TBODY(...rows))
        },

        Items({items, itemRemoved}) {
            /* A list (table) of items that belong to this category. */
            if (!items || items.length === 0) return null
            const remove = (item) => item.action.delete_self().then(() => itemRemoved && itemRemoved(item))
            // const loaded = !T.isPromise(items)
            // const loaded = T.isArray(items) && items.every(item => item.is_loaded())

            // materialize the list of items
            let items_loaded = //loaded ? items :
                delayed_render(T.arrayFromAsync(items).then(arr => T.amap(arr, item => item.load())), [items])

            if (!items_loaded) return null

            let rows = items_loaded.map(item => this._ItemEntry({item, remove}))
            return TABLE(TBODY(...rows))
        },

        _ItemEntry({item, remove}) {
            /* A single row in the list of items. */
            let name = item.name || item.getStamp({html:false})
            let url  = item.url()
            return TR(
                TD(`${item._id_} ${NBSP}`),
                TD(url !== null ? A({href: url}, name) : `${name} (no URL)`, ' ', NBSP),
                TD(BUTTON({onClick: () => remove(item)}, 'Delete')),
            )
        },

        NewItem({itemAdded}) {

            let form = useRef(null)

            const setFormDisabled = (disabled) => {
                let fieldset = form.current?.getElementsByTagName('fieldset')[0]
                if (fieldset) fieldset.disabled = disabled
            }

            const submit = async (e) => {
                e.preventDefault()                  // not needed when button type='button', but then Enter still submits the form (!)
                let fdata = new FormData(form.current)
                setFormDisabled(true)               // this must not preceed FormData(), otherwise fdata is empty
                // fdata.append('name', 'another name')
                // let name = input.current.value
                // let json = JSON.stringify(Array.from(fdata))

                let data = new Data()
                for (let [k, v] of fdata) data.push(k, v)

                let draft = await this.new(data)                // item with no IID yet; TODO: validate `data` through category's schema
                let item = await registry.insert(draft)         // has IID now
                form.current.reset()                            // clear input fields
                setFormDisabled(false)
                itemAdded(item)
            }

            return FORM({ref: form}, FIELDSET(
                // LABEL('Name: ', INPUT({name: 'name'}), ' '),
                INPUT({name: 'name', placeholder: 'name'}),
                BUTTON({type: 'submit', onClick: submit}, 'Create Item'),
            ))
        }
    }
}
