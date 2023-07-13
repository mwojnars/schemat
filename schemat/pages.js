import {NotImplemented} from "./errors.js";
import {dedentFull, escape_html, print} from "./utils.js";
import {Resources, ReactDOM} from './resources.js'
import {
    A,
    BUTTON,
    delayed_render,
    DIV,
    e, FIELDSET, FORM,
    FRAGMENT,
    H1,
    H2, H3,
    HTML, INPUT,
    NBSP,
    SPAN,
    TABLE,
    TBODY,
    TD,
    TR, useRef, useState
} from "./react-utils.js";
import {HttpService} from "./services.js";
import {Data} from "./data.js";


/**********************************************************************************************************************/

export class HtmlPage extends HttpService {
    /* An HTTP(S) service that generates an HTML page in response to a browser-invoked web request.
       In the base class implementation, the page is built out of separate strings/functions for: title, head, body.
       Context variables:
       - ctx.service: the current HtmlPage object
     */
    execute(target, ctx) {
        ctx = {...ctx, service: this}              // add `this` service to the context
        let prepare = this.target_prepare.call(target, ctx)
        if (prepare instanceof Promise) return prepare.then(() => this.target_html.call(target, ctx))
        return this.target_html.call(target, ctx)

        // view = Object.create(target, this.view)      // create a descendant object that looks like `target` but additionally contains all view.* properties & methods
        // let prepare = view.prepare(ctx)
    }

    target_prepare(ctx) {
        /* Add extra information to the target object (`this`) or to the context (`ctx`) before the page generation starts.
           In subclasses, prepare() is typically asynchronous to allow loading of external data from DB;
           here, it is defined as synchronous to avoid another async call when no actual preparation is performed.
           The target object, ctx.target, can also undergo some additional processing here.
         */
    }

    target_html(ctx) {
        /* Generate an HTML page server-side with `this` bound to the target object. Can be async.
           By default, this function calls target_html_*() functions to build separate parts of the page.
         */
        let {service} = ctx
        let title = service.target_html_title.call(this, ctx)
        let assets = service.target_html_head.call(this, ctx)
        let body = service.target_html_body.call(this, ctx)
        return service._html_frame({title, assets, body})
    }

    target_html_title(ctx)  {}      // override in subclasses; return a plain string to be put inside <title>...</title>
    target_html_head(ctx)   {}      // override in subclasses; return an HTML string to be put inside <head>...</head>
    target_html_body(ctx)   {}      // override in subclasses; return an HTML string to be put inside <body>...</body>

    _html_frame({title, assets, body}) {
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

/**********************************************************************************************************************/

export class RenderedPage extends HtmlPage {
    /* An HTML page that is rendered from a component (e.g., React).
       The (re)rendering can take place on the server and/or the client.
     */
    target_html_body(ctx) {
        let {service} = ctx
        let component = service.render_server(this, ctx)
        let data = service._make_data(this, ctx)
        let code = service._make_script(this, ctx)
        return service._component_frame({component, data, code})
    }

    render_server(target, ctx) {
        /* Server-side rendering (SSR) of the main component of the page to an HTML string. */
        return ''
    }
    render_client(target, html_element, props) {
        /* Client-side rendering of the main component of the page to an HTML element. */
        throw new NotImplemented('render_client() must be implemented in subclasses')
    }

    _make_data(target, ctx) {
        /* Data string to be embedded in HTML output for use by the client-side JS code. Must be HTML-escaped. */
        throw new NotImplemented('_make_data() must be implemented in subclasses')
    }
    _make_script(target, ctx) {
        /* Javascript code (a string) to be pasted inside a <script> tag in HTML source of the page.
           This code will launch the client-side rendering of the same component.
         */
        throw new NotImplemented('_make_script() must be implemented in subclasses')
    }

    _component_frame({component, data, code}) {
        /* The HTML wrapper for the page's main component, to be placed inside <body>...</body>. */
        return `
            <p id="page-data" style="display:none">${data}</p>
            <div id="page-component">${component}</div>
            <script async type="module">${code}</script>
        `
    }
}

export class ReactPage extends RenderedPage {
    /* Generates a React-based HTML page whose main content is rendered from a React component.
       By default, the component is written to the #page-component element in the page body, and any additional
       (meta)data is written to the #page-data element. A <script> tag is added to the page to load
       the client-side JS code that will render the same component on the client side.
       The  component can be rendered on the client by calling render() directly, then the HTML wrapper is omitted.
     */
    render_server(target, ctx) {
        target.assertLoaded()
        print(`SSR render('${ctx.endpoint}') of ${target.id_str}`)
        let view = e(this.target_component.bind(target), ctx)
        return ReactDOM.renderToString(view)
        // might use ReactDOM.hydrate() not render() in the future to avoid full re-render client-side ?? (but render() seems to perform hydration checks as well)
    }
    render_client(target, html_element, props = {}) {
        /* If called server-side, `props` are just the server-side context. */
        target.assertLoaded()
        props = {...props, service: this}               // add `this` service to the properties
        let view = e(this.target_component.bind(target), props)
        return ReactDOM.render(view, html_element)
    }

    _make_data(target, ctx) {
        let data = ctx.request.session.dump()
        return btoa(encodeURIComponent(JSON.stringify(data)))
    }
    _make_script(target, ctx) {
        return `import {ClientProcess} from "/system/local/processes.js"; new ClientProcess().start('${ctx.endpoint}');`
    }

    target_component(props) {
        /* The main React component to be rendered. */
        throw new NotImplemented('target_component() must be implemented in subclasses')
    }

}

/**********************************************************************************************************************/

export class ItemAdminPage extends ReactPage {
    /* A page that displays the properties of a single item. The target (`this` in target_*() functions)
       is expected to be an instance of Item.
     */

    target_html_title() {
        /* Get/compute a title for an HTML response page for a given request & view name. */
        let title = this.prop('html_title')
        if (title instanceof Function) title = title()          // this can still return undefined
        if (title === undefined) {
            let name = this.getName()
            let ciid = this.getStamp({html: false})
            title = `${name} ${ciid}`
        }
        return title
    }

    target_html_head() {
        /* Render dependencies: css styles, libraries, ... as required by HTML pages of this item. */
        let globalAssets = Resources.clientAssets
        let staticAssets = this.getSchema().getAssets().renderAll()
        let customAssets = this.category?.prop('html_assets')
        let assets = [globalAssets, staticAssets, customAssets]
        return assets .filter(a => a && a.trim()) .join('\n')
    }

    target_component({extra = null, ...props} = {}) {
        /* Detailed (admin) view of an item. */
        let {service} = props
        return DIV(
            // e(MaterialUI.Box, {component:"span", sx:{ fontSize: 16, mt: 1 }}, 'MaterialUI TEST'),
            // e(this._mui_test),
            service.Title.call(this),
            H2('Properties'),
            service.Properties.call(this),
            extra,
        )
    }

    // standard components for Item pages...

    Title() {
        /* <H1> element to be displayed as a page title. */
        let name = this.getName()
        let ciid = this.getStamp()
        if (name)
            return H1(name, ' ', SPAN({style: {fontSize:'40%', fontWeight:"normal"}, ...HTML(ciid)}))
        else
            return H1(HTML(ciid))
    }

    Properties() {
        /* Display this item's data as a DATA.Widget table with possibly nested Catalog objects. */
        // let changes = new Changes(this)
        return FRAGMENT(
                this.getSchema().displayTable({item: this}),
                // e(changes.Buttons.bind(changes)),
            )
    }
}

// _mui_test() {
//     return e(MaterialUI.Box, {component:"span", sx:{ fontSize: 16, mt: 1 }}, 'MaterialUI TEST')
//     // WARN: when _mui_test() is used repeatedly in Page, a <style> block is output EACH time (!!!)
//     //       A class name of the form .css-HASH is assigned, where HASH is a stable 6-letter hash of the styles
// }


/**********************************************************************************************************************/

export class CategoryAdminPage extends ItemAdminPage {

    target_component(props) {
        // const scan = () => this.db.scan_index('by_category', {category: this})
        const scan = () => this.registry.scan(this)         // returns an async generator that requires "for await"
        const [items, setItems] = useState(scan())                  // existing child items; state prevents re-scan after every itemAdded()

        const [newItems, setNewItems] = useState([])                // newly added items
        const itemAdded   = (item) => { setNewItems(prev => [...prev, item]) }
        const itemRemoved = (item) => { setNewItems(prev => prev.filter(i => i !== item)) }
        const {service} = props

        return ItemAdminPage.prototype.target_component.call(this, {...props, extra: FRAGMENT(
            H2('Items'),
            e(service.Items.bind(this), {items: items, itemRemoved: () => setItems(scan())}),
            H3('Add item'),
            e(service.Items.bind(this), {items: newItems, itemRemoved}),
            e(service.NewItem.bind(this), {itemAdded}),
        )})
    }

    Items({items, itemRemoved}) {
        /* A list (table) of items that belong to this category. */
        if (!items || items.length === 0) return null
        const remove = (item) => item.action.delete_self().then(() => itemRemoved && itemRemoved(item))

        return delayed_render(async () => {
            let rows = []
            for await (const item of items) {
                await item.load()
                let name = item.getName() || item.getStamp({html:false})
                let url  = item.url()
                rows.push(TR(
                    TD(`${item.id} ${NBSP}`),
                    TD(url !== null ? A({href: url}, name) : `${name} (no URL)`, ' ', NBSP),
                    TD(BUTTON({onClick: () => remove(item)}, 'Delete')),
                ))
            }
            return TABLE(TBODY(...rows))
        }, [items])
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

            let draft = await this.new(data)                    // item with no IID yet; TODO: validate & encode `data` through category's schema
            let item = await this.registry.insert(draft)        // has IID now
            form.current.reset()                                // clear input fields
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
