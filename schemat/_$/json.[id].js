/** GET /$/json/[id]
    Returns JSON representation of web object with a given ID.
 */
export async function GET(request, {id}) {
    // schemat._print(`/$/json/[id]:`, {id})
    let obj = await schemat.load(id)
    return request.send_json(obj.__record)
}