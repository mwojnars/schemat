import {CategoryInspectView, InspectView, ReactPage} from "#root/schemat/web/pages.js";

export async function GET(request, {id}) {
    let target = await schemat.load(id)
    let View = target.is_category() ? CategoryInspectView : InspectView
    let page = new ReactPage(View)

    request.target = target
    request.endpoint = "GET.inspect"    // FIXME
    // after | request.client_after = `page.render_client(target)`

    return page.handle(target, request)
}