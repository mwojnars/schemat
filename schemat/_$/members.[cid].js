import {JSONx} from "../common/jsonx.js"


/** GET /$/members/[cid]
    Returns the list of members of a web category with a given ID.
    Options {...} can be passed in request body as a JSONx-encoded string.
 */
export async function GET(request, {cid}) {
    let category = await schemat.load(cid)
    if (!category.is_category()) request.not_found()

    // decode `opts` from request body
    let body = request.text()
    let opts = body ? JSONx.parse(body) : {}

    let members = await schemat.list_category(category, {load: true, ...opts})
    return JSON.stringify(members.map(obj => obj?.__record))
}
