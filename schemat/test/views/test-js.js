// simple test methods for web routing

export async function GET(request) {
    return request.send("test GET request successful")
}

export async function POST(request) {
    const body = await request.json()
    return request.send(`test POST request successful: ${body.message}`)
}
