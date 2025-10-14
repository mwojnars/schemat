/**
 * DRAFT...
 * Server-side adapters for converting Express-style (req, res) objects to/from standard Request & Response objects.
 */

import { Readable } from 'node:stream'


/**
 * Convert Express (req, res) into Fetch-style Request.
 */
export function expressToRequest(req) {
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`

    const init = {
        method: req.method,
        headers: req.headers,
        body: ['GET', 'HEAD'].includes(req.method)
            ? undefined
            : Readable.toWeb(req)       // convert Node stream to Web ReadableStream
    }
    return new Request(url, init)
}

/**
 * Send Fetch Response back through Express res. IMPORTANT: Response instances are immutable, unlike Express's `res`.
 */
export async function sendResponse(res, response) {
    res.status(response.status)

    // Copy headers
    response.headers.forEach((value, name) => {
        res.setHeader(name, value)
    })

    if (response.body) {
        const nodeStream = Readable.fromWeb(response.body)
        nodeStream.pipe(res)
    }
    else res.end()
}
