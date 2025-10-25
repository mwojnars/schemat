
/* Isomorphic initialization function.
   Returns a plain object, data={...}, that will be merged into the second parameter of GET/POST/.../client() invocation.
   The returned object is NOT sent to client, but recomputed there once again, so its content can be non-serializable.
   This function must be executable in its literal form on server and client alike.
 */
export async function init(request, {id}) {     // _init_object/_load_object/_load_react_page()
    let {CategoryInspectView, InspectView, ReactPage} = await import("#root/schemat/web/pages.js")
    let target = await schemat.load(id)
    let View = target.is_category() ? CategoryInspectView : InspectView
    let page = new ReactPage(View)
    request.target = target
    return {page, target}
}


export async function GET(request, {page, target}) {
    let html = await page.server(target, request)
    return request.send(html)
}


export async function client({page, target}) {
    /* Client-side initialization after schemat was booted. */
    await page.render_client(target)
}
