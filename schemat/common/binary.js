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

export function compare_uint8(arr1, arr2) {
    /* Compare two Uint8Arrays byte by byte. Return -1 if arr1 < arr2, 1 if arr1 > arr2, 0 if arr1 === arr2. */

    const minLength = Math.min(arr1.length, arr2.length)

    for (let i = 0; i < minLength; i++)
        if (arr1[i] < arr2[i])
            return -1
        else if (arr1[i] > arr2[i])
            return 1

    // At this point, all bytes up to minLength are equal.
    // If one of the arrays is longer, it's considered "greater".
    if (arr1.length < arr2.length)
        return -1
    else if (arr1.length > arr2.length)
        return 1

    return 0        // Both arrays are fully equal
}

export function byteLengthOfUnsignedInteger(n) {
    /* This implementation is 2-5x faster than when using Math.log(). */
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

export function byteLengthOfSignedInteger(n) {
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

export function binaryToString(uint8array) {
    /* Convert Uint8Array to a regular (ASCII) string by mapping bytes to characters one-to-one. */
    assert(uint8array instanceof Uint8Array)
    return String.fromCharCode(...uint8array)
}
export function binaryToString_Nodejs(uint8array) {
    /* This only works in Node.js. */
    assert(uint8array instanceof Uint8Array)
    return Buffer.from(uint8array).toString('ascii')
}

export function asciiToBinary(str) {
    /* Convert an ASCII string (a regular string containing only ASCII characters) to Uint8Array.
       Assert:  asciiToBinary(binaryToString(uint8)) === uint8
     */
    const arr = new Uint8Array(str.length)
    for (let i = 0; i < str.length; i++)
        arr[i] = str.charCodeAt(i)
    return arr
}
export function asciiToBinary_Nodejs(str) {
    /* This only works in Node.js. */
    return new Uint8Array(Buffer.from(str, 'ascii'))
}

// const arr = Uint8Array.from({ length: 256 }, (_, i) => i)
// asciiToBinary(binaryToString(arr)) is equal `arr`


/**********************************************************************************************************************/

export class BinaryMap extends CustomMap {
    /* A Map that holds Uint8Array binary keys. */

    convert(key)    { return binaryToString(key) }
    reverse(str)    { return asciiToBinary(str) }

    // convert(key)    { return [...key].join(",") }
    // reverse(str)    { return new Uint8Array(str.split(',').map(byte => +byte)) }
}


/**********************************************************************************************************************/

export function fnv1aHash(uint8array) {
    /* Fowler–Noll–Vo (FNV-1a) hash function for a Uint8Array. Calculations are performed on 32-bit integers. */

    let hash = 2166136261

    for (let byte of uint8array) {
        hash ^= byte
        hash *= 16777619
        hash &= 0xFFFFFFFF          // to ensure the hash remains a 32-bit number
    }

    return hash
}

// console.log(fnv1aHash(new Uint8Array([1, 2, 3, 4, 5])))
