
export function warn(msg) {
    /* Print a warning. In the future, this should be replaced with writing to a logging queue (on server). */
    console.error('WARNING:', msg)
}


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

    toString() {}
}

/**********************************************************************************************************************/

export class DatabaseError extends BaseError            { static message = "database error" }
export class DataAccessError extends DatabaseError      { static message = "data access error" }
export class DataConsistencyError extends DatabaseError { static message = "data consistency error" }
export class ObjectNotFound extends DatabaseError       { static message = "ID not found in the database" }

/**********************************************************************************************************************/

export class NetworkError extends BaseError {}

export class URLNotFound extends NetworkError {
    static message = "URL not found"
    static code    = 404
}

export class ServerTimeoutError extends NetworkError {
    static message = "response generation took too long"
    static code    = 504
}

export class RequestFailed extends NetworkError {
    /* Raised on client when an internal call to the server completed with an error status code. */
    constructor({message, args, code, name}) {
        super(message, args, code, name)
    }
}

/**********************************************************************************************************************/

export class ValidationError extends BaseError  { static message = "validation of object's fields failed" }
export class ValueError extends ValidationError { static message = "incorrect value of an object's field" }

/**********************************************************************************************************************/

export class InternalError extends BaseError {}
export class ExitingNow extends BaseError {}

export class NotImplemented extends InternalError {
    static message = "not implemented"
}

export class NotLoaded extends InternalError {
    constructor(obj) { super(`object is not loaded yet, run 'await obj.load()', id=${obj.id}`) }
}

