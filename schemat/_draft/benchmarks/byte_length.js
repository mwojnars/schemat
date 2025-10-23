/*
  Calculating the byte length of an integer using comparisons is faster than using logarithms.

RESULTS:

  Node.js 18.14.0, iterations = 1e9:

    byteLengthOfInteger: 2.601s
    byteLengthUsingLog: 10.202s

  Browser (Firefox), iterations = 1e7:

    byteLengthOfInteger: 2089ms           (browser is 100x slower than Node.js)
    byteLengthUsingLog: 3524ms

 */

const LOG_256 = Math.log2(256);

function byteLengthUsingLog(n) {
    if (n === 0) return 1; // Logarithm of 0 is not defined
    return Math.floor(Math.log2(Math.abs(n)) / LOG_256) + 1;
}

const iterations = 1e9;

function byteLengthOfInteger(n) {
    const absN = Math.abs(n);

    if (absN <= 0xFF) return 1;
    if (absN <= 0xFFFF) return 2;
    if (absN <= 0xFFFFFF) return 3;
    if (absN <= 0xFFFFFFFF) return 4;
    if (absN <= 0xFFFFFFFFFF) return 5;
    if (absN <= 0xFFFFFFFFFFFF) return 6;
    if (absN <= 0xFFFFFFFFFFFFFF) return 7;
    return 8;
}

// Timing byteLengthOfInteger()
console.time('byteLengthOfInteger');
for (let i = 0; i < iterations; i++) {
    byteLengthOfInteger(i);
}
console.timeEnd('byteLengthOfInteger');

// Timing byteLengthUsingLog
console.time('byteLengthUsingLog');
for (let i = 0; i < iterations; i++) {
    byteLengthUsingLog(i);
}
console.timeEnd('byteLengthUsingLog');
