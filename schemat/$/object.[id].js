
export async function init(request, {id}) {
    /* Should return a plain object, data={...}, that will be merged into the second parameter of GET/POST/.../client() invocation.
       The returned object is NOT sent to client, but recomputed client-side once again.
       This function must be isomorphic, i.e., executable in this literal form on server and client alike.
     */
    let {CategoryInspectView, InspectView, ReactPage} = await import("#root/schemat/web/pages.js")
    let target = await schemat.load(id)
    let View = target.is_category() ? CategoryInspectView : InspectView
    let page = new ReactPage(View)
    return {page, target}
}


// export async function GET(request, {page, target}) {
export async function GET(request, {id}) {

    let {page, target} = await init(request, {id})

    request.target = target
    request.endpoint = "GET.inspect"    // FIXME

    // request.send_init(`
    //     let init = ${init.toString()};
    //     let {page, target} = await init(${id});
    //     await page.render_client(target);
    // `)

    return page.handle(target, request)
}


export async function client(request, {page, target}) {
    /* Client-side initialization after schemat was booted. */
    await page.render_client(target)
}