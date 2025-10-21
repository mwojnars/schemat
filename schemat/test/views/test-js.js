// simple test methods for web routing

export async function GET(request) {
    return request.send("test GET request successful")
}

export async function POST(request) {
    return request.send("test POST request successful")
}
