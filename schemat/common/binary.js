import {assert} from "./utils.js";
import {CustomMap} from "./structs.js";

/*
    TODO: use CBOR binary format for object storage instead of JSON!
    - compact binary syntax:  https://surrealdb.com/blog/understanding-cbor
    - much smaller size, esp. with gzip:  https://gist.github.com/kajuberdut/0191ec20f14253094792cd3c00f06257
    - fastest implementation is cbor-x:  https://jsonjoy.com/blog/json-codec-benchmarks / https://www.npmjs.com/package/cbor-x
    - http://cbor.io/
 */


/**********************************************************************************************************************/

export class BinaryOutput {
    /* A list of uint8 or uint32 sub-arrays to be concatenated into a single uint8 array at the end of encoding. */

    constructor() {
        this.buffers = []
    }

    write(...chunks) {
        /* Append uint8/uint32 array(s) to the output. */
        for (let chunk of chunks) {
            if (chunk instanceof Uint32Array) chunk = this._uint32_to_uint8(chunk)
            this.buffers.push(chunk)
        }
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
        if (this.pos > this.buffer.length)
            throw new Error(`BinaryInput: trying to read position ${this.pos} in a buffer of length ${this.buffer.length}`)
    }
}

/**********************************************************************************************************************/

export const zero_binary = new Uint8Array(0)

export function compare_bin(arr1, arr2) {
    /* Compare two Uint8Arrays byte by byte. Return -1 if arr1 < arr2, 1 if arr1 > arr2, 0 if arr1 === arr2.
       Empty array [] (`zero_binary`) represents a "zero" vector, which is a lower bound for all arrays.
       `null` represents a "full" vector, which is an upper bound for all arrays.
     */
    if (arr1 === null) return arr2 === null ? 0 : 1
    if (arr2 === null) return -1

    let minlen = Math.min(arr1.length, arr2.length)

    for (let i = 0; i < minlen; i++)
        if (arr1[i] < arr2[i]) return -1
        else if (arr1[i] > arr2[i]) return 1

    // at this point, all bytes up to `minlen` are equal; if one of the arrays is longer, it's considered "greater"
    if (arr1.length < arr2.length) return -1
    else if (arr1.length > arr2.length) return 1

    return 0        // both arrays are fully equal
}

export function bytes_uint(n) {
    /* Byte length of unsigned integer. This implementation is 2-5x faster than Math.log(). */
    if (n < 0) throw new Error(`expected unsigned integer instead of: ${n}`)
    if (n <= 0xFF) return 1
    if (n <= 0xFFFF) return 2
    if (n <= 0xFFFFFF) return 3
    if (n <= 0xFFFFFFFF) return 4
    if (n <= 0xFFFFFFFFFF) return 5
    if (n <= 0xFFFFFFFFFFFF) return 6
    if (n <= 0xFFFFFFFFFFFFFF) return 7         // this is already bigger than Number.MAX_SAFE_INTEGER, hence unsafe (!)
    return 8
}

export function bytes_int(n) {
    /* Byte length of signed integer. */
    if (n >= 0) {
        if (n <= 0x7F) return 1; // 127
        if (n <= 0x7FFF) return 2; // 32767
        if (n <= 0x7FFFFF) return 3; // 8,388,607
        if (n <= 0x7FFFFFFF) return 4; // 2,147,483,647
        if (n <= 0x7FFFFFFFFF) return 5;
        if (n <= 0x7FFFFFFFFFFF) return 6;
        if (n <= 0x7FFFFFFFFFFFFF) return 7;
        return 8;
    } else {
        if (n >= -0x80) return 1; // -128
        if (n >= -0x8000) return 2; // -32,768
        if (n >= -0x800000) return 3; // -8,388,608
        if (n >= -0x80000000) return 4; // -2,147,483,648
        if (n >= -0x8000000000) return 5;
        if (n >= -0x800000000000) return 6;
        if (n >= -0x80000000000000) return 7;
        return 8;
    }
}


/**********************************************************************************************************************/
//
//  Binary encoding/decoding of different data types
//

export function encode_uint(value, length = 0, required = false) {
    /* Binary encoding of an unsigned integer in a field of `length` bytes.
       If length is missing or 0, magnitude of the value is detected automatically and the value
       is encoded on the minimum required no. of bytes, between 1 and 7 (larger values exceed MAX_SAFE_INTEGER)
       - in such case the detected byte length is written to the output in the first byte. Returns Uint8Array.
     */
    let adaptive = !length
    let offset = adaptive ? 1 : 0

    if (required) assert(value !== null)

    if (adaptive)
        length = (value !== null) ? bytes_uint(value) : 0   // length=0 encodes null in adaptive mode
    else if (!required)
        if (value === null) value = 0                       // in non-adaptive mode, 0 is reserved for "null", hence shifting all values by +1
        else value += 1

    let buffer = new Uint8Array(length + offset)            // +1 for the length byte in adaptive mode
    if (adaptive) buffer[0] = length

    for (let i = offset + length - 1; i >= offset; i--) {
        buffer[i] = value & 0xFF
        value = Math.floor(value / 256)                     // bitwise ops (value >>= 8) are incorrect for higher bytes
    }
    return buffer
}

export function decode_uint(input, length = 0, required = false) {
    /* Reverse of encode_uint(). `input` must be a BinaryInput (not Uint8Array). */
    let adaptive = !length
    let offset = adaptive ? 1 : 0
    let buffer = input.current()

    if (adaptive) length = buffer[0]

    let value = 0
    for (let i = 0; i < length; i++)
        value += buffer[offset + i] * Math.pow(2, 8 * (length - i - 1))
        // value = (value << 8) | buffer[i]

    if (adaptive && length === 0) {
        assert(!required)
        value = null                                        // length=0 encodes null in adaptive mode
    }

    if (!adaptive && !required)
        if (value === 0) value = null                       // in non-adaptive mode, 0 is reserved for "null"
        else value -= 1

    input.move(length + offset)
    return value
}

export function encode_int(value, length = 6) {
    /* Encode a signed integer into Uint8Array of fixed length (6 bytes by default to stay in Number.MIN_SAFE_INTEGER range).
       This is done by shifting the entire value range upwards and encoding as unsigned.
     */
    // static DEFAULT_LENGTH_SIGNED = 6    // default length of the binary representation in bytes, for signed integers
    assert(length > 0)
    value += Math.pow(2, 8*length - 1)      // TODO: memorize all Math.pow(2,k) here and below
    assert(value >= 0)
    return encode_uint(value, length)
}

export function decode_int(input, length = 6) {
    /* Reverse of encode_int(); `input` must be a BinaryInput (not Uint8Array). */
    assert(length > 0)
    let shift = Math.pow(2, 8*length - 1)
    return decode_uint(input, length) - shift           // decode as unsigned and shift downwards to restore the original signed int
}

/**********************************************************************************************************************/

export function bin_to_ascii(uint8array) {
    /* Convert Uint8Array to a regular (ASCII) string by mapping bytes to characters one-to-one. */
    assert(uint8array instanceof Uint8Array)
    return String.fromCharCode(...uint8array)
}
export function ascii_to_bin(str) {
    /* Convert an ASCII string (a regular string containing only ASCII characters) to Uint8Array.
       Assert:  ascii_to_bin(bin_to_ascii(uint8)) === uint8
     */
    let arr = new Uint8Array(str.length)
    for (let i = 0; i < str.length; i++)
        arr[i] = str.charCodeAt(i)
    return arr
}

export function bin_to_ascii_nodejs(uint8array) {
    /* This only works in Node.js. */
    assert(uint8array instanceof Uint8Array)
    return Buffer.from(uint8array).toString('ascii')
}
export function ascii_to_bin_nodejs(str) {
    /* This only works in Node.js. */
    return new Uint8Array(Buffer.from(str, 'ascii'))
}

export function bin_to_hex(uint8Array) {
    return Array.from(uint8Array, byte => byte.toString(16).padStart(2, '0')).join('')
}
export function hex_to_bin(str) {
    let bytes = [], len = str.length
    for (let i = 0; i < len; i += 2)
        bytes.push(parseInt(str.substr(i, 2), 16))
    return new Uint8Array(bytes)
}

// const arr = Uint8Array.from({ length: 256 }, (_, i) => i)
// ascii_to_bin(bin_to_ascii(arr)) is equal `arr`

export function reverse_bits(num, width = 64) {
    /* Possibly costly way to reverse the order of all bits in `num` (a BigInt). Example:
       reverseBits64(0b101n).toString(2)   // "1010000000000000000000000000000000000000000000000000000000000000"
     */
    let result = 0n
    for (let i = 0; i < width; i++) {
        result = (result << 1n) | (num & 1n)
        num >>= 1n
    }
    return result
}



/**********************************************************************************************************************/

export class BinaryMap extends CustomMap {
    /* A Map that holds Uint8Array binary keys. */

    convert(key)    { return bin_to_ascii(key) }
    reverse(str)    { return ascii_to_bin(str) }

    // convert(key)    { return [...key].join(",") }
    // reverse(str)    { return new Uint8Array(str.split(',').map(byte => +byte)) }
}


/**********************************************************************************************************************/

export function isPowerOfTwo(x) {
    /* Check that the integer, `x`, is a power of 2. */
    return Number.isInteger(x) && x > 0 && (x & (x - 1)) === 0
}


export function fnv1aHash(uint8array) {
    /* Fowler-Noll-Vo (FNV-1a) hash function for a Uint8Array. Calculations are performed on 32-bit integers. */

    let hash = 2166136261

    for (let byte of uint8array) {
        hash ^= byte
        hash *= 16777619
        hash &= 0xFFFFFFFF          // to ensure the hash remains a 32-bit number
    }

    return hash
}

// console.log(fnv1aHash(new Uint8Array([1, 2, 3, 4, 5])))
