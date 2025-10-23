export async function GET({res}, {id}) {
    // schemat._print(`/$/json/[id]:`, {id})
    let obj = await schemat.load(Number(id))
    return res.json(obj.__record)
}