import {CategoryInspectView, InspectView, ReactPage} from "#root/schemat/web/pages.js";

export async function GET(request, {id}) {
    let obj = await schemat.load(id)
    let View = obj.is_category() ? CategoryInspectView : InspectView
    let page = new ReactPage(View)
    request.target = obj
    request.endpoint = "GET.inspect"    // FIXME
    return page.handle(obj, request)
}