import {JSONx} from "../common/jsonx.js";

/** POST /$/exec
    Run eval(code) on the server and return a JSONx-encoded result; `code` is a string sent as body.
    Any locally created data modifications are implicitly saved at the end unless the code raised an error.
 */
export async function POST(request) {
    if (!schemat.app.eval_allowed) throw new Error(`server-side execution of custom code is disabled`)

    let code = await request.text()
    let result = await eval(code)
    await schemat.save()

    return request.send(result !== undefined ? JSONx.stringify(result) : undefined)
}
