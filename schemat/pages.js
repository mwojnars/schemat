import {dedentFull, escape_html, print} from "./utils.js";
import {Resources, ReactDOM} from './resources.js'
import {DIV, e, H2} from "./react-utils.js";
import {HttpService} from "./services.js";


/**********************************************************************************************************************/

export class HtmlPage extends HttpService {
    /* An HTTP(S) service that generates an HTML page in response to a browser-invoked web request.
       In the base class implementation, the page is built out of separate strings/functions for: title, head, body.
     */
    execute(target, ctx) {
        ctx = {...ctx, service: this}              // add `this` service to the context
        let prepare = this.target_prepare.call(target, ctx)
        if (prepare instanceof Promise) return prepare.then(() => this.target_html.call(target, ctx))
        return this.target_html.call(target, ctx)
    }

    target_prepare(ctx) {
        /* Adding additional information to the target object (`this`) or elsewhere to the context, `ctx`,
           before the page rendering starts.
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

export class ReactPage extends HtmlPage {
    /* Generates a React-based HTML page whose main content is rendered as a React component. Performs server-side rendering (SSR).
       By default, the component is written to the #react-root element in the page body, and any additional
       (meta)data is written to the #data-session element. A <script> tag is added to the page to load
       the client-side JS code that will render the same component on the client side.
     */
    target_html_body(ctx) {
        /* Page is a server-side rendering of the React main component placed inside an HTML boiler-code wrapper:
           <!DOCTYPE html>, <meta> data, <title>, scripts, assets etc.
           The same component can be rendered on the client side by calling target_render() directly,
           and in this case the HTML wrapper is omitted.
         */
        let {service} = ctx
        let component = service.render(this, ctx)
        let session = btoa(encodeURIComponent(JSON.stringify(ctx.request.session.dump())))
        return `
            <p id="data-session" style="display:none">${session}</p>
            <div id="react-root">${component}</div>
            <script async type="module"> import {ClientProcess} from "/system/local/processes.js"; new ClientProcess().start('${view}'); </script>
        `
    }

    render(target, ctx, html_element = null) {
        /* This method can be called on the server (html_element=null) or the client (html_element!=null).
           It renders the main React component.
         */
        target.assertLoaded()
        if (!html_element) print(`SSR render('${ctx.endpoint}') of ${target.id_str}`)

        let view = e(this.target_view.bind(target))

        return html_element ? ReactDOM.render(view, html_element) : ReactDOM.renderToString(view)
        // might use ReactDOM.hydrate() not render() in the future to avoid full re-render client-side ?? (but render() seems to perform hydration checks as well)
    }

}

/**********************************************************************************************************************/

export class ItemAdminPage extends ReactPage {
    /* A page that displays the properties of a single item. The target (`this` in target_*() functions)
       is expected to be an instance of Item.
     */

    target_html_title(ctx) {
        /* Get/compute a title for an HTML response page for a given request & view name. */
        let title = this.prop('html_title')
        if (title instanceof Function) title = title(ctx)           // this can still return undefined
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

    target_view({extra = null} = {}) {
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

