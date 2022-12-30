/**********************************************************************************************************************
 **
 **  ERRORS
 **
 */

export class BaseError extends Error {
    static message = null           // default message
    static code    = 500            // default HTTP status code

    // instance attributes
    name                            // name of the error, typically a class name (default)
    code                            // HTTP status code for the client if the error is returned as a response
    args                            // object {...} with arbitrary error-specific fields providing additional context
    message                         // message string

    constructor(msg  = undefined,
                args = undefined,
                code = undefined,
                name = undefined)
    {
        super()
        this.name = name || this.constructor.name
        this.code = code || this.constructor.code
        this.args = args

        if (msg && typeof msg !== 'string') { args = msg; msg = null; }
        this.message = msg || this.constructor.message

        if (args) {     // TODO: drop this, it's a hack around JS engines NOT calling toString() when printing an exception
            let argss = Object.entries(args).map(([k, v]) => k + `=${JSON.stringify(v)}`).join(', ')
            if (this.message) this.message += ', ' + argss
            else this.message = argss
        }
    }

    toString() {

    }
}

export class NotFound extends BaseError {
    static message = "URL not found"
    static code    = 404
}

export class NotImplemented extends BaseError {
    static message = "not implemented"
}

export class DataError extends BaseError {}
export class ValueError extends DataError {}

export class ItemDataNotLoaded extends BaseError {
    constructor(item) { super(`item.data is not loaded yet, call 'await item.load()' first: ${item}`) }
}
export class ItemNotLoaded extends BaseError {
    constructor(item) { super(`item is not loaded yet, call 'await item.load()' first: ${item}`) }
}

export class ServerError extends BaseError {
    /* Raised on client side when an internal call to the server completed with a non-OK status code. */
    constructor(response) {
        super()
        this.response = response            // an original Response object as returned from fetch()
    }
}

export class RequestFailed extends BaseError {
    /* Raised client-side when an internal call to the server completed with an error status code. */
    constructor({message, args, code, name}) {
        super(message, args, code, name)
    }
}


