import {JSONx} from "../common/jsonx.js";

/** POST /$/action/[id]/[name]
    Execute a server-side action, act.[name], of a web object identified by `id`.
    Send modified records back to caller.
 */
export async function POST(request, {id, name}) {
    let obj = schemat.get_object(id)
    let args = await request.jsonx() || {}

    let [result, sess] = await schemat.execute_action(obj, name, args)

    let records = sess.dump_records()
    if (!records?.length) schemat._print(`WARNING: no object got modified during action ${obj}.act.${name}()`)

    let msg = JSON.stringify({status: 'success', result: JSONx.encode_checked(result), records})
    return request.send(msg)
}
