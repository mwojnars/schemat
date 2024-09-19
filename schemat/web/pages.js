import {NotImplemented} from "../common/errors.js";
import {T, print, assert, dedentFull, escape_html} from "../common/utils.js";
import {Resources, ReactDOM} from './resources.js'
import {e, useState, useRef, NBSP, DIV, A, P, H1, H2, H3, SPAN, FORM, INPUT, FIELDSET,
        TABLE, TH, TR, TD, TBODY, BUTTON, FRAGMENT, HTML} from './react-utils.js'
import {HttpService} from "./services.js";
import {Data} from "../core/data.js";
import {Styled} from "./component.js";
import {CatalogTable} from "../types/catalog.js";


/**********************************************************************************************************************/

export class HtmlPage extends HttpService {
    /* An HTTP(S) service that generates an HTML page for a `target` object in response to a browser-invoked web request.
       The layout and appearance of the page are defined by a View class: HtmlPage.View, or its subclass, or any class
       that implements the generate() method; that is an inner (static) class of the page class.  Rendering takes place
       in a special "view" object that combines properties of the target with the page-generation functionality of the View.
       In the base HtmlPage implementation, the page is built of separate strings/functions for: title, head, body.
     */

    constructor(View = null) {
        /* `View` is a class that defines the page's layout and appearance, typically a subclass of HtmlPage.View.
           If not specified, the page's own static View (constructor.View) is used.
         */
        super()
        this.View = View || this.constructor.View
    }

    async server(target, request) {
        /* Server-side generation of an HTML page for the target object. */
        let view = this.create_view(target)
        let props = await view.prepare('server') || {}
        return view.generate({request, ...props})
    }

    create_view(target) {
        /* Create a "view" object that combines the properties of the target object with page-generation functionality
           of the page's View class. Technically, a view is a Proxy that combines properties of two objects:

           - a base view: instance of HtmlPage.View that provides methods and high-level components for view generation
           - a target object whose data and properties are to be presented in the view.

           If JS supported multiple prototypical inheritance, the view would be created simply as an object
           with two prototypes: the View class's prototype and the target. A proxy is a workaround that intercepts
           all read access to attributes and redirects them to the View class (in the first place) or to the target object.

           All writes go to the view object itself. The view inherits target's prototype chain, so it looks like
           an instance of the target's class in terms of `instanceof` and `isPrototypeOf()`.
           Inside the view's methods, `this` is bound to the view object, so the view can access both the target's
           properties and methods, and the View class's methods. Note that the View class's attributes overshadow
           the target's attributes, so a property of the target may occasionally become inaccessible from inside the view.
         */

        let base_view = new this.View()

        return new Proxy(target, {
            get: (_, prop, receiver) => {
                let value = Reflect.get(base_view, prop, receiver)

                // methods in `base_view` are often React functional components, which must be bound to the view object
                // to allow their delayed execution inside a DOM tree
                if (typeof value === 'function') return value.bind(receiver)

                if (value !== undefined) return value
                return Reflect.get(target, prop, receiver)
            }
        })
    }

    static View = class extends Styled(Object) {
        /* A View is a collection of predefined components and a generate() method that combines them into a page.
           Methods and properties to be copied to a descendant of the target object to create a "view" that
           combines the regular interface of the target with the page-generation functionality as defined below.
           Inside the page-generation functions, `this` is bound to this combined "view" object, so it can access both
           the target object and the page-generation functions. Adding attributes to `this` is a convenient way to pass
           temporary data between the page-generation functions, because the attributes are added to the temporary
           view object and not to the target object. However, any attributes defined here in View must stay read-only,
           as they are shared between all views created from a given page class.
        */

        // _page_          // (DRAFT) parent HtmlPage instance; may contain extra information for view rendering, typically the endpoint-specific configuration when an object exposes different pages on multiple endpoints
        //
        // constructor(page) {
        //     this._page_ = page
        // }

        async prepare(side) {
            /* Prepare/collect extra information before the page generation (view rendering) starts. These are typically
               asynchronous operations to load data from the DB or await for URLs, so that actual generation/rendering
               may consist of synchronous operations alone. This method may return a dictionary of properties,
               however this is not required. `side` is either 'server' or 'client'.
             */
        }

        generate(props = {}) {
            /* Generate a complete HTML page server-side. Can be async.
               By default, this function calls target_html_*() functions to build separate parts of the page.
             */
            let title = this.html_title(props)
            let assets = this.html_head(props)
            let body = this.html_body(props)
            return this.html_frame({title, assets, body})
        }

        html_title(props)  {}        // override in subclasses; return a plain string to be put inside <title>...</title>
        html_head(props)   {}        // override in subclasses; return an HTML string to be put inside <head>...</head>
        html_body(props)   {}        // override in subclasses; return an HTML string to be put inside <body>...</body>

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
        }
    }
}

/**********************************************************************************************************************/

export class RenderedPage extends HtmlPage {
    /* An HTML page that is rendered from a component (e.g., React) and can be (re-)rendered on the client. */

    async render_client(target, html_element) {
        /* Client-side rendering of the main component of the page to an HTML element. */
        throw new NotImplemented('render() must be implemented in subclasses')
    }

    static View = class extends HtmlPage.View {

        html_body(props) {
            let html = this.render_server(props)
            let data = this.page_data(props)
            let code = this.page_script(props)
            return this.component_frame({html, data, code})
        }

        render_server(props) {
            /* Server-side rendering (SSR) of the main component of the page to an HTML string. */
            return ''
        }

        page_data(props) {
            /* Data string to be embedded in HTML output for use by the client-side JS code. Must be HTML-escaped. */
            throw new NotImplemented('page_data() must be implemented in subclasses')
        }

        page_script(props) {
            /* Javascript code (a string) to be pasted inside a <script> tag in HTML source of the page.
               This code will launch the client-side rendering of the component.
             */
            throw new NotImplemented('page_script() must be implemented in subclasses')
        }

        component_frame({html, data, code}) {
            /* The HTML wrapper for the page's main component, `html`, and its `data` and the launch script, `code`.
               All these elements will be placed together inside <body>...</body>.
             */
            let data_string = this._encode_page_data(data)
            return `
                <div id="page-main">${html}</div>
                <script async type="module">${code}</script>
                <p id="page-data" style="display:none">${data_string}</p>
            `
        }

        _encode_page_data(data) {
            return btoa(encodeURIComponent(JSON.stringify(data)))
        }
    }
}

export class ReactPage extends RenderedPage {
    /* Generates a React-based HTML page whose main content is rendered from a React functional component, Main().
       By default, Main() is written to the #page-main element in the page body, and any additional
       (meta)data is written to the #page-data element. A <script> tag is added to the page to load
       the client-side JS code that will render the same component on the client side.
       The  component can be rendered on the client by calling render() directly, then the HTML wrapper is omitted.
     */

    async render_client(target, html_element) {
        assert(schemat.client_side)
        target.assert_loaded()
        let view  = this.create_view(target)
        let props = await view.prepare('client') || {}
        let main  = e(view.Main, props)
        return ReactDOM.createRoot(html_element).render(main)
    }

    static View = class extends RenderedPage.View {

        async prepare(side) {
            // print(`prepare() called for [${this.__id}], ${this.__category}`)
            await this.load()
            await this.__category?.load()
            return {}
        }

        render_server(props) {
            this.assert_loaded()
            print(`SSR render('${props.request.endpoint}') of ID=${this.__id}`)
            let main = e(this.Main, props)
            return ReactDOM.renderToString(main)
            // might use ReactDOM.hydrate() not render() in the future to avoid full re-render client-side ?? (but render() seems to perform hydration checks as well)
        }

        page_data(props) {
            let dump = props.request.dump()
            return {...dump, endpoint: props.request.endpoint}
        }

        page_script(props) {
            return `import {ClientSchemat} from "/$/local/schemat/client/main.js"; ClientSchemat.start_client();`
        }

        Main() {
            /* The React functional component to be rendered as the page's content. */
            throw new NotImplemented('Main() component must be implemented in subclasses')
        }
    }
}

/**********************************************************************************************************************/

export class ItemRecordView extends ReactPage.View {
    /* System-level view that displays raw properties of a web object. */

    html_title() {
        /* Get/compute a title for an HTML response page for a given request & view name. */
        // print('html_title(): ', this.name, this.title, this.is_loaded)
        let title = this.html_title
        // if (title instanceof Function) title = title()          // this can still return undefined
        if (typeof title === 'string') return title
        let stamp = this.make_stamp({html: false})
        return `${this.name || ''} ${stamp}`
    }

    html_head() {
        /* Render dependencies: css styles, libraries, ... as required by HTML pages of this item. */
        let globalAssets = Resources.clientAssets
        // let staticAssets = this.__category?.schema_assets.render_all()
        let staticAssets = this.__assets.render_all()
        // let customAssets = this.__category?.html_assets
        let assets = [globalAssets, staticAssets]   // customAssets
        return assets .filter(a => a?.trim()) .join('\n')
    }

    Main({extra = null} = {}) {
        /* Detailed (admin) view of an item. */
        return DIV(
            // e(MaterialUI.Box, {component:"span", sx:{ fontSize: 16, mt: 1 }}, 'MaterialUI TEST'),
            // e(this._mui_test),
            this.Title(),
            this.Breadcrumb(),
            H2('Properties'),
            this.PropertiesTable(),
            extra,
        )
    }

    Title() {
        /* <H1> element to be displayed as a page title. */
        let name = this.name
        let stamp = this.make_stamp()
        if (name)
            return H1(name, ' ', SPAN({style: {fontSize:'40%', fontWeight:"normal"}, ...HTML(stamp)}))
        else
            return H1(HTML(stamp))
    }

    Breadcrumb() {
        /* A list of links to the parent containers of the object. */
        let steps = this.get_breadcrumb()
        let links = steps.map(([name, obj]) => A({href: obj.url()}, name || 'home'))
        let elems = links.map((link, i) => [link, i < links.length-1 ? ' » ' : ''])
        return P(...elems)
    }

    PropertiesTable() {
        /* Display this item's data as a DATA.Widget table with possibly nested Catalog objects. */
        return e(CatalogTable, {item: this, type: this.__schema, catalog: this.__data, start_color: 1})
    }
}

/**********************************************************************************************************************/

export class CategoryRecordView extends ItemRecordView {
    /* System-level view that displays raw properties of a Category object and a list of its children (members of the category). */

    async prepare(side) {
        // TODO: on client, items could be pulled from response data to avoid re-scanning on 1st render?
        await super.prepare(side)
        // let items = await this.list_objects({load: true})
        let items = await this.list_items()                             // preload the objects that belong to this category
        return {items}
    }

    Main({items: preloaded}) {
        // const scan = () => this.list_objects({load: true})
        const scan = () => this.list_items()
        const [items, setItems] = useState(preloaded)           // existing child items; state prevents re-scan after every itemAdded()
                                                                // TODO: use materialized list of items to explicitly control re-scanning
                                                                //    ...and avoid React's incorrect refresh when Items (below) are called in a different way

        const [newItems, setNewItems] = useState([])            // newly added items
        const itemAdded   = (item) => { setNewItems(prev => [...prev, item]) }
        const itemRemoved = (item) => { setNewItems(prev => prev.filter(i => i !== item)) }

        return super.Main({extra: FRAGMENT(
            H2('Objects'),
            e(this.Items, {items: items, itemRemoved: async () => setItems(await scan()), key: 'items'}),
            H3('New Object'),
            e(this.Items, {items: newItems, itemRemoved}),
            e(this.NewItem, {itemAdded}),
        )})
    }

    Items({items, itemRemoved}) {
        if (!items || items.length === 0) return null
        let remove = (item) => item.delete_self().then(() => itemRemoved && itemRemoved(item))
        let rows = items.map(item => this._ItemEntry({item, remove}))
        return TABLE(TBODY(...rows))
        // let items_loaded = delayed_render(T.arrayFromAsync(items).then(arr => T.amap(arr, item => item.load())), [items])
    }

    _ItemEntry({item, remove}) {
        /* A single row in the list of items. */
        let name = item.name || item.make_stamp({html:false})
        let url  = item.system_url
        return TR(
            TD(`${item.__id} ${NBSP}`),
            TD(url !== null ? A({href: url + '::record'}, name) : `${name} (no URL)`, ' ', NBSP),
            TD(BUTTON({onClick: () => remove(item)}, 'Delete')),
        )
    }

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
            let item = await schemat.insert(draft)          // has IID now
            await item.load()                               // load() is needed to initialize the item's URL

            form.current.reset()                            // clear input fields
            setFormDisabled(false)
            itemAdded(item)
        }

        return FORM({ref: form, style: {marginTop: '10px'}},
            // LABEL('Name: ', INPUT({name: 'name'}), ' '),
            INPUT({name: 'name', placeholder: 'name'}),
            BUTTON({type: 'submit', onClick: submit, style: {marginLeft: '10px'}}, 'Create'),
        )
    }
}



// _mui_test() {
//     return e(MaterialUI.Box, {component:"span", sx:{ fontSize: 16, mt: 1 }}, 'MaterialUI TEST')
//     // WARN: when _mui_test() is used repeatedly in Page, a <style> block is output EACH time (!!!)
//     //       A class name of the form .css-HASH is assigned, where HASH is a stable 6-letter hash of the styles
// }

