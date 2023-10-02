/**********************************************************************************************************************/

export class BinaryOutput {
    /* A list of uint8 or uint32 sub-arrays to be concatenated into a single uint8 array at the end of encoding. */

    constructor() {
        this.buffers = []
    }

    write(chunk) {
        /* Append uint8/uint32 array to the output. */
        if (chunk instanceof Uint32Array) chunk = this._uint32_to_uint8(chunk)
        this.buffers.push(chunk)
    }

    _uint32_to_uint8(chunk) {
        /* Convert Uint32Array to Uint8Array. We cannot just take chunk.buffer because its byte order depends
           on the machine's endianness! */
        let length = chunk.length
        let result = new Uint8Array(length * 4)
        for (let i = 0; i < length; i++) {
            let value = chunk[i]
            result[i*4]   = (value >> 24) & 0xFF
            result[i*4+1] = (value >> 16) & 0xFF
            result[i*4+2] = (value >>  8) & 0xFF
            result[i*4+3] =  value        & 0xFF
        }
        return result
    }

    result() {
        /* Return the concatenated output as a single Uint8Array. */
        let length = 0
        for (let chunk of this.buffers) length += chunk.length
        let result = new Uint8Array(length)
        let pos = 0
        for (let chunk of this.buffers) {
            result.set(chunk, pos)
            pos += chunk.length
        }
        return result
    }
}

export class BinaryInput {
    /* An uint8 array that can be read in chunks during decoding while keeping track of the current position. */

    constructor(buffer) {
        // assert(buffer instanceof Uint8Array)
        this.buffer = buffer
        this.pos = 0
    }
    current() {
        /* Return a subarray of the remaining bytes. */
        return this.buffer.subarray(this.pos)
    }
    move(length) {
        /* Advance the current position by `length` bytes. */
        this.pos += length
    }
}

