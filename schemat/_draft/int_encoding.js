/*
  Draft code for manual testing binary encoding/decoding of integers.
*/

function byteLengthOfUnsignedInteger(n) {
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

function byteLengthOfSignedInteger(n) {
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

// function encode(integer, signed = true) {
//     /* Magnitude of the value is detected automatically and the value is encoded on a minimum required no. of bytes,
//        between 1 and 8. The detected byte length is written to the output in the first byte.
//      */
//     const length = (signed ? byteLengthOfSignedInteger : byteLengthOfUnsignedInteger) (integer)
//     const buffer = new Uint8Array(length + 1)       // +1 for the length byte
//     buffer[0] = length
//
//     // shift the value range to make it unsigned
//     let num = signed ? integer + Math.pow(2, 8*length - 1) : integer
//
//     for (let i = length; i > 0; i--) {
//         buffer[i] = num & 0xFF
//         num = Math.floor(num / 256)
//     }
//     return buffer
// }
//
// function decode(buffer, signed = true) {
//     const length = buffer[0]
//     let num = 0
//
//     for (let i = 1; i <= length; i++)
//         num += buffer[i] * Math.pow(256, (length - i))
//
//     if (signed)
//         num -= Math.pow(2, 8*length - 1)
//
//     return num
// }

function encode(num, length = 0) {
    const adaptive = !length
    const offset = adaptive ? 1 : 0
    if (adaptive) length = byteLengthOfUnsignedInteger(num)

    const buffer = new Uint8Array(length + offset)          // +1 for the length byte in adaptive mode
    if (adaptive) buffer[0] = length

    for (let i = offset + length - 1; i >= offset; i--) {
        buffer[i] = num & 0xFF
        num = Math.floor(num / 256)         // bitwise ops (num >>= 8) are incorrect for higher bytes
        // buffer[i] = num % 256
        // num >>= 8
    }
    return buffer
}

function decode(buffer, length = 0) {
    const adaptive = !length
    const offset = adaptive ? 1 : 0

    if (adaptive) length = buffer[0]

    let num = 0
    for (let i = 0; i < length; i++)
        num += buffer[offset + i] * Math.pow(256, (length - i - 1))
        // num = (num << 8) | buffer[i]

    return num
}

function test(n, arg = 0) {
    let m = decode(encode(n, arg), arg)
    console.log(m === n, m, encode(n, arg))
}

function upper_bound(start = 0, signed = true) {
    /* Check consecutive integers to detect where the encoding/decoding fails for the first time. */
    let bound
    for (let n = start; n <= Number.MAX_SAFE_INTEGER; n++) {
        let m = decode(encode(n, signed), signed)
        if (m !== n) break
        if (n % 10000000 === 0) console.log(n)
        bound = n
    }
    console.log('upper bound:', bound)
}

// upper_bound(Math.floor(Number.MAX_SAFE_INTEGER/70), true)
