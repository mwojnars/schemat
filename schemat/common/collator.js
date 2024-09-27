
export class ExtendedCollator extends Intl.Collator {
    /*
       A standard collator that additionally provides getSortKey() and uint8-encoding/decoding methods.
       The sort key is produced by mapping each character of the input string to its index in a sorted list
       of all possible unicode characters (uniqueChars), and concatenating the resulting indices into a byte array.
       The order of characters in uniqueChars is determined by the collation order of the locale (this.compare()).

       NOTE: the resulting order of byte strings may deviate from the order of original strings as defined
       by this.compare(s1,s2). This is because the standard .compare() uses non-lexicographic rules for sorting
       and compares later characters in the string BEFORE checking for secondary/tertiary differences at earlier positions.
       For example, with 'en' locale, strings ['Aa', 'Ab', 'ab'] are sorted by compare() as:

            ['Aa', 'ab', 'Ab']   (the first letter is not enough to decide the order by itself),

       while their byte representations from ExtendedCollator, when sorted lexicographically, yield:

            ['ab', 'Aa', 'Ab']   (the first letter already puts the strings into disjoint subgroups).

       The latter result, although not fully compatible with the standard .compare(), seems more intuitive and
       appropriate in database applications.
     */


    uniqueChars         // concatenation of all possible Unicode characters sorted by their position in the collation order;
                        // starts with an extra character, '_', so that all regular characters have non-zero indices
    charToIndex         // mapping from char to index in uniqueChars

    // Real memory usage as measured with profiling tools:
    // in browser (Firefox):
    //   - uniqueChars: 4.3 MB
    //   - charToIndex: 5.1 MB
    //
    // The memory usage is much higher (>100 MB) when uniqueChars is an array of strings instead of a single string.


    constructor(locales, options) {
        super(locales, options)

        // generate uniqueChars containing all possible Unicode characters
        // console.log('generating uniqueChars...')
        let chars = []
        for (let i = 0; i <= 0x10FFFF; i++)
            if (!this.isSurrogate(i))
                chars.push(String.fromCodePoint(i))

        // sort uniqueChars based on the collation order
        chars.sort(this.compare.bind(this))
        this.uniqueChars = '_' + chars.join('')             // prepend '_' to make all indices in charToIndex non-zero

        // build reverse mapping from char to index
        // console.log('building charToIndex...')
        this.charToIndex = {}
        for (let i = 1; i < this.uniqueChars.length; i++)
            this.charToIndex[this.uniqueChars[i]] = i

        // console.log('done')
    }

    isSurrogate(codePoint) {
        return codePoint >= 0xD800 && codePoint <= 0xDFFF
    }

    getSortKey(str) {
        return Array.from(str).map(char => this.charToIndex[char])
    }

    encodeUint32(str) {
        const sortKey = this.getSortKey(str)
        return new Uint32Array(sortKey)
    }

    decodeUint32(uint32Array) {
        return Array.from(uint32Array).map(index => this.uniqueChars[index]).join('')
    }

    encodeUint24(str) {
        const sortKey = this.getSortKey(str);
        const uint8Array = new Uint8Array(sortKey.length * 3)   // 3 bytes for each 24-bit value

        for (let i = 0; i < sortKey.length; i++) {
            const value = sortKey[i]
            uint8Array[i * 3] = (value >> 16) & 0xFF            // Most significant 8 bits
            uint8Array[i * 3 + 1] = (value >> 8) & 0xFF         // Middle 8 bits
            uint8Array[i * 3 + 2] = value & 0xFF                // Least significant 8 bits
        }
        return uint8Array
    }

    decodeUint24(uint8Array) {
        const indices = []
        for (let i = 0; i < uint8Array.length; i += 3) {
            const value = (uint8Array[i] << 16) | (uint8Array[i + 1] << 8) | uint8Array[i + 2]
            indices.push(value)
        }
        return indices.map(index => this.uniqueChars[index]).join('')
    }

    encodeVariableUint24(str) {
        /* Encode a string into a Uint8Array of 24-bit values, terminated by three zero bytes. */

        const fixedArray = this.encodeUint24(str)
        const fixedLength = fixedArray.length
        const uint8Array = new Uint8Array(fixedLength + 3)          // +3 to account for the terminator

        // const sortKey = this.getSortKey(str)
        // const uint8Array = new Uint8Array(sortKey.length * 3 + 3)   // 3 bytes for each 24-bit value + 3 bytes for the terminator
        //
        // for (let i = 0; i < sortKey.length; i++) {
        //     const value = sortKey[i]
        //     uint8Array[i * 3] = (value >> 16) & 0xFF            // Most significant 8 bits
        //     uint8Array[i * 3 + 1] = (value >> 8) & 0xFF         // Middle 8 bits
        //     uint8Array[i * 3 + 2] = value & 0xFF                // Least significant 8 bits
        // }

        // append 24-bit terminator
        uint8Array.set(fixedArray)
        uint8Array[fixedLength] = 0
        uint8Array[fixedLength + 1] = 0
        uint8Array[fixedLength + 2] = 0

        return uint8Array
    }

    decodeVariableUint24(uint8Array) {
        /* Decode a Uint8Array of 24-bit values, terminated by three zero bytes, into a string.
           Return the decoded string and the number of bytes consumed from the input array.
         */

        const indices = []
        let i = 0

        while (i < uint8Array.length - 2) {     // -2 to ensure we can read three bytes
            if (uint8Array[i] === 0 && uint8Array[i + 1] === 0 && uint8Array[i + 2] === 0)  // check for 24-bit terminator
                break
            const value = (uint8Array[i] << 16) | (uint8Array[i + 1] << 8) | uint8Array[i + 2]
            indices.push(value)
            i += 3
        }
        const decodedStr = indices.map(index => this.uniqueChars[index]).join('')
        const bytesConsumed = i + 3             // +3 to account for the terminator

        return { decodedStr, bytesConsumed }
    }

    _testOne(str) {
        const encoded = this.encodeUint32(str)
        const decoded = this.decodeUint32(encoded)
        console.log("Original:", str)
        console.log("Encoded:", encoded)
        console.log("Decoded:", decoded)
    }

    _test(...strings) {
        // const encode = this.encodeUint32.bind(this)
        // const decode = this.decodeUint32.bind(this)
        // const encode = this.encodeUint24.bind(this)
        // const decode = this.decodeUint24.bind(this)
        const encode = this.encodeVariableUint24.bind(this)
        const decode = (s => this.decodeVariableUint24(s).decodedStr)

        for (const str of strings) {
            const encoded = encode(str)
            const decoded = decode(encoded)
            console.log(str, ' -> ', decoded, '  |  ', encoded)
            if (str !== decoded) throw new Error('encoding/decoding failed!')
        }

        // sort strings
        const sorted = strings.sort(this.compare.bind(this))

        // sort encoded representations
        const encoded = strings.map(str => encode(str))
        const sortedEncoded = encoded.sort(compareBinary)
        const sortedDecoded = sortedEncoded.map(encoded => decode(encoded))

        // concatenate sorted strings
        const sortedConcatenated = sorted.join(' | ')
        const sortedDecodedConcatenated = sortedDecoded.join(' | ')

        console.log('\nsorted:',)
        console.log(sortedConcatenated)
        console.log(sortedDecodedConcatenated)

        if (sortedConcatenated !== sortedDecodedConcatenated) console.error('sorting failed!')
    }
}

function compareBinary(a, b) {
    /* Compare lexicographically two binary arrays (Uint8Array, uint32Array) and return -1, 0 or 1.
       The arrays can be of different lengths, in which case the shorter one is considered smaller if it's a prefix
       of the longer one.
     */
    const minLength = Math.min(a.length, b.length)

    for (let i = 0; i < minLength; i++) {
        if (a[i] < b[i]) return -1
        if (a[i] > b[i]) return 1
    }

    // if we haven't returned yet, it means the arrays are identical up to `minLength`, we just compare their lengths
    if (a.length < b.length) return -1
    if (a.length > b.length) return 1

    return 0            // arrays are identical
}


// Example usage:

// let mem1 = process.memoryUsage().heapUsed
let collator = new ExtendedCollator('pl')

// let mem2 = process.memoryUsage().heapUsed
// console.log(`approximate memory usage: ${mem2 - mem1} bytes`)

collator._test('Hello World!', 'Ala ma Kota', 'Żółć', 'żółw', 'Żółty', 'ąęćźżńłóĄĘĆŹŻŃŁÓ', 'a', 'A', 'b', 'B', 'ą', 'ę', 'e')

// arr = ['aaaaab', 'Aaaaaa', 'Aaaaab']
// arr.sort(collator.compare.bind(collator))
// arr
// encoded = arr.map(str => collator.encodeUint32(str))
// sortedEncoded = encoded.sort(compareBinary)
// sortedDecoded = sortedEncoded.map(encoded => collator.decodeUint32(encoded))
