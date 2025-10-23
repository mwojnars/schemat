/*
  How much faster is the 1st way of object construction relative to the 2nd below:
  1) {key, value}
  2) new Record(key, value) - here, the constructor only assigns key and value to this.key and this.value.

RESULTS:
  Node.js v18.14.0:   (1) 378ms, (2) 3.58s   -- 10x slower
  browser Firefox:    (1) 5.9s,  (2) 14.0s   -- 2x slower  ... smaller no. of iterations than on Node.js
*/

class Record {
    constructor(key, value) {
        this.key = key;
        this.value = value;
    }
}

const iterations = 1000000000;

console.time('Object Literal');
for (let i = 0; i < iterations; i++) {
    const obj = {key: i, value: i};
}
console.timeEnd('Object Literal');

console.time('Constructor Function');
for (let i = 0; i < iterations; i++) {
    const obj = new Record(i, i);
}
console.timeEnd('Constructor Function');
