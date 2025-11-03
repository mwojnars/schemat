import {JSONx} from "../common/jsonx.js"


/** GET /$/members/[cid]
    If option load=true (default), returns the list of {id, data} records
    representing member objects of a web category with a given CID.
    Otherwise, returns an array of IDs of these objects.
    Options {...} can be passed in request body as a JSONx-encoded string.
 */
export async function GET(request, {cid}) {
    let category = await schemat.load(cid)
    if (!category.is_category()) request.not_found()

    // decode `opts` from request body .. TODO: read `opts` from query
    let body = await request.text()
    let {load = true, ...opts} = body ? JSONx.parse(body) : {}

    let members = await schemat.list_category(category, {load, ...opts})
    let json = JSON.stringify(members.map(obj => load ? obj?.__record : obj.id))
    return request.send(json)
}
