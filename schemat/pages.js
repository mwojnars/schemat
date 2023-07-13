import {NotImplemented} from "./errors.js";
import {dedentFull, escape_html, print} from "./utils.js";
import {Resources, ReactDOM} from './resources.js'
import {DIV, e, H2} from "./react-utils.js";
import {HttpService} from "./services.js";


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
       Context variables:
       - ctx.props: the properties to be passed down to the component during server-side rendering in render_server()
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
        print(`SSR render('${ctx.endpoint}') of ${target.id_str}`)
        target.assertLoaded()
        let view = e(this.target_component.bind(target), ctx.props)
        return ReactDOM.renderToString(view)
        // might use ReactDOM.hydrate() not render() in the future to avoid full re-render client-side ?? (but render() seems to perform hydration checks as well)
    }
    render_client(target, html_element, props) {
        target.assertLoaded()
        let view = e(this.target_component.bind(target), props)
        return ReactDOM.render(view, html_element)
    }

    _make_data(target, ctx) {
        return btoa(encodeURIComponent(JSON.stringify(ctx.request.session.dump())))
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

    target_component({extra = null} = {}) {
        /* Detailed (admin) view of an item. */
        return DIV(
            // e(MaterialUI.Box, {component:"span", sx:{ fontSize: 16, mt: 1 }}, 'MaterialUI TEST'),
            // e(this._mui_test),
            e(this.Title.bind(this)),
            H2('Properties'),
            e(this.Properties.bind(this)),
            extra,
        )
    }
}

