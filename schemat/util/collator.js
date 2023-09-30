
export class ExtendedCollator extends Intl.Collator {
    /* Extended collator that provides getSortKey() and uint8-encoding/decoding methods. */

    uniqueChars         // concatenation of all possible Unicode characters sorted by their position in the collation order;
                        // starts with an extra character, '_', so that all regular characters have non-zero indices
    charToIndex         // mapping from char to index in uniqueChars

    // real memory usage as measured with profiling tools:
    // in browser (FF):
    //   - uniqueChars: 4.3 MB
    //   - charToIndex: 5.1 MB

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

    encodeUint24Fixed(str) {
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

    decodeUint24Fixed(uint8Array) {
        const indices = []
        for (let i = 0; i < uint8Array.length; i += 3) {
            const value = (uint8Array[i] << 16) | (uint8Array[i + 1] << 8) | uint8Array[i + 2]
            indices.push(value)
        }
        return indices.map(index => this.uniqueChars[index]).join('')
    }


    _testOne(str) {
        const encoded = this.encodeUint32(str)
        const decoded = this.decodeUint32(encoded)
        console.log("Original:", str)
        console.log("Encoded:", encoded)
        console.log("Decoded:", decoded)
    }

    _test(...strings) {
        for (const str of strings) {
            const encoded = this.encodeUint32(str)
            const decoded = this.decodeUint32(encoded)
            console.log(str, ' -> ', decoded, '  |  ', encoded)
            if (str !== decoded) throw new Error('encoding/decoding failed!')
        }

        // sort strings
        const sorted = strings.sort(this.compare.bind(this))

        // sort encoded representations
        const encoded = strings.map(str => this.encodeUint32(str))
        const sortedEncoded = encoded.sort(compareBinary)
        const sortedDecoded = sortedEncoded.map(encoded => this.decodeUint32(encoded))

        // concatenate sorted strings
        const sortedConcatenated = sorted.join(' | ')
        const sortedDecodedConcatenated = sortedDecoded.join(' | ')

        console.log('\nsorted:',)
        console.log(sortedConcatenated)
        console.log(sortedDecodedConcatenated)

        if (sortedConcatenated !== sortedDecodedConcatenated) throw new Error('sorting failed!')
    }
}

function compareBinary(a, b) {
    /* Compare lexicographically two binary arrays (Uint8Array, uint32Array) and return -1, 0 or 1.
       The arrays can be of different lengths, in which case the shorter one is considered smaller
       if it's a prefix of the longer one.
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
