/*
  Generating powers of 2 with Math.pow() vs. binary shift vs. BigInt.

RESULTS:

  Node.js 18.14.0:

    Math.pow():         41.332ms        -- as fast as shift
    Shift:              39.647ms        -- fast but incorrect for larger lengths
    BigInt:              4.832s         -- extremely slow (!!!), like 100x slower than Math.pow()  !!!

  Browser (Firefox):

    Math.pow():         2217ms          -- good enough
    Shift:              1505ms
    BigInt:             3707ms          -- 2x slower than Math.pow()
    (smaller no. of iterations than on Node.js)
 */

const iterations = 1e8;

function usingMathPow(length) {
    return Math.pow(2, 8 * length);
}

function usingShift(length) {
    return 1 << (8 * length);
}

function usingBigInt(length) {
    return BigInt(1) << BigInt(8 * length);
}

// Timing Math.pow()
console.time('Math.pow()');
for (let i = 0; i < iterations; i++) {
    usingMathPow(3);  // You can vary this value
}
console.timeEnd('Math.pow()');

// Timing shift
console.time('Shift');
for (let i = 0; i < iterations; i++) {
    usingShift(3);  // Note: This works correctly only for length <= 4
}
console.timeEnd('Shift');

// Timing BigInt
console.time('BigInt');
for (let i = 0; i < iterations; i++) {
    usingBigInt(3);  // You can vary this value
}
console.timeEnd('BigInt');
